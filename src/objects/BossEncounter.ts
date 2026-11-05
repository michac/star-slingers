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
 *   node opens two gaps for BOSS.escortRegenMs and resets + pauses the charge;
 *   charged FIRE rounds can hit the boss only if they physically pass through a gap.
 *   won: boss HP 0 · lost: a fired charge takes the fleet's last ship.
 *
 * The beam always hits the top-most live fleet ship (#27, deterministic: a
 * fight the players don't stop works down the fleet, one ship every two
 * beams). While the charge can fill, a pulsing magenta crosshair marks that
 * ship, so both seats can see which one is next.
 *
 * Boss + escort sprites are created ONCE here (parked) so the scene's
 * rocket↔boss overlap collider — built once over `sprites` — never points at a
 * recreated body (same discipline as the asteroid wrappers).
 */
import Phaser from 'phaser';
import { BOSS_LAYOUT, FLEET } from '../layout';
import { COLORS } from '../tokens';
import { BOSS } from '../waves';
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
/** The crosshair's four ticks, as unit directions (drawn every charging frame: built once). */
const MARK_TICKS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export class BossEncounter {
  private readonly boss: Boss;
  private readonly bars: BossBars;
  private readonly escorts: Escort[];
  private readonly web: ShieldWeb;
  /** The crosshair on the ship the beam will hit (#27). */
  private readonly targetMark: Phaser.GameObjects.Graphics;
  /** The fleet ship the crosshair is on, -1 while hidden. */
  private markedShip = -1;
  private markMs = 0; // the crosshair's pulse clock (update's delta)
  private phaseState: BossPhase = 'idle';
  private timer = 0; // ms of charge accrued toward BOSS.chargeMs
  private orbitAngle = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fleet: Fleet,
    private readonly failOverlay: Overlay,
    /** The boss is down and the field is clear: the run continues. */
    private readonly onDefeated: () => void,
    /** Live seats (the join screen's lineup): solo relaxes the escort co-op lock (Escort.takeHit). */
    players: 1 | 2
  ) {
    this.boss = new Boss(scene, () => this.defeated());
    this.bars = new BossBars(scene);
    this.escorts = Array.from(
      { length: BOSS.escortCount },
      () => new Escort(scene, () => this.onEscortDestroyed(), players === 1)
    );
    this.web = new ShieldWeb(scene, BOSS_LAYOUT.escort.webWidth);
    this.targetMark = scene.add.graphics().setDepth(1.5);
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
    this.markMs += deltaMs;
    for (const escort of this.escorts) escort.update(deltaMs); // regen timers
    this.placeEscorts(); // after regen, so a returning node is positioned before the web redraws
    this.web.update(deltaMs, this.escorts);

    // B34: a live gap pauses the danger clock. Each kill resets it as the
    // defensive payoff; it resumes only once all four nodes have regenerated.
    if (this.boss.isEntered && this.aliveEscorts === BOSS.escortCount) {
      this.timer += deltaMs;
      if (this.timer >= BOSS.chargeMs) this.bossFires();
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
      chargeFrac: visible ? this.timer / BOSS.chargeMs : 0,
      visible,
    });
    this.drawTargetMark(visible);
  }

  /** The beam's next target (#27): a ring with four ticks on the top-most
   *  live ship, pulsing, shown with the gauges. */
  private drawTargetMark(visible: boolean): void {
    const g = this.targetMark.clear();
    this.markedShip = visible ? this.fleet.topMostLive() : -1;
    if (this.markedShip < 0) return;
    const { r, tick, width, pulseMs, minAlpha } = BOSS_LAYOUT.targetMark;
    const pulse = 0.5 + 0.5 * Math.sin((this.markMs / pulseMs) * Math.PI * 2);
    const { x, y } = this.fleet.shipPoint(this.markedShip);
    g.lineStyle(width, COLORS.danger, minAlpha + (1 - minAlpha) * pulse);
    g.strokeCircle(x, y, r);
    for (const [dx, dy] of MARK_TICKS) {
      g.lineBetween(x + dx * (r - tick / 2), y + dy * (r - tick / 2), x + dx * (r + tick), y + dy * (r + tick));
    }
  }

  /** DEV/test read: the fleet ship the crosshair marks, -1 while it's hidden. */
  get beamTarget(): number {
    return this.markedShip;
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
    return Math.min(1, this.timer / BOSS.chargeMs);
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

  /** The charge fired: the beam hits the top-most live ship (#27), the one the
   *  crosshair marks. The fleet can't be empty here — losing the last ship
   *  ends the encounter. */
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
    // loop keeps it paused until the node regenerates (BOSS.escortRegenMs).
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
