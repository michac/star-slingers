/**
 * textures.ts — one-time procedural texture generation.
 * All shapes are drawn from tokens.ts colors; nothing is loaded from disk.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { BOSS_LAYOUT, FLEET, GAME_HEIGHT, GAME_WIDTH, GIANT_LAYOUT, STARFIELD } from '../layout';
import { drawDashedLine } from './draw';
import type { AsteroidKind } from '../waves';

export const TEX = {
  rocketP1: 'rocket-p1',
  rocketP2: 'rocket-p2',
  /** One texture per asteroid kind and radius (a tough rock has its own shade). */
  asteroid: (kind: AsteroidKind, radius: number) => `asteroid-${kind}-${radius}`,
  giantAsteroid: 'asteroid-giant', // #25 act 1's boss
  boss: 'boss', // B34 directional command ship
  escort: 'escort-both-locks', // B33 escort ship with both player locks
  escortP1Lock: 'escort-p1-lock', // cyan lock remains
  escortP2Lock: 'escort-p2-lock', // amber lock remains
  heart: 'icon-heart', // B5 health-bar cap (white, tinted at use)
  bolt: 'icon-bolt', // B5 charge-bar cap (white, tinted at use)
  spark: 'px-spark', // B29 explosion: white dot → additive white-hot sparks
  shard: 'px-shard', // B29 explosion: dark rock chunk with a magenta edge
  fleetShip: 'fleet-ship', // #19 colony ship (hull, windows, pod, bridge, engine flame)
  fleetShipLost: 'fleet-ship-lost', // #19 a lost ship's faint dashed outline
  /** One tiling texture per starfield layer (#19), index into STARFIELD.layers. */
  starLayer: (i: number) => `star-layer-${i}`,
} as const;

/** Where a ship's local origin (left wall, sublane centre) sits inside the
 *  fleet-ship textures, and their size: the bounding box of the hull and the
 *  flame, plus room for the hull stroke. Fleet sets the image origin from
 *  these, so the image's position IS the ship's local origin. */
export const FLEET_TEX = (() => {
  const pts = [...FLEET.hull, ...FLEET.flame];
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const pad = STROKES.hull.width;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    ox: pad - minX,
    oy: pad - minY,
    width: Math.max(...xs) - minX + pad * 2,
    height: Math.max(...ys) - minY + pad * 2,
  };
})();

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
  // Lane rocks are made on demand, per kind and radius: each Asteroid wrapper
  // calls ensureAsteroidTexture when it's built and when it's reconfigured.
  makeGiantAsteroid(scene);
  makeBoss(scene);
  makeEscort(scene);
  makeHeart(scene);
  makeBolt(scene);
  makeSpark(scene);
  makeShard(scene);
  makeFleetShip(scene);
  makeFleetShipLost(scene);
  STARFIELD.layers.forEach((_layer, i) => makeStarLayer(scene, i));
}

/** Hull points shifted into texture space. */
function shipPoints(points: readonly (readonly [number, number])[]): Phaser.Geom.Point[] {
  return points.map(([x, y]) => new Phaser.Geom.Point(x + FLEET_TEX.ox, y + FLEET_TEX.oy));
}

/** #19 colony ship, nose right, from the v6 mock: engine flame, hull, deck
 *  line, two rows of windows, habitat pod, bridge. The mock's hull gradient is
 *  a flat hullFill here; the glow comes from the fleet's shared shield glow. */
function makeFleetShip(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.fleetShip)) return;
  const { ox, oy } = FLEET_TEX;
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLORS.charge, 0.8);
  g.fillPoints(shipPoints(FLEET.flame), true);
  g.fillStyle(COLORS.hullFill, 1);
  g.fillPoints(shipPoints(FLEET.hull), true);
  g.lineStyle(STROKES.hull.width, COLORS.p1, 1);
  g.strokePoints(shipPoints(FLEET.hull), true, true);
  g.lineStyle(STROKES.deck.width, COLORS.p1, STROKES.deck.alpha);
  g.lineBetween(FLEET.deck.x1 + ox, oy, FLEET.deck.x2 + ox, oy);
  const w = FLEET.windows;
  g.fillStyle(COLORS.hullWindow, 1);
  for (const x of w.xs) {
    g.fillRect(x + ox, w.yTop + oy, w.size, w.size);
    g.fillRect(x + ox, w.yBottom + oy, w.size, w.size);
  }
  g.fillStyle(COLORS.hullFill, 1);
  g.fillCircle(FLEET.pod.x + ox, oy, FLEET.pod.r);
  g.lineStyle(STROKES.pod.width, COLORS.p1, 1);
  g.strokeCircle(FLEET.pod.x + ox, oy, FLEET.pod.r);
  g.fillStyle(COLORS.hullWindow, 1);
  g.fillCircle(FLEET.bridge.x + ox, oy, FLEET.bridge.r);
  g.generateTexture(TEX.fleetShip, FLEET_TEX.width, FLEET_TEX.height);
  g.destroy();
}

