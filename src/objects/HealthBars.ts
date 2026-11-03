/**
 * HealthBars (#23) — the "how much is left" readout on a damaged enemy. A
 * short vertical pill just off the enemy's right (trailing) side, so it never
 * sits between the enemy and either seat. Its fill is centred and shrinks
 * toward the middle as hp drops, so the top and bottom seats see the same
 * picture (no reading, no up/down). An enemy at full hp shows no bar.
 *
 * One shared Graphics, cleared and redrawn every frame from whatever targets
 * the scene hands it: nothing is created per enemy, and a dead or parked
 * enemy is skipped from the next frame on. Generic over HealthBarTarget so
 * any enemy with hp can feed it. Shields, the boss's shield web and the
 * escorts' lock fins are not hp and never get a bar, and the boss keeps its own
 * HEALTH gauge (BossBars).
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import { HEALTH_BAR } from '../layout';
import type { HomingTarget } from './HomingTarget';

/** What a bar needs from an enemy: the HomingTarget shape (sprite, live/popping
 *  flags, radius) plus its hp. Asteroid satisfies it as-is, so the scene hands
 *  over its wrappers directly — nothing is copied or allocated per frame. */
export type HealthBarTarget = HomingTarget & {
  readonly hp: number;
  readonly maxHp: number;
};

/** A drawn bar: its centre and remaining fraction (the e2e healthBars() hook). */
export interface DrawnHealthBar {
  x: number;
  y: number;
  frac: number;
}

export class HealthBars {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly drawn: DrawnHealthBar[] = [];

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(HEALTH_BAR.depth);
  }

  /** Bars drawn on the latest frame. */
  get lastDrawn(): readonly DrawnHealthBar[] {
    return this.drawn;
  }

  /** Redraw: one bar per target that is damaged but still in play (a parked or
   *  popping target is skipped, so a killed enemy's bar goes the frame it dies). */
  draw(targets: Iterable<HealthBarTarget>): void {
    const g = this.g;
    g.clear();
    this.drawn.length = 0;
    const w = HEALTH_BAR.width;
    for (const t of targets) {
      if (!t.isActive || t.isPopping || t.hp >= t.maxHp) continue;
      const { x, y } = t.sprite;
      const frac = t.hp / t.maxHp;
      const h = Math.max(HEALTH_BAR.minHeight, t.radius * HEALTH_BAR.heightPerRadius);
      const left = x + t.radius + HEALTH_BAR.gap;
      const cx = left + w / 2;
      const top = y - h / 2;
      // Track.
      g.fillStyle(COLORS.lineDim, 0.35);
      g.fillRoundedRect(left, top, w, h, w / 2);
      g.lineStyle(1, COLORS.lineDim, 0.9);
      g.strokeRoundedRect(left, top, w, h, w / 2);
      // Centred fill: shrinks toward the middle from both ends.
      const fh = frac * h;
      g.fillStyle(COLORS.health, 0.95);
      g.fillRoundedRect(left, y - fh / 2, w, fh, Math.min(w / 2, fh / 2));
      this.drawn.push({ x: cx, y, frac });
    }
  }
}
