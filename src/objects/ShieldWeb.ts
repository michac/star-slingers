/**
 * ShieldWeb (B34) — the escorts' physical, rotating diamond barrier. A link
 * exists only while both adjacent escort nodes are live; its absence is the
 * literal gap the team fires through.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import type { Escort } from './Escort';

type Link = { ax: number; ay: number; bx: number; by: number };

export class ShieldWeb {
  private readonly art: Phaser.GameObjects.Graphics;
  private links: Link[] = [];
  private elapsed = 0;

  constructor(scene: Phaser.Scene, private readonly width: number) {
    this.art = scene.add.graphics().setDepth(1.5);
  }

  update(deltaMs: number, escorts: readonly Escort[]): void {
    this.elapsed += deltaMs;
    this.links = [];
    for (let i = 0; i < escorts.length; i++) {
      const a = escorts[i];
      const b = escorts[(i + 1) % escorts.length];
      if (!a.isActive || !b.isActive) continue;
      this.links.push({ ax: a.sprite.x, ay: a.sprite.y, bx: b.sprite.x, by: b.sprite.y });
    }
    const pulse = 0.72 + 0.28 * Math.sin(this.elapsed * 0.006);
    const g = this.art.clear();
    for (const link of this.links) {
      g.lineStyle(this.width + 4, COLORS.shieldOuter, 0.12 * pulse);
      g.lineBetween(link.ax, link.ay, link.bx, link.by);
      g.lineStyle(this.width, COLORS.shieldMid, 0.9 * pulse);
      g.lineBetween(link.ax, link.ay, link.bx, link.by);
    }
  }

  /** True when the rocket's swept center (previous frame's center → now) comes
   * within the rocket's half-size + the web's half-width of a live link, i.e.
   * the drawn rocket touches the drawn stroke. The sweep keeps a high-speed shot
   * from slipping between adjacent Arcade physics frames. */
  blocks(rocket: Phaser.Physics.Arcade.Sprite): boolean {
    const body = rocket.body as Phaser.Physics.Arcade.Body;
    // body.prev is the body's previous TOP-LEFT; shift it to the previous center.
    const px = body.prev.x + body.halfWidth, py = body.prev.y + body.halfHeight;
    const r = Math.max(rocket.displayWidth, rocket.displayHeight) / 2; // blocksSegment adds the web's half-width
    return this.blocksSegment(px, py, rocket.x, rocket.y, r);
  }

  /** True when the segment a→b, thickened by `sweptRadius`, touches a live
   * link's drawn stroke. Adds the web's half-width itself; callers pass only
   * the swept object's own radius. */
  blocksSegment(ax: number, ay: number, bx: number, by: number, sweptRadius = 0): boolean {
    const r = sweptRadius + this.width / 2;
    return this.links.some((link) => segmentsWithin(ax, ay, bx, by, link.ax, link.ay, link.bx, link.by, r));
  }

  get count(): number {
    return this.links.length;
  }

  /** DEV/test read: this frame's live link segments and the web's width.
   * update() builds a fresh links array each frame, so no copy is needed. */
  get segments(): { width: number; links: readonly Link[] } {
    return { width: this.width, links: this.links };
  }
}

/** Minimum distance between two finite 2D segments, squared-free at the call
 * site. Phaser has line/circle helpers, but this covers a swept rocket vs a
 * finite shield segment without depending on overlap ordering. */
function segmentsWithin(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, r: number): boolean {
  if (intersects(ax, ay, bx, by, cx, cy, dx, dy)) return true;
  const rr = r * r;
  return pointSegmentSq(ax, ay, cx, cy, dx, dy) <= rr || pointSegmentSq(bx, by, cx, cy, dx, dy) <= rr || pointSegmentSq(cx, cy, ax, ay, bx, by) <= rr || pointSegmentSq(dx, dy, ax, ay, bx, by) <= rr;
}

function pointSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
  const ex = px - (ax + dx * t), ey = py - (ay + dy * t);
  return ex * ex + ey * ey;
}

function intersects(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const a = cross(ax, ay, bx, by, cx, cy), b = cross(ax, ay, bx, by, dx, dy);
  const c = cross(cx, cy, dx, dy, ax, ay), d = cross(cx, cy, dx, dy, bx, by);
  return a * b <= 0 && c * d <= 0;
}
