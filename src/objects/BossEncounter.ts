/**
 * BossEncounter (B5) — the command-ship boss, wave 6 of the run (act 2's
 * boss). Owns the Boss + 4 orbiting Escorts and a repeating, urgent CYCLE:
 *
 *   idle → charging → won | lost
 *
 *   won hands back to the WaveDirector (`onDefeated`), which runs the breather
 *   and the next wave; lost shows the fail card.
 *
 *   CHARGING: live adjacent escorts make a physical shield web. Destroying a
 *   node opens two gaps for its regen time and resets + pauses the charge;
 *   charged FIRE rounds can hit the boss only if they physically pass through a gap.
 *   won: boss HP 0 · lost: a fired charge takes the fleet's last ship.
 *
 *   Solo (#6) paces both clocks: the charge is BOSS.chargeMs and a node's regen
 *   BOSS.escortRegenMs, each ÷ SOLO.pace (pacedMs). The boss's hp doesn't change.
 *
 * Boss + escort sprites are created ONCE here (parked) so the scene's
 * rocket↔boss overlap collider — built once over `sprites` — never points at a
 * recreated body (same discipline as the asteroid wrappers).
 */
import Phaser from 'phaser';
import { BOSS_LAYOUT, FLEET } from '../layout';
import { BOSS, pacedMs } from '../waves';
import { Boss } from './Boss';
import { BossBars } from './BossBars';
import { Escort } from './Escort';
import { ShieldWeb } from './ShieldWeb';
import { Fleet } from './Fleet';
import { Overlay } from './Overlay';
import { inBlast, type HomingTarget } from './HomingTarget';
import type { PlayerId } from './Rocket';

type BossPhase = 'idle' | 'charging' | 'won' | 'lost';

const NO_TARGETS: readonly HomingTarget[] = [];

