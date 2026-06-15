/**
 * textures.ts — one-time procedural texture generation.
 * All shapes are drawn from tokens.ts colors; nothing is loaded from disk.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { BOSS_LAYOUT } from '../layout';
import { RADIUS_BY_HITS } from '../waves';

export const TEX = {
  rocketP1: 'rocket-p1',
  rocketP2: 'rocket-p2',
  /** One texture per distinct asteroid radius. */
  asteroid: (radius: number) => `asteroid-${radius}`,
  boss: 'boss', // B5 final boss core
  escort: 'escort', // B5 escort vessel — cyan shield ring + magenta core
  escortCore: 'escort-core', // B5 escort after its shield ring is knocked off
  heart: 'icon-heart', // B5 health-bar cap (white, tinted at use)
  bolt: 'icon-bolt', // B5 charge-bar cap (white, tinted at use)
  spark: 'px-spark', // B29 explosion: white dot → additive white-hot sparks
  shard: 'px-shard', // B29 explosion: dark rock chunk with a magenta edge
} as const;

/** Rocket diamond from the mock: M0,-9 L4,2 L0,5 L-4,2 Z (nose at -y). */
const ROCKET_POINTS = [
  { x: 0, y: -9 },
  { x: 4, y: 2 },
  { x: 0, y: 5 },
  { x: -4, y: 2 },
];
const ROCKET_W = 8;
const ROCKET_H = 14;

export function generateTextures(scene: Phaser.Scene): void {
  makeRocket(scene, TEX.rocketP1, COLORS.p1);
  makeRocket(scene, TEX.rocketP2, COLORS.p2);
  // Every toughness tier's radius up front — the solver can field any of
  // them in later waves.
  for (const radius of new Set(Object.values(RADIUS_BY_HITS))) {
    makeAsteroid(scene, radius);
  }
  makeBoss(scene);
  makeEscort(scene);
  makeHeart(scene);
  makeBolt(scene);
  makeSpark(scene);
  makeShard(scene);
}

function makeRocket(scene: Phaser.Scene, key: string, color: number): void {
  // Textures live on the Game, not the scene — regenerating after a
  // scene.restart() would warn "key already in use".
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(color, 1);
  // Shift the path's (-4,-9)..(4,5) box into texture space.
  g.fillPoints(
    ROCKET_POINTS.map((p) => new Phaser.Geom.Point(p.x + 4, p.y + 9)),
    true
  );
  g.generateTexture(key, ROCKET_W, ROCKET_H);
  g.destroy();
}

/**
 * Texture is exactly 2r x 2r with the rock centered, so the physics body is
 * just body.setCircle(r) — no offset bookkeeping.
 */
function makeAsteroid(scene: Phaser.Scene, r: number): void {
  if (scene.textures.exists(TEX.asteroid(r))) return; // survives scene.restart()
  const g = scene.make.graphics({}, false);
  // Dark interior fill so the rock reads as a solid body, not a ring.
  g.fillStyle(COLORS.rockFill, 1);
  g.fillCircle(r, r, r - STROKES.rock.width / 2);
  // Stroke is centered on the path, so pull the radius in by half the
  // line width to keep the outer edge inside the 2r x 2r canvas.
  g.lineStyle(STROKES.rock.width, COLORS.danger, 1);
  g.strokeCircle(r, r, r - STROKES.rock.width / 2);
  // Craters at the mock's proportions (r=21 rock: craters (-6,-5,5) & (8,4,4)).
  g.lineStyle(STROKES.crater.width, COLORS.crater, 1);
  g.strokeCircle(r - 0.29 * r, r - 0.24 * r, 0.24 * r);
  if (r >= 15) {
    g.strokeCircle(r + 0.38 * r, r + 0.19 * r, 0.19 * r);
  }
  g.generateTexture(TEX.asteroid(r), r * 2, r * 2);
  g.destroy();
}

/**
 * Final-boss core (B5): a menacing 2r x 2r disc — dark body, a heavy danger
 * ring, an inner accent "eye", and a couple of plate details. Drawn in the
 * enemy palette; the encounter tints it muted while invulnerable and clears
 * the tint (full color) once vulnerable. Charge glow + beam are drawn live by
 * Boss.ts, not baked here.
 */
