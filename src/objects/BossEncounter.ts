/**
 * BossEncounter (B5) — orchestrates the finale that replaces the wave-4 victory
 * seam. Owns the Boss + 4 orbiting Escorts and a repeating, urgent CYCLE:
 *
 *   idle → charging ⇄ exposed → won | lost
 *
 *   CHARGING: escorts orbit, boss shielded + invulnerable, charge bar fills.
 *     · clear all 4 escorts before it fills → EXPOSED (cancel the shot)
 *     · charge fills first → boss FIRES (−1 shield ring), straight back to CHARGING
 *   EXPOSED: boss vulnerable for `exposedMs` — shoot it (HP ticks). Window ends →
 *     escorts respawn, boss re-shields → CHARGING.
 *   won: boss HP 0 (chipped across windows) · lost: a fired charge with no shield left.
 *
 * Boss + escort sprites are created ONCE here (parked) so the scene's
 * rocket↔boss overlap collider — built once over `sprites` — never points at a
 * recreated body (same discipline as the asteroid wrappers).
 */
import Phaser from 'phaser';
import { BOSS_LAYOUT } from '../layout';
import { BOSS } from '../waves';
import { Boss } from './Boss';
import { BossBars } from './BossBars';
import { Escort } from './Escort';
import { Station } from './Station';
import { Overlay } from './Overlay';
import type { HomingTarget } from './HomingTarget';

type BossPhase = 'idle' | 'charging' | 'exposed' | 'won' | 'lost';

export class BossEncounter {
  private readonly boss: Boss;
  private readonly bars: BossBars;
  private readonly escorts: Escort[];
  private phaseState: BossPhase = 'idle';
  private gateRemaining = BOSS.escortCount;
  private timer = 0; // ms within the current charging/exposed phase
  private orbitAngle = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly station: Station,
    private readonly failOverlay: Overlay,
    private readonly victoryOverlay: Overlay
  ) {
    this.boss = new Boss(scene, () => this.onDefeated());
    this.bars = new BossBars(scene);
    this.escorts = Array.from(
      { length: BOSS.escortCount },
      () => new Escort(scene, () => this.onEscortDestroyed())
    );
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
    if (this.phaseState !== 'charging' && this.phaseState !== 'exposed') return;
    this.orbitAngle += Phaser.Math.DegToRad(BOSS_LAYOUT.escort.orbitSpeedDeg) * (deltaMs / 1000);
    this.placeEscorts();
    this.boss.update();

    if (this.phaseState === 'charging') {
      if (!this.boss.isEntered) {
        // hold the charge until the slide-in ends (timer stays 0)
      } else if (this.gateRemaining <= 0) {
        this.enterExposed(); // cleared in time — open the window
      } else {
        this.timer += deltaMs;
        if (this.timer >= BOSS.chargeMs) this.bossFires();
      }
    } else {
      this.timer += deltaMs;
      if (this.timer >= BOSS.exposedMs) this.startCharge(); // window over → re-shield
    }
    this.drawBars();
  }

  /** Feed the off-boss HEALTH + CHARGE gauges from current state (the charge
   *  fraction is derived from the live timer, so the existing `timer = 0` resets
   *  on escort kills / clears reset the bar for free). */
  private drawBars(): void {
    const charging = this.phaseState === 'charging' && this.boss.isEntered;
    this.bars.update({
      hp: this.boss.currentHp,
      maxHp: BOSS.hp,
      chargeFrac: charging ? this.timer / BOSS.chargeMs : 0,
      visible:
        (this.phaseState === 'charging' || this.phaseState === 'exposed') && this.boss.isEntered,
    });
  }

  /** Hittable targets for homing (B14): live escorts while charging, the boss
   *  while exposed — so the 5yo's homing keeps working through the finale. */
  homingTargets(): HomingTarget[] {
    if (this.phaseState === 'charging') return this.escorts.filter((e) => e.isActive);
    if (this.phaseState === 'exposed') return [this.boss];
    return [];
  }

  /** DEV/test: instantly destroy escort i (used by __debug.killEscort). */
  killEscort(i: number): void {
    const e = this.escorts[i];
    if (!e) return;
    for (let n = 0; n < BOSS.escortHits && e.isActive; n++) e.takeHit();
  }

  /** Begin (or restart) a charge cycle: re-shield, respawn all 4 escorts. */
  private startCharge(): void {
    this.phaseState = 'charging';
    this.timer = 0;
    this.gateRemaining = BOSS.escortCount;
    this.boss.shield();
    for (const e of this.escorts) e.activate();
    this.placeEscorts();
  }

  private enterExposed(): void {
    this.phaseState = 'exposed';
    this.timer = 0;
    this.boss.expose();
  }

  private bossFires(): void {
    this.boss.fireBeam();
    if (this.station.onEnemyReached() === 'destroyed') {
      this.phaseState = 'lost';
      this.bars.update({ hp: 0, maxHp: BOSS.hp, chargeFrac: 0, visible: false });
      this.scene.physics.pause(); // freeze the field behind the card
      this.failOverlay.show();
      return;
    }
    // Missed the clear — you take the ring, but the SURVIVING escorts stay
    // (only a full clear + the exposed window respawns them). Just reset the
    // charge and keep going; the boss can fire again on the same escort set.
    this.timer = 0;
  }

  private placeEscorts(): void {
    const { x: bx, y: by } = this.boss.sprite;
    const step = (Math.PI * 2) / this.escorts.length;
    const r = BOSS_LAYOUT.escort.orbitRadius;
    this.escorts.forEach((e, i) => {
      if (!e.isActive) return;
      const a = this.orbitAngle + i * step;
      e.place(bx + Math.cos(a) * r, by + Math.sin(a) * r);
    });
  }

  private onEscortDestroyed(): void {
    this.gateRemaining -= 1; // the charging branch polls this to open the window
    // Each kill resets the charge — steadily clearing escorts keeps the boss
    // from ever firing; you only get shot if you stall.
    this.timer = 0;
  }

  private onDefeated(): void {
    this.phaseState = 'won';
    this.bars.update({ hp: 0, maxHp: BOSS.hp, chargeFrac: 0, visible: false });
    this.victoryOverlay.show();
  }
}
