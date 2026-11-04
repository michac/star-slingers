/**
 * draw.ts — Graphics stroke helpers for the seat controls (TwoThumbControl)
 * and the fleet textures, star corners for the icons, the enemy lane's static
 * band, and the small grey "that did nothing" spark a refused hit throws.
 * Phaser Graphics has no native dash, so dashes are walked by hand; solid arcs
 * are one stroked path.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { GAME_WIDTH, LANE } from '../layout';

/** The corners of an n-point star centred on (cx, cy), outer point first at
 *  the top, alternating outer and inner radius: fill or stroke them closed. */
export function starPoints(cx: number, cy: number, outer: number, inner: number, points: number): Phaser.Types.Math.Vector2Like[] {
  const out: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** The enemy lane (#19): a faint violet band with brighter top and bottom
 *  edges, so the players can see where enemies live. One static Graphics,
 *  drawn over the starfield and under everything else. */
export function drawLane(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(COLORS.shieldMid, STROKES.laneFill.alpha);
  g.fillRect(0, LANE.top, GAME_WIDTH, LANE.bottom - LANE.top);
  g.lineStyle(STROKES.laneEdge.width, COLORS.shieldMid, STROKES.laneEdge.alpha);
  g.lineBetween(0, LANE.top, GAME_WIDTH, LANE.top);
  g.lineBetween(0, LANE.bottom, GAME_WIDTH, LANE.bottom);
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

/** A hit that did nothing (an escort's duplicate lock, a plain shot on the
 *  giant asteroid): a small muted cross at (x, y) that pops and fades. A
 *  throwaway Graphics; its fade is a cosmetic tween. */
export function rejectSpark(scene: Phaser.Scene, x: number, y: number): void {
  const g = scene.add.graphics({ x, y }).setDepth(3);
  g.lineStyle(2, COLORS.chromeMuted, 0.75);
  g.lineBetween(-5, -5, 5, 5);
  g.lineBetween(-5, 5, 5, -5);
  scene.tweens.add({ targets: g, scale: 1.5, alpha: 0, duration: 100, onComplete: () => g.destroy() });
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