/** A lost ship: its hull as a faint dashed outline (the mock's .v6-lost). */
function makeFleetShipLost(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.fleetShipLost)) return;
  const { dash, gap, width, alpha } = STROKES.lostShip;
  const g = scene.make.graphics({}, false);
  g.lineStyle(width, COLORS.chromeMuted, alpha);
  const pts = shipPoints(FLEET.hull);
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    drawDashedLine(g, a.x, a.y, b.x, b.y, dash, gap);
  });
  g.generateTexture(TEX.fleetShipLost, FLEET_TEX.width, FLEET_TEX.height);
  g.destroy();
}

/** One starfield layer's tile (#19): seeded, so every run looks the same.
 *  Stars cover the field's height; each is also drawn one tile-width to the
 *  left so a star cut by the right edge continues across the wrap. */
function makeStarLayer(scene: Phaser.Scene, i: number): void {
  const key = TEX.starLayer(i);
  if (scene.textures.exists(key)) return;
  const layer = STARFIELD.layers[i];
  const { width, height } = STARFIELD.tile;
  const rnd = new Phaser.Math.RandomDataGenerator([`${STARFIELD.seed}-${i}`]);
  const count = Math.round((layer.count * width) / GAME_WIDTH);
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLORS.star, layer.alpha);
  for (let n = 0; n < count; n++) {
    const x = rnd.frac() * width;
    const y = rnd.frac() * GAME_HEIGHT;
    const r = rnd.realInRange(layer.rMin, layer.rMax);
    for (const dx of [0, -width]) {
      if (layer.streak > 0) g.fillRoundedRect(x + dx, y - r / 2, layer.streak * r, r, r / 2);
      else g.fillCircle(x + dx, y, r);
    }
  }
  g.generateTexture(key, width, height);
  g.destroy();
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
export function ensureAsteroidTexture(scene: Phaser.Scene, kind: AsteroidKind, r: number): void {
  const key = TEX.asteroid(kind, r);
  if (scene.textures.exists(key)) return; // survives scene.restart()
  const g = scene.make.graphics({}, false);
  drawAsteroid(g, r, ROCK_PAINT[kind]);
  g.generateTexture(key, r * 2, r * 2);
  g.destroy();
}

/** The giant asteroid (#25): the same rock drawing at boss size, with a
 *  heavier rim and a scatter of extra craters so it reads as a boulder. */
function makeGiantAsteroid(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.giantAsteroid)) return;
  const r = GIANT_LAYOUT.radius;
  const g = scene.make.graphics({}, false);
  drawAsteroid(g, r, { ...ROCK_PAINT.standard, rimWidth: STROKES.rockGiant.width });
  g.lineStyle(STROKES.crater.width, COLORS.crater, 1);
  for (const [cx, cy, cr] of GIANT_LAYOUT.extraCraters) g.strokeCircle(r + cx * r, r + cy * r, cr * r);
  g.generateTexture(TEX.giantAsteroid, r * 2, r * 2);
  g.destroy();
}

/** A lane rock's paint by kind: a tough rock (#25) is denser, with a heavier, deeper rim. */
type RockPaint = { fill: number; rim: number; rimWidth: number };
const ROCK_PAINT: Record<AsteroidKind, RockPaint> = {
  standard: { fill: COLORS.rockFill, rim: COLORS.danger, rimWidth: STROKES.rock.width },
  tough: { fill: COLORS.rockToughFill, rim: COLORS.rockToughRim, rimWidth: STROKES.rockTough.width },
  splitter: { fill: COLORS.rockFill, rim: COLORS.danger, rimWidth: STROKES.rock.width },
};

