/**
 * draw.ts — Graphics stroke helpers for the seat controls (TwoThumbControl),
 * plus the static starfield both scenes draw behind everything.
 * Phaser Graphics has no native dash, so dashes are walked by hand; solid arcs
 * are one stroked path.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import { STARS } from '../layout';

/** The fixed starfield (STARS), one Graphics, drawn under everything else. */
export function drawStarfield(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(COLORS.star, 1);
  for (const star of STARS) g.fillCircle(star.x, star.y, star.r);
}

/** Solid arc (B35) as ONE stroked path — redrawn every frame while charging, so
 *  it avoids the per-segment lineBetween paths the dashed walk needs. An
 *  `endAngle` short of a full turn yields the partial (start→swept) fill. */
export function drawSolidArc(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): void {
  if (endAngle === startAngle) return;
  g.beginPath();
  g.arc(cx, cy, r, startAngle, endAngle, endAngle < startAngle);
  g.strokePath();
}

export function drawDashedLine(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(s + dash, len);
    g.lineBetween(x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e);
  }
}

/** Walks the arc by arc-length; each dash is short enough to draw straight. */
export function drawDashedArc(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  dash: number,
  gap: number
): void {
  const total = Math.abs(endAngle - startAngle) * r;
  const sign = Math.sign(endAngle - startAngle);
  for (let s = 0; s < total; s += dash + gap) {
    const e = Math.min(s + dash, total);
    const a0 = startAngle + (s / r) * sign;
    const a1 = startAngle + (e / r) * sign;
    g.lineBetween(
      cx + r * Math.cos(a0),
      cy + r * Math.sin(a0),
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1)
    );
  }
}

/** Homing lock ring (B14): glow fill + bold ring on the locked rock, so the
 *  lock clearly pops and is easy to track as it jumps between rocks. */
export function drawLockRing(
  g: Phaser.GameObjects.Graphics,
  lock: { x: number; y: number; r: number },
  color: number
): void {
  g.fillStyle(color, 0.22);
  g.fillCircle(lock.x, lock.y, lock.r);
  g.lineStyle(3.5, color, 1);
  g.strokeCircle(lock.x, lock.y, lock.r);
}
