/**
 * specials.ts — what a seat's SPECIAL button can fire (#22) and the upgrades
 * that add to it (#26). A seat owns a list of special MODES (the homing missile
 * always, plus every upgrade it has picked from a boss's pods) and fires the
 * CURRENT one; an upward swipe on SPECIAL rotates to the next
 * (TwoThumbControl). The button, its rotation carousel, the HUD's special row
 * and the pods all draw their icons from this table.
 *
 *  - missile: one homing missile (#22).
 *  - triple: three homing missiles in a small fan, one ammo (#26 D7).
 *  - detonator: a straight bomb; the next SPECIAL press blows it up (#26 D8).
 *    While it flies, the button shows `drawDetonateIcon` instead.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';

export type SpecialKind = 'missile' | 'triple' | 'detonator';

export interface SpecialDef {
  /** Code-drawn icon centred on (cx, cy), fitting a circle of radius r. */
  drawIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number): void;
}

/** The seat's special at boot, and always its first mode. */
export const DEFAULT_SPECIAL: SpecialKind = 'missile';

/** A small rocket, nose along −y in its local frame, rotated by `angle`
 *  (clockwise) and scaled by `s`, with its origin at (ox, oy). */
function drawRocket(g: Phaser.GameObjects.Graphics, ox: number, oy: number, r: number, angle: number, s: number, color: number): (x: number, y: number) => { x: number; y: number } {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const pt = (x: number, y: number) => ({ x: ox + (x * cos - y * sin) * r * s, y: oy + (x * sin + y * cos) * r * s });
  const tri = (p: [number, number], q: [number, number], t: [number, number]) => {
    const P = pt(...p), Q = pt(...q), T = pt(...t);
    g.fillTriangle(P.x, P.y, Q.x, Q.y, T.x, T.y);
  };
  const w = 0.15;
  g.fillStyle(color, 1);
  tri([0, -0.62], [-w, -0.3], [w, -0.3]); // nose
  tri([-w, -0.3], [w, -0.3], [w, 0.2]); // body (two triangles)
  tri([-w, -0.3], [w, 0.2], [-w, 0.2]);
  tri([-w, -0.02], [-w * 2.3, 0.28], [-w, 0.2]); // fins
  tri([w, -0.02], [w * 2.3, 0.28], [w, 0.2]);
  return pt;
}

export const SPECIALS: Record<SpecialKind, SpecialDef> = {
  /** A small rocket banking up and to the right, trailing a curved dotted
   *  path behind it: "this one turns". Distinct from FIRE's upright rocket. */
  missile: {
    drawIcon(g, cx, cy, r, color) {
      // Nudged so the trail fits too; rotated 45° clockwise (pointing up-right).
      const pt = drawRocket(g, cx + r * 0.08, cy - r * 0.08, r, Math.PI / 4, 1, color);
      // Curved dotted trail, bending away below the tail.
      g.fillStyle(COLORS.charge, 0.9);
      const trail: [number, number, number][] = [[0, 0.36, 0.09], [-0.12, 0.54, 0.075], [-0.32, 0.66, 0.06]];
      for (const [x, y, d] of trail) {
        const P = pt(x, y);
        g.fillCircle(P.x, P.y, Math.max(1, d * r));
      }
    },
  },

  /** Three small rockets fanned out from one point below: "three at once". */
  triple: {
    drawIcon(g, cx, cy, r, color) {
      const s = 0.62;
      const spread = Phaser.Math.DegToRad(34);
      const fx = cx, fy = cy + r * 0.5; // the fan's hub, low in the icon
      for (const a of [-spread, 0, spread]) {
        // Rocket origin out along its heading, so its fins sit near the hub.
        const d = r * (0.28 * s + 0.12);
        drawRocket(g, fx + Math.sin(a) * d, fy - Math.cos(a) * d, r, a, s, color);
      }
    },
  },

  /** A round bomb with a short fuse and a spark: "it goes boom later". */
  detonator: {
    drawIcon(g, cx, cy, r, color) {
      const bx = cx - r * 0.1, by = cy + r * 0.12, br = r * 0.42;
      g.fillStyle(color, 1);
      g.fillCircle(bx, by, br);
      // Fuse cap and fuse, up and to the right.
      const capX = bx + br * 0.62, capY = by - br * 0.62;
      g.fillRect(capX - r * 0.08, capY - r * 0.08, r * 0.16, r * 0.16);
      g.lineStyle(Math.max(1.5, r * 0.08), color, 1);
      g.lineBetween(capX, capY, capX + r * 0.18, capY - r * 0.2);
      // The spark: a small white-hot star with violet glints.
      const sx = capX + r * 0.24, sy = capY - r * 0.28;
      g.fillStyle(COLORS.charge, 0.9);
      drawStar(g, sx, sy, r * 0.22, r * 0.08, 6);
      g.fillStyle(COLORS.white, 1);
      g.fillCircle(sx, sy, Math.max(1, r * 0.06));
    },
  },
};

/** A filled n-point star centred on (cx, cy). */
function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, outer: number, inner: number, points: number): void {
  for (let i = 0; i < points; i++) {
    const a0 = (i / points) * Math.PI * 2 - Math.PI / 2;
    const a1 = a0 + Math.PI / points;
    const am = a0 - Math.PI / points;
    g.fillTriangle(
      cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer,
      cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner,
      cx + Math.cos(am) * inner, cy + Math.sin(am) * inner
    );
  }
  g.fillCircle(cx, cy, inner);
}

/** The SPECIAL button's face while the seat's detonator bomb is in flight: a
 *  starburst, "press to blow it up". */
export function drawDetonateIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number): void {
  g.fillStyle(color, 1);
  drawStar(g, cx, cy, r * 0.62, r * 0.26, 8);
  g.fillStyle(COLORS.white, 1);
  g.fillCircle(cx, cy, r * 0.16);
}
