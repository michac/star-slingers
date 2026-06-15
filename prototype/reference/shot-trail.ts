/**
 * Shot Trail — LOCKED reference for the players' shot trail.
 * Design is agreed; this file is the spec to match when we build it into
 * src/objects/Rocket.ts. Kept here as a reference, not an open experiment.
 *
 * Lineage: 1 particles (beaded) → 2 ribbon (static) → 3 jitter (tadpole) →
 * 4 straight exhaust ribbon + brightness flux → 5 + afterimage → 6 drop the
 * embers (too firecracker-ish). The life now comes from the flux + afterimage.
 *
 * Layers, all additive (cheap; no postFX):
 *   - afterimage: a thin near-constant-width violet line over a long history
 *     (~1.2s) that fades to nothing along its length — a lingering light-streak;
 *   - exhaust ribbon: a short tapered violet body + white-hot core, with a
 *     brightness flux scrolling down it, under a faint wide glow halo.
 * The shot HEAD stays player-colored (cyan P1 / amber P2); the exhaust is violet
 * (#9d6bff) for contrast.
 *
 * Cyan + amber demo shots loop; tap to fire one from the bottom.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS } from '../../src/tokens';

const W = 360;
const H = 720;
const SPEED = 300;
const SHOT_SCALE = 2.4;

const EXHAUST = COLORS.shieldMid; // violet 0x9d6bff

const TRAIL_LEN = 18; // bright exhaust ribbon length (points)
const BODY_HALF = 7;
const BODY_ALPHA = 0.7;
const GLOW_MUL = 2.3;
const GLOW_ALPHA = 0.14;
const CORE_HALF = 2.3;
const CORE_ALPHA = 0.85;

const AFTER_LEN = 75; // afterimage history length (~1.2s at 60fps)
const AFTER_HALF = 1.0; // thin, near-constant-width line
const AFTER_ALPHA = 0.22; // faint at the head, fading to 0 down the path

// Brightness flux: a wave that scrolls down the exhaust → pulsing bands.
const FLUX_W = 0.026; // rad/ms (period ~240ms)
const FLUX_PHASE = 0.55;
const BODY_FLUX = 0.5;
const CORE_FLUX = 0.55;

const WRAP_SKIP = 60; // skip a segment longer than this (a demo wrap jump)

const TEX_P1 = 'shot-p1';
const TEX_P2 = 'shot-p2';

const ROCKET_POINTS: [number, number][] = [
  [0, -9],
  [4, 2],
  [0, 5],
  [-4, 2],
];

interface Shot {
  spr: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  loop: boolean;
  history: { x: number; y: number }[]; // newest first; [0] = head
}

class ShotTrail extends Phaser.Scene {
  private shots: Shot[] = [];
  private trail!: Phaser.GameObjects.Graphics;
  private elapsed = 0;

  create(): void {
    this.bakeDiamond(TEX_P1, COLORS.p1);
    this.bakeDiamond(TEX_P2, COLORS.p2);

    this.add
      .text(W / 2, 34, 'SHOT TRAIL', { fontFamily: FONTS.display, fontSize: '18px', color: CSS.ink })
      .setOrigin(0.5);
    this.add
      .text(W / 2, 56, 'cyan + amber loop · tap to fire', {
        fontFamily: FONTS.body,
        fontSize: '11px',
        color: CSS.chromeMuted,
      })
      .setOrigin(0.5);

    this.trail = this.add.graphics().setDepth(0).setBlendMode(Phaser.BlendModes.ADD);

    this.fire(TEX_P1, -30, 200, SPEED, 0, true);
    this.fire(TEX_P2, W + 30, 520, -SPEED, 0, true);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const dir = new Phaser.Math.Vector2(p.x - W / 2, p.y - (H - 60)).setLength(SPEED);
      this.fire(TEX_P1, W / 2, H - 60, dir.x, dir.y, false);
    });
  }

  private bakeDiamond(key: string, color: number): void {
    if (this.textures.exists(key)) return;
    const s = SHOT_SCALE;
    const g = this.make.graphics({}, false);
    g.fillStyle(color, 1);
    g.fillPoints(
      ROCKET_POINTS.map(([x, y]) => new Phaser.Geom.Point((x + 4) * s, (y + 9) * s)),
      true
    );
    g.generateTexture(key, Math.ceil(8 * s), Math.ceil(14 * s));
    g.destroy();
  }

  private fire(texKey: string, x: number, y: number, vx: number, vy: number, loop: boolean): void {
    const spr = this.add.image(x, y, texKey).setDepth(1);
    spr.setRotation(Math.atan2(vy, vx) + Math.PI / 2);
    this.shots.push({ spr, vx, vy, loop, history: [{ x, y }] });
  }

  update(_t: number, deltaMs: number): void {
    this.elapsed += deltaMs;
    const d = deltaMs / 1000;
    const dead: Shot[] = [];
    for (const s of this.shots) {
      s.spr.x += s.vx * d;
      s.spr.y += s.vy * d;
      if (s.loop) {
        // Wrap in place; the long jump segment is skipped when drawing (WRAP_SKIP),
        // so the afterimage from the last pass lingers & fades instead of streaking.
        if (s.vx > 0 && s.spr.x > W + 30) s.spr.x = -30;
        if (s.vx < 0 && s.spr.x < -30) s.spr.x = W + 30;
      }
      s.history.unshift({ x: s.spr.x, y: s.spr.y });
      if (s.history.length > AFTER_LEN) s.history.pop();
      if (!s.loop && (s.spr.x < -40 || s.spr.x > W + 40 || s.spr.y < -40 || s.spr.y > H + 40)) {
        dead.push(s);
      }
    }

    this.trail.clear();
    for (const s of this.shots) {
      this.afterimage(s.history); // long faint light-streak (under)
      this.strip(s.history, TRAIL_LEN, BODY_HALF * GLOW_MUL, EXHAUST, GLOW_ALPHA, BODY_FLUX); // glow halo
      this.strip(s.history, TRAIL_LEN, BODY_HALF, EXHAUST, BODY_ALPHA, BODY_FLUX); // body
      this.strip(s.history, TRAIL_LEN, CORE_HALF, 0xffffff, CORE_ALPHA, CORE_FLUX); // white-hot core
    }

    for (const s of dead) {
      s.spr.destroy();
      this.shots.splice(this.shots.indexOf(s), 1);
    }
  }

  /** Thin, near-constant-width line over the long history, alpha fading to 0
   *  along its length → a lingering light-streak of the flight path. */
  private afterimage(h: { x: number; y: number }[]): void {
    const n = Math.min(h.length, AFTER_LEN);
    for (let i = 0; i < n - 1; i++) {
      const a = h[i];
      const b = h[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || len > WRAP_SKIP) continue;
      const alpha = AFTER_ALPHA * (1 - i / (AFTER_LEN - 1));
      if (alpha < 0.012) continue;
      const px = (-dy / len) * AFTER_HALF;
      const py = (dx / len) * AFTER_HALF;
      this.trail.fillStyle(EXHAUST, alpha);
      this.trail.fillPoints(
        [
          new Phaser.Geom.Point(a.x + px, a.y + py),
          new Phaser.Geom.Point(b.x + px, b.y + py),
          new Phaser.Geom.Point(b.x - px, b.y - py),
          new Phaser.Geom.Point(a.x - px, a.y - py),
        ],
        true
      );
    }
  }

  /** Tapered exhaust strip over the first `count` points. `fluxDepth` modulates
   *  each segment's brightness by a wave that scrolls down the trail. */
  private strip(
    h: { x: number; y: number }[],
    count: number,
    halfW: number,
    color: number,
    maxAlpha: number,
    fluxDepth: number
  ): void {
    const n = Math.min(h.length, count);
    for (let i = 0; i < n - 1; i++) {
      const a = h[i];
      const b = h[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || len > WRAP_SKIP) continue;
      const px = -dy / len;
      const py = dx / len;
      const tA = 1 - i / (count - 1);
      const tB = Math.max(0, 1 - (i + 1) / (count - 1));
      const wA = halfW * tA;
      const wB = halfW * tB;
      const wave = 0.5 + 0.5 * Math.sin(this.elapsed * FLUX_W - i * FLUX_PHASE);
      const flux = 1 - fluxDepth + fluxDepth * wave;
      this.trail.fillStyle(color, maxAlpha * tA * flux);
      this.trail.fillPoints(
        [
          new Phaser.Geom.Point(a.x + px * wA, a.y + py * wA),
          new Phaser.Geom.Point(b.x + px * wB, b.y + py * wB),
          new Phaser.Geom.Point(b.x - px * wB, b.y - py * wB),
          new Phaser.Geom.Point(a.x - px * wA, a.y - py * wA),
        ],
        true
      );
    }
  }
}

const fontReady = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
fontReady.catch(() => undefined).then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: COLORS.sceneBg,
    scale: { width: W, height: H, mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [ShotTrail],
  });
});
