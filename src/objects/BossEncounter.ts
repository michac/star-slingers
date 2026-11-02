/**
 * BossEncounter (B5) — orchestrates the finale that replaces the wave-4 victory
 * seam. Owns the Boss + 4 orbiting Escorts and a repeating, urgent CYCLE:
 *
 *   idle → charging → won | lost
 *
 *   CHARGING: live adjacent escorts make a physical shield web. Destroying a
 *   node opens two gaps for BOSS.escortRegenMs and resets + pauses the charge;
 *   railguns can hit the boss only if they physically pass through a gap.
 *   won: boss HP 0 · lost: a fired charge with no shield left.
 *
 * Boss + escort sprites are created ONCE here (parked) so the scene's
 * rocket↔boss overlap collider — built once over `sprites` — never points at a
 * recreated body (same discipline as the asteroid wrappers).
 */
import Phaser from 'phaser';
import { BOSS_LAYOUT, STATION } from '../layout';
import { BOSS } from '../waves';
import { Boss } from './Boss';
import { BossBars } from './BossBars';
import { Escort } from './Escort';
import { ShieldWeb } from './ShieldWeb';
import { Station } from './Station';
import { Overlay } from './Overlay';
import type { HomingTarget } from './HomingTarget';
import type { PlayerId } from './Rocket';

type BossPhase = 'idle' | 'charging' | 'won' | 'lost';

const NO_TARGETS: readonly HomingTarget[] = [];

export class BossEncounter {
  private readonly boss: Boss;
  private readonly bars: BossBars;
  private readonly escorts: Escort[];
  private readonly web: ShieldWeb;
  private phaseState: BossPhase = 'idle';
  private timer = 0; // ms of charge accrued toward BOSS.chargeMs
  private orbitAngle = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly station: Station,
    private readonly failOverlay: Overlay,
    private readonly victoryOverlay: Overlay,
    /** Seats in play (?players): solo relaxes the escort co-op lock (Escort.takeHit). */
    players: 1 | 2
  ) {
    this.boss = new Boss(scene, () => this.onDefeated());
    this.bars = new BossBars(scene);
    this.escorts = Array.from(
      { length: BOSS.escortCount },
      () => new Escort(scene, () => this.onEscortDestroyed(), players === 1)
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

  /** Called by the WaveDirector's run-cleared seam (after wave 4). */
  start(): void {
    if (this.phaseState !== 'idle') return;
    this.station.setShieldRegenMs(BOSS.shieldRegenMs);
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
  }

  /** Homing is an escort aid only — the boss stays railgun-only. Callers
   *  filter on isActive/isPopping, so this hands back the pooled list as-is. */
  homingTargets(): readonly HomingTarget[] {
    return this.phaseState === 'charging' ? this.escorts : NO_TARGETS;
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

  private bossFires(): void {
    this.boss.fireBeam();
    if (this.station.onEnemyReached() === 'destroyed') {
      this.phaseState = 'lost';
      this.drawBars(); // hides them
      this.scene.physics.pause(); // freeze the field behind the card
      this.failOverlay.show();
      return;
    }
    // You take the ring; the web stays as-is. Reset the charge and keep going.
    this.timer = 0;
  }

  private placeEscorts(): void {
    const { x: bx, y: by } = this.boss.sprite;
    const step = (Math.PI * 2) / this.escorts.length;
    const r = BOSS_LAYOUT.escort.formationRadius;
    this.escorts.forEach((e, i) => {
      if (!e.isActive) return;
      const a = this.orbitAngle + i * step;
      e.place(bx + Math.cos(a) * r, by + Math.sin(a) * r, STATION.cx, STATION.cy);
    });
  }

  private onEscortDestroyed(): void {
    // A kill opens two adjacent web links and resets the charge; the update
    // loop keeps it paused until the node regenerates (BOSS.escortRegenMs).
    this.timer = 0;
  }

  private onDefeated(): void {
    this.phaseState = 'won';
    this.drawBars(); // hides them
    this.victoryOverlay.show();
  }
}