function makeBoss(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.boss)) return;
  const r = BOSS_LAYOUT.radius;
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLORS.rockFill, 1);
  g.fillCircle(r, r, r - STROKES.rock.width / 2);
  g.lineStyle(STROKES.rock.width + 1.5, COLORS.danger, 1); // heavier than a rock
  g.strokeCircle(r, r, r - (STROKES.rock.width + 1.5) / 2);
  // Inner ring + glowing eye.
  g.lineStyle(STROKES.crater.width, COLORS.crater, 1);
  g.strokeCircle(r, r, r * 0.62);
  g.fillStyle(COLORS.accent, 1);
  g.fillCircle(r, r, r * 0.26);
  g.fillStyle(COLORS.hullWindow, 0.9);
  g.fillCircle(r, r, r * 0.12);
  // Two plate vents flanking the eye, for menace.
  g.fillStyle(COLORS.danger, 0.9);
  g.fillCircle(r - r * 0.5, r, r * 0.1);
  g.fillCircle(r + r * 0.5, r, r * 0.1);
  g.generateTexture(TEX.boss, r * 2, r * 2);
  g.destroy();
}

/**
 * Escort vessel (B5): a magenta core inside a cyan shield ring — the "shield
 * then core" two-hit read (first hit knocks the cyan ring off, second pops the
 * core). Two textures on the SAME 2R x 2R canvas (R = outer shield radius) so
 * swapping to the core texture mid-fight never shifts the body. The cyan ring
 * deliberately echoes the boss's own invulnerable shield ring.
 */
function makeEscort(scene: Phaser.Scene): void {
  const R = BOSS_LAYOUT.escort.radius; // outer shield radius (canvas half)
  const core = BOSS_LAYOUT.escort.coreRadius;
  const drawCore = (g: Phaser.GameObjects.Graphics) => {
    g.fillStyle(COLORS.rockFill, 1);
    g.fillCircle(R, R, core - STROKES.rock.width / 2);
    g.lineStyle(STROKES.rock.width, COLORS.danger, 1);
    g.strokeCircle(R, R, core - STROKES.rock.width / 2);
    g.fillStyle(COLORS.accent, 1);
    g.fillCircle(R, R, core * 0.42);
  };

  if (!scene.textures.exists(TEX.escort)) {
    const g = scene.make.graphics({}, false);
    g.lineStyle(STROKES.shield.width, COLORS.shieldOuter, STROKES.shield.alpha);
    g.strokeCircle(R, R, R - STROKES.shield.width / 2); // the cyan shield ring
    drawCore(g);
    g.generateTexture(TEX.escort, R * 2, R * 2);
    g.destroy();
  }
  if (!scene.textures.exists(TEX.escortCore)) {
    const g = scene.make.graphics({}, false);
    drawCore(g); // same canvas, ring area transparent
    g.generateTexture(TEX.escortCore, R * 2, R * 2);
    g.destroy();
  }
}

/** Heart icon (B5 health-bar cap): two lobes + a point, drawn white to tint. */
function makeHeart(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.heart)) return;
  const s = BOSS_LAYOUT.bars.iconSize;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(s * 0.3, s * 0.32, s * 0.22); // left lobe
  g.fillCircle(s * 0.7, s * 0.32, s * 0.22); // right lobe
  g.fillPoints(
    [
      new Phaser.Geom.Point(s * 0.08, s * 0.4),
      new Phaser.Geom.Point(s * 0.92, s * 0.4),
      new Phaser.Geom.Point(s * 0.5, s * 0.96),
    ],
    true
  );
  g.generateTexture(TEX.heart, s, s);
  g.destroy();
}

/** Spark dot (B29 explosion): a soft white circle → additive white-hot sparks. */
function makeSpark(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.spark)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture(TEX.spark, 8, 8);
  g.destroy();
}

/** Rock shard (B29 explosion): a dark rock-fill triangle with the rock's
 *  magenta edge — a flung-off chunk of the asteroid. */
function makeShard(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.shard)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLORS.rockFill, 1);
  g.fillTriangle(1, 12, 7, 1, 13, 10);
  g.lineStyle(1.5, COLORS.danger, 1);
  g.strokeTriangle(1, 12, 7, 1, 13, 10);
  g.generateTexture(TEX.shard, 14, 14);
  g.destroy();
}

/** Lightning-bolt icon (B5 charge-bar cap): a zigzag, drawn white to tint. */
function makeBolt(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.bolt)) return;
  const s = BOSS_LAYOUT.bars.iconSize;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1);
  g.fillPoints(
    [
      new Phaser.Geom.Point(s * 0.58, 0),
      new Phaser.Geom.Point(s * 0.2, s * 0.55),
      new Phaser.Geom.Point(s * 0.45, s * 0.55),
      new Phaser.Geom.Point(s * 0.34, s),
      new Phaser.Geom.Point(s * 0.82, s * 0.4),
      new Phaser.Geom.Point(s * 0.54, s * 0.4),
    ],
    true
  );
  g.generateTexture(TEX.bolt, s, s);
  g.destroy();
}