function drawAsteroid(g: Phaser.GameObjects.Graphics, r: number, { fill, rim, rimWidth }: RockPaint): void {
  // Dark interior fill so the rock reads as a solid body, not a ring.
  g.fillStyle(fill, 1);
  g.fillCircle(r, r, r - rimWidth / 2);
  // Stroke is centered on the path, so pull the radius in by half the
  // line width to keep the outer edge inside the 2r x 2r canvas.
  g.lineStyle(rimWidth, rim, 1);
  g.strokeCircle(r, r, r - rimWidth / 2);
  // Craters at the mock's proportions (r=21 rock: craters (-6,-5,5) & (8,4,4)).
  g.lineStyle(STROKES.crater.width, COLORS.crater, 1);
  g.strokeCircle(r - 0.29 * r, r - 0.24 * r, 0.24 * r);
  if (r >= 15) {
    g.strokeCircle(r + 0.38 * r, r + 0.19 * r, 0.19 * r);
  }
}

/**
 * B34 command ship: the escorts' directional hull language scaled into a
 * flagship. It points up in texture space; Boss.activate rotates it left toward
 * the fleet. No circular shield decoration remains — the escorts' web is the
 * visible protection.
 */
function makeBoss(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.boss)) return;
  const r = BOSS_LAYOUT.radius;
  const g = scene.make.graphics({}, false);
  const hull = [new Phaser.Geom.Point(r, r * 0.08), new Phaser.Geom.Point(r * 1.82, r * 1.56), new Phaser.Geom.Point(r, r * 1.92), new Phaser.Geom.Point(r * 0.18, r * 1.56)];
  g.fillStyle(COLORS.rockFill, 1);
  g.fillPoints(hull, true);
  g.lineStyle(STROKES.rock.width + 1.5, COLORS.danger, 1);
  g.strokePoints(hull, true);
  g.fillStyle(COLORS.p1, 0.8); g.fillTriangle(r, r * 0.42, r * 1.34, r * 1.27, r, r * 1.17);
  g.fillStyle(COLORS.p2, 0.8); g.fillTriangle(r, r * 1.17, r * 1.34, r * 1.27, r, r * 1.65);
  g.fillStyle(COLORS.hullWindow, 0.9); g.fillRect(r * 0.78, r * 1.22, r * 0.44, r * 0.26);
  g.generateTexture(TEX.boss, r * 2, r * 2);
  g.destroy();
}

/** B33 escort ship: directional hull with a cyan and amber lock-fin. All three
 * state textures share the same canvas/body so lock changes never shift orbit. */
function makeEscort(scene: Phaser.Scene): void {
  const R = BOSS_LAYOUT.escort.radius;
  const hull = [
    new Phaser.Geom.Point(R, R * 0.14), new Phaser.Geom.Point(R * 1.64, R * 1.52),
    new Phaser.Geom.Point(R, R * 1.78), new Phaser.Geom.Point(R * 0.36, R * 1.52),
  ];
  const drawShip = (g: Phaser.GameObjects.Graphics, p1: boolean, p2: boolean) => {
    // Nose points up; Escort.place rotates it toward the fleet.
    g.fillStyle(COLORS.rockFill, 1);
    g.fillPoints(hull, true);
    g.lineStyle(STROKES.rock.width, COLORS.danger, 1);
    g.strokePoints(hull, true);
    g.fillStyle(COLORS.accent, 1);
    g.fillCircle(R, R * 0.95, R * 0.18);
    const fin = (left: boolean, color: number, on: boolean) => {
      if (!on) return;
      const sign = left ? -1 : 1;
      const tri = [R + sign * R * 0.34, R * 1.18, R + sign * R * 0.88, R * 1.58, R + sign * R * 0.33, R * 1.62] as const;
      g.fillStyle(color, 1);
      g.fillTriangle(...tri);
      g.lineStyle(1.5, COLORS.white, 0.72);
      g.strokeTriangle(...tri);
    };
    fin(true, COLORS.p1, p1);
    fin(false, COLORS.p2, p2);
  };
  const make = (key: string, p1: boolean, p2: boolean) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({}, false);
    drawShip(g, p1, p2);
    g.generateTexture(key, R * 2, R * 2);
    g.destroy();
  };
  make(TEX.escort, true, true);
  make(TEX.escortP1Lock, true, false);
  make(TEX.escortP2Lock, false, true);
}

/** Heart icon (B5 health-bar cap): two lobes + a point, drawn white to tint. */
function makeHeart(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.heart)) return;
  const s = BOSS_LAYOUT.bars.iconSize;
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLORS.white, 1);
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
  g.fillStyle(COLORS.white, 1);
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
  g.fillStyle(COLORS.white, 1);
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