export class BossEncounter {
  private readonly boss: Boss;
  private readonly bars: BossBars;
  private readonly escorts: Escort[];
  private readonly web: ShieldWeb;
  private phaseState: BossPhase = 'idle';
  private timer = 0; // ms of charge accrued toward chargeMs
  /** BOSS.chargeMs at this seat count (solo: slower, pacedMs). */
  private readonly chargeMs: number;
  private orbitAngle = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fleet: Fleet,
    private readonly failOverlay: Overlay,
    /** The boss is down and the field is clear: the run continues. */
    private readonly onDefeated: () => void,
    /** Live seats (the join screen's lineup): solo relaxes the escort co-op lock
     *  (Escort.takeHit) and paces the charge and the escorts' regen (pacedMs). */
    players: 1 | 2
  ) {
    this.chargeMs = pacedMs(BOSS.chargeMs, players);
    const escortRegenMs = pacedMs(BOSS.escortRegenMs, players);
    this.boss = new Boss(scene, () => this.defeated());
    this.bars = new BossBars(scene);
    this.escorts = Array.from(
      { length: BOSS.escortCount },
      () => new Escort(scene, () => this.onEscortDestroyed(), players === 1, escortRegenMs)
    );
    this.web = new ShieldWeb(scene, BOSS_LAYOUT.escort.webWidth);
  }

  get phase(): BossPhase {
    return this.phaseState;
  }

  get bossHp(): number {
    return this.boss.currentHp;
  }

  /** Live (un-popped) escort count — for tests verifying the respawn cycle. */
  get aliveEscorts(): number {
    return this.escorts.filter((e) => e.isActive).length;
  }

  /** Sprites for the one-time rocket↔boss overlap collider (boss + escorts). */
  get sprites(): Phaser.Physics.Arcade.Sprite[] {
    return [this.boss.sprite, ...this.escorts.map((e) => e.sprite)];
  }

  /** Called by the WaveDirector when the command-ship wave starts. */
  start(): void {
    if (this.phaseState === 'charging') return;
    this.fleet.setShieldRegenMs(BOSS.shieldRegenMs);
    this.boss.activate(); // slides in; charging holds until it has parked
    this.startCharge();
  }

  update(deltaMs: number): void {
    if (this.phaseState !== 'charging') return;
    this.orbitAngle += Phaser.Math.DegToRad(BOSS_LAYOUT.escort.orbitSpeedDeg) * (deltaMs / 1000);
    for (const escort of this.escorts) escort.update(deltaMs); // regen timers
    this.placeEscorts(); // after regen, so a returning node is positioned before the web redraws
    this.web.update(deltaMs, this.escorts);

    // B34: a live gap pauses the danger clock. Each kill resets it as the
    // defensive payoff; it resumes only once all four nodes have regenerated.
    if (this.boss.isEntered && this.aliveEscorts === BOSS.escortCount) {
      this.timer += deltaMs;
      if (this.timer >= this.chargeMs) this.bossFires();
    }
    this.drawBars();
  }

  /** Feed the off-boss HEALTH + CHARGE gauges from current state (the charge
   *  fraction is derived from the live timer, so the `timer = 0` resets on
   *  escort kills reset the bar for free). Hidden outside an entered charge. */
  private drawBars(): void {
    const visible = this.phaseState === 'charging' && this.boss.isEntered;
    this.bars.update({
      hp: this.boss.currentHp,
      maxHp: BOSS.hp,
      chargeFrac: visible ? this.timer / this.chargeMs : 0,
      visible,
    });
  }

  /** What a SPECIAL missile can take here: the escorts, while charging. The
   *  missile is an escort aid only; the boss takes only charged FIRE rounds.
   *  Callers filter on isActive/isPopping, so this hands back the pooled list as-is. */
  missileTargets(): readonly HomingTarget[] {
    return this.phaseState === 'charging' ? this.escorts : NO_TARGETS;
  }

  /** A detonator blast (#26) centred on (x, y): every escort a SPECIAL can
   *  hurt whose body reaches inside `radius` takes `player`'s lock through
   *  Escort.takeHit, the same path as a shot (handleBossHit). The boss isn't
   *  among them: only charged FIRE rounds hurt it. */
  blastEscorts(x: number, y: number, radius: number, player: PlayerId): void {
    if (this.phaseState !== 'charging') return;
    for (const e of this.escorts) if (inBlast(e, x, y, radius)) e.takeHit(player);
  }

  /** DEV/test: contribute both colors to escort i (used for cycle setup). */
  killEscort(i: number): void {
    const e = this.escorts[i];
    if (!e) return;
    e.takeHit('p1');
    e.takeHit('p2');
  }

  /** DEV/test: route an explicitly colored hit to one escort. */
  hitEscort(i: number, player: PlayerId): void {
    this.escorts[i]?.takeHit(player);
  }

  /** DEV/test read: two-bit contribution masks, one per escort. */
  get escortLocks(): number[] {
    return this.escorts.map((e) => e.lockMask);
  }

  get shieldLinkCount(): number {
    return this.web.count;
  }

  get chargeFraction(): number {
    return Math.min(1, this.timer / this.chargeMs);
  }

  /** True when the rocket's sweep crosses a live web link. Checked every frame
   *  for every rocket (global line collision: a shot that crosses a web edge is
   *  spent even if it was headed elsewhere) and again in the boss overlap
   *  process callback, before target damage. */
  blocksRocket(rocket: Phaser.Physics.Arcade.Sprite): boolean {
    return this.phaseState === 'charging' && this.web.blocks(rocket);
  }

  debugWebBlocks(ax: number, ay: number, bx: number, by: number): boolean {
    return this.web.blocksSegment(ax, ay, bx, by);
  }

  debugWebLinks(): ShieldWeb['segments'] {
    return this.web.segments;
  }

  /** Take the boss, escorts, web and gauges off the field, back to idle
   *  (a wave jump away from the fight). */
  stop(): void {
    this.phaseState = 'idle';
    this.clearField();
  }

  /** DEV/test: defeat the boss now, skipping its wall-clock death tween. */
  debugDefeat(): void {
    if (this.phaseState === 'charging') this.boss.forceDefeat();
  }

  /** DEV/test: skip the boss slide-in tween (see Boss.snapEntered). */
  snapBossIn(): void {
    this.boss.snapEntered();
  }

  /** Start the encounter with a complete rotating web. Afterwards escorts
   * regenerate independently; never recreate their pooled sprites. */
  private startCharge(): void {
    this.phaseState = 'charging';
    this.timer = 0;
    for (const e of this.escorts) e.activate();
    this.placeEscorts();
    this.web.update(0, this.escorts);
  }

  /** The charge fired: the beam hits the top-most live ship (#19's placeholder
   *  rule; #27 decides the final one). The fleet can't be empty here — losing
   *  the last ship ends the encounter. */
  private bossFires(): void {
    const target = this.fleet.topMostLive();
    this.boss.fireBeam(this.fleet.shipPoint(target));
    if (this.fleet.onEnemyReached(target) === 'fleetLost') {
      this.phaseState = 'lost';
      this.drawBars(); // hides them
      this.scene.physics.pause(); // freeze the field behind the card
      this.failOverlay.show();
      return;
    }
    // The fleet takes the hit; the web stays as-is. Reset the charge and keep going.
    this.timer = 0;
  }

  private placeEscorts(): void {
    const { x: bx, y: by } = this.boss.sprite;
    const step = (Math.PI * 2) / this.escorts.length;
    const r = BOSS_LAYOUT.escort.formationRadius;
    this.escorts.forEach((e, i) => {
      if (!e.isActive) return;
      const a = this.orbitAngle + i * step;
      e.place(bx + Math.cos(a) * r, by + Math.sin(a) * r, FLEET.facePoint.x, FLEET.facePoint.y);
    });
  }

  private onEscortDestroyed(): void {
    // A kill opens two adjacent web links and resets the charge; the update
    // loop keeps it paused until the node regenerates (its regenMs).
    this.timer = 0;
  }

  private defeated(): void {
    this.phaseState = 'won';
    this.clearField();
    this.onDefeated();
  }

  /** Park the boss and every escort, empty the web, hide the gauges. Call it
   *  after leaving 'charging', so drawBars() hides them. */
  private clearField(): void {
    this.boss.park();
    for (const e of this.escorts) e.park();
    this.web.update(0, this.escorts); // no live nodes → no links drawn
    this.timer = 0;
    this.drawBars();
  }
}
