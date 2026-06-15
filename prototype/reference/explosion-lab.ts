/**
 * Explosion Lab — LOCKED reference for B29 (better explosion / break effect).
 * Design is agreed; this file is the spec to match when we build it into
 * src/objects/Asteroid.ts pop(). Kept here as a reference, not an open experiment.
 *
 * Today an asteroid "pops" with a flat 160ms scale-up + fade (Asteroid.pop()).
 * We want chunky and satisfying: a flash, a shockwave ring, rock debris, and
 * sparks — built from the same family as the shield destroy-flare (glow flare,
 * opaque fills, perf budget). Particle emitters do the debris/sparks (GPU-batched
 * and the idiomatic thing to port into the game).
 *
 * Perf lessons from the shield carried over: no DPI rendering, glow quality 0.3.
 * Tap the rock to detonate; it reforms after a beat so you can replay.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../../src/tokens';

const W = 360;
const H = 720;
const CX = 180;
const CY = 320;
const SCALE = 2.5; // rocks are tiny (r=13..21); zoom up for phone review
const ROCK_R = 21 * SCALE; // the 3-hit rock — the biggest, best to show off
const GLOW_QUALITY = 0.3; // keep low — higher lagged the Pixel 6 (shield lesson)

const ROCK_STROKE = STROKES.rock.width * SCALE;
const CRATER_STROKE = STROKES.crater.width * SCALE;

const TEX_SPARK = 'px-spark';
const TEX_SHARD = 'px-shard';

class ExplosionLab extends Phaser.Scene {
  private rock!: Phaser.GameObjects.Graphics;
  private busy = false;

  create(): void {
    this.bakeTextures();

    this.add
      .text(CX, 34, 'B29 · EXPLOSION', { fontFamily: FONTS.display, fontSize: '18px', color: CSS.ink })
      .setOrigin(0.5);
    this.add
      .text(CX, 56, 'tap the rock to detonate', {
        fontFamily: FONTS.body,
        fontSize: '11px',
        color: CSS.chromeMuted,
      })
      .setOrigin(0.5);

    this.rock = this.add.graphics({ x: CX, y: CY });
    this.drawRock();

    this.input.on('pointerdown', () => this.detonate());
  }

  /** Two throwaway particle textures: a soft spark dot and a rock shard. */
  private bakeTextures(): void {
    if (!this.textures.exists(TEX_SPARK)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4); // white → additive sparks read as white-hot
      g.generateTexture(TEX_SPARK, 8, 8);
      g.destroy();
    }
    if (!this.textures.exists(TEX_SHARD)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(COLORS.rockFill, 1); // a chunk of the rock: dark body…
      g.fillTriangle(1, 12, 7, 1, 13, 10);
      g.lineStyle(1.5, COLORS.danger, 1); // …with the rock's magenta edge
      g.strokeTriangle(1, 12, 7, 1, 13, 10);
      g.generateTexture(TEX_SHARD, 14, 14);
      g.destroy();
    }
  }

  /** A real-looking asteroid (dark fill, magenta ring, two craters) at local
   *  (0,0); the graphic sits at (CX, CY) so scale tweens grow about its center. */
  private drawRock(): void {
    const r = ROCK_R;
    const g = this.rock;
    g.clear();
    g.fillStyle(COLORS.rockFill, 1);
    g.fillCircle(0, 0, r - ROCK_STROKE / 2);
    g.lineStyle(ROCK_STROKE, COLORS.danger, 1);
    g.strokeCircle(0, 0, r - ROCK_STROKE / 2);
    g.lineStyle(CRATER_STROKE, COLORS.crater, 1);
    g.strokeCircle(-0.29 * r, -0.24 * r, 0.24 * r);
    g.strokeCircle(0.38 * r, 0.19 * r, 0.19 * r);
  }

  private detonate(): void {
    if (this.busy) return;
    this.busy = true;

    // The rock itself snaps bigger and vanishes under the flash.
    this.tweens.add({
      targets: this.rock,
      scale: 1.35,
      alpha: 0,
      duration: 110,
      ease: 'Quad.Out',
      onComplete: () => this.rock.setVisible(false),
    });

    this.flash();
    this.shockwave();
    this.debris();
    this.sparks();

    this.time.delayedCall(1100, () => this.reset());
  }

  /** A white core disc with a magenta glow that blows out fast. */
  private flash(): void {
    const g = this.add.graphics({ x: CX, y: CY });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, ROCK_R * 0.85);
    g.postFX?.addGlow(COLORS.danger, 6, 0, false, GLOW_QUALITY, 22);
    g.setScale(0.3);
    this.tweens.add({
      targets: g,
      scale: 1.7,
      alpha: 0,
      duration: 170,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  /** A thin magenta ring that expands and fades — the classic shock front. */
  private shockwave(): void {
    const g = this.add.graphics({ x: CX, y: CY });
    g.lineStyle(3, COLORS.danger, 0.9);
    g.strokeCircle(0, 0, ROCK_R);
    g.setScale(0.4);
    this.tweens.add({
      targets: g,
      scale: 2.4,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.Out',
      onComplete: () => g.destroy(),
    });
  }

  /** Rock shards flung outward, spinning, falling, fading. */
  private debris(): void {
    const e = this.add.particles(CX, CY, TEX_SHARD, {
      lifespan: { min: 450, max: 760 },
      speed: { min: 70, max: 250 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0.3 },
      alpha: { start: 1, end: 0 },
      gravityY: 160,
      emitting: false,
    });
    e.explode(12);
    this.time.delayedCall(900, () => e.destroy());
  }

  /** White-hot sparks: fast, additive, twinkling out. */
  private sparks(): void {
    const e = this.add.particles(CX, CY, TEX_SPARK, {
      lifespan: { min: 300, max: 560 },
      speed: { min: 140, max: 430 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      emitting: false,
    });
    e.explode(28);
    this.time.delayedCall(700, () => e.destroy());
  }

  private reset(): void {
    this.rock.setScale(1).setAlpha(1).setVisible(true);
    this.busy = false;
  }
}

const fontReady = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
fontReady.catch(() => undefined).then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: COLORS.sceneBg,
    scale: { width: W, height: H, mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [ExplosionLab],
  });
});
