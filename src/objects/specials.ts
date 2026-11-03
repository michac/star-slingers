/**
 * specials.ts — what a seat's SPECIAL button can fire (#22). Each seat has a
 * CURRENT special (`TwoThumbControl.special` + `PlayerHud.special`, set together
 * by the scene's `setSpecial`); both draw their icon from this table, so an
 * upgrade (#26) swaps the icon by adding a kind here and changing that field.
 * The homing missile is the only special today.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';

export type SpecialKind = 'missile';

export interface SpecialDef {
  /** Code-drawn icon centred on (cx, cy), fitting a circle of radius r. */
  drawIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number): void;
}

/** The seat's special at boot. */
export const DEFAULT_SPECIAL: SpecialKind = 'missile';

export const SPECIALS: Record<SpecialKind, SpecialDef> = {
  /** A small rocket banking up and to the right, trailing a curved dotted
   *  path behind it: "this one turns". Distinct from FIRE's upright rocket. */
  missile: {
    drawIcon(g, cx, cy, r, color) {
      // Local frame: nose toward −y, then rotated 45° clockwise (pointing up-right).
      const a = Math.PI / 4;
      const cos = Math.cos(a), sin = Math.sin(a);
      const ox = cx + r * 0.08, oy = cy - r * 0.08; // nudge so the trail fits too
      const pt = (x: number, y: number) => ({ x: ox + (x * cos - y * sin) * r, y: oy + (x * sin + y * cos) * r });
      const tri = (p: [number, number], q: [number, number], s: [number, number]) => {
        const P = pt(...p), Q = pt(...q), S = pt(...s);
        g.fillTriangle(P.x, P.y, Q.x, Q.y, S.x, S.y);
      };
      const w = 0.15;
      g.fillStyle(color, 1);
      tri([0, -0.62], [-w, -0.3], [w, -0.3]); // nose
      tri([-w, -0.3], [w, -0.3], [w, 0.2]); // body (two triangles)
      tri([-w, -0.3], [w, 0.2], [-w, 0.2]);
      tri([-w, -0.02], [-w * 2.3, 0.28], [-w, 0.2]); // fins
      tri([w, -0.02], [w * 2.3, 0.28], [w, 0.2]);
      // Curved dotted trail, bending away below the tail.
      g.fillStyle(COLORS.charge, 0.9);
      const trail: [number, number, number][] = [[0, 0.36, 0.09], [-0.12, 0.54, 0.075], [-0.32, 0.66, 0.06]];
      for (const [x, y, d] of trail) {
        const P = pt(x, y);
        g.fillCircle(P.x, P.y, Math.max(1, d * r));
      }
    },
  },
};
