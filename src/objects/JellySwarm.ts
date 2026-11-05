/**
 * JellySwarm (#28) — act 3's space jellies: the monster waves (7–8) and the
 * mother jelly's babies (wave 9), one pool alive for the whole run (the
 * scene's rocket↔jelly collider is built once over `jellies`).
 *
 * A monster wave (MonsterWaveConfig in waves.ts) fields `onScreen` jellies at
 * once from a `quota`; each one gone (killed, or reached the fleet) is
 * replaced from what's left, entering just off the right edge at a random
 * height in the lane, staggered so they don't arrive stacked. The wave is
 * clear (isClear) once the quota is spent and the last jelly has popped.
 *
 * During the boss the MotherJelly releases babies through releaseBabies, and
 * her pop takes every baby still in flight with her (popAll).
 *
 * Each jelly swims at the NEAREST live fleet ship (#19, #28: re-picked as it
 * goes); one that reaches its ship hits it like a rock, and the one that takes
 * the fleet's last ship calls onFleetLost (the scene's fail card). Jellies
 * draw their heal halos into one shared Graphics.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, JELLY_LAYOUT, LANE, MOTHER_LAYOUT, SCORE } from '../layout';
import { COLORS } from '../tokens';
import { JELLY, type MonsterWaveConfig } from '../waves';
import type { Fleet } from './Fleet';
import { Jelly, type JellyKind, type JellyOrders } from './Jelly';

/** A mother jelly's baby: small, quick, one hit, no heal (#28 gap-fill). */
const BABY_JELLY: JellyKind = {
  radius: JELLY_LAYOUT.babyRadius,
  maxHp: 1,
  speed: JELLY_LAYOUT.babySpeed,
  healPauseMs: 0,
  healFullMs: 0,
  score: SCORE.babyJelly,
};

/** A monster wave's jelly: JELLY.hp, healing on the wave's timing. */
export function waveJelly(config: MonsterWaveConfig): JellyKind {
  return {
    radius: JELLY_LAYOUT.radius,
    maxHp: JELLY.hp,
    speed: JELLY_LAYOUT.cruiseSpeed,
    healPauseMs: config.healPauseMs,
    healFullMs: config.healFullMs,
    score: SCORE.jelly,
  };
}

export class JellySwarm {
  /** The jelly pool (parked when not in play). The scene's collider, the
   *  missile picker, the detonator's blast and the health bars go over it. */
  readonly jellies: Jelly[];
  private readonly halos: Phaser.GameObjects.Graphics;
  /** The live monster wave's jelly (null between waves: no spawns). */
  private kind: JellyKind | null = null;
  private quotaRemaining = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly fleet: Fleet,
    boom: (x: number, y: number, r: number) => void,
    /** A jelly took the fleet's last ship. */
    private readonly onFleetLost: () => void
  ) {
    const orders: JellyOrders = {
      pickTarget: (_x, y) => this.fleet.nearestLive(y),
      targetPoint: (i) => this.fleet.shipPoint(i),
      contactX: (i) => this.fleet.contactX(i),
      reached: (i) => this.fleet.onEnemyReached(i),
      onGone: () => this.spawn(),
      boom,
    };
    this.jellies = Array.from({ length: JELLY_LAYOUT.poolSize }, () => new Jelly(scene, orders));
    this.halos = scene.add.graphics().setDepth(2.2);
  }

  /** A monster wave starts: field its first jellies. */
  start(config: MonsterWaveConfig): void {
    this.stop();
    this.kind = waveJelly(config);
    this.quotaRemaining = config.quota;
    for (let i = 0; i < config.onScreen; i++) this.spawn();
  }

  /** Off the field at once: every jelly, and no more spawns (a wave jump, or
   *  a forced clear). */
  stop(): void {
    this.kind = null;
    this.quotaRemaining = 0;
    for (const jelly of this.jellies) jelly.vanish();
    this.halos.clear();
  }

  /** The quota is spent and no jelly is in play (or popping). True when idle. */
  get isClear(): boolean {
    return this.quotaRemaining === 0 && this.jellies.every((j) => j.phase === 'parked');
  }

  update(deltaMs: number): void {
    for (const jelly of this.jellies) {
      if (jelly.update(deltaMs) === 'fleetLost') {
        this.onFleetLost();
        return;
      }
    }
    this.drawHalos();
  }

  /** The mother jelly releases n babies from (x, y), fanned up and down.
   *  Returns how many it fielded (fewer if the pool is full). */
  releaseBabies(x: number, y: number, n: number): number {
    const free = this.jellies.filter((j) => j.phase === 'parked');
    const count = Math.min(n, free.length); // a full pool skips the rest
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const by = Phaser.Math.Clamp(y + (2 * t - 1) * MOTHER_LAYOUT.releaseSpreadY, LANE.top + BABY_JELLY.radius, LANE.bottom - BABY_JELLY.radius);
      free[i].field(x, by, BABY_JELLY);
    }
    return count;
  }

  /** Pop every jelly in play as a kill (the mother's pop): `onKill` gets each
   *  one's points and where it was. */
  popAll(onKill: (pts: number, x: number, y: number) => void): void {
    for (const jelly of this.jellies) {
      const { x, y } = jelly.sprite;
      const pts = jelly.popNow();
      if (pts > 0) onKill(pts, x, y);
    }
  }

  /** Field the next wave jelly from the quota, if there's one left and a free
   *  wrapper (every jelly gone calls this, so a wave refills itself). */
  private spawn(): void {
    const kind = this.kind;
    if (!kind || this.quotaRemaining <= 0) return;
    const jelly = this.jellies.find((j) => j.phase === 'parked');
    if (!jelly) return;
    this.quotaRemaining -= 1;
    const r = kind.radius;
    const x = GAME_WIDTH + r + Phaser.Math.FloatBetween(0, JELLY_LAYOUT.entryGapMax);
    jelly.field(x, Phaser.Math.FloatBetween(LANE.top + r, LANE.bottom - r), kind);
  }

  /** A green ring round every jelly that's healing (#28: the health colour). */
  private drawHalos(): void {
    const g = this.halos.clear();
    const { pad, width, alpha } = JELLY_LAYOUT.halo;
    g.lineStyle(width, COLORS.health, alpha);
    for (const jelly of this.jellies) {
      if (jelly.healing) g.strokeCircle(jelly.sprite.x, jelly.sprite.y, jelly.radius + pad);
    }
  }
}
