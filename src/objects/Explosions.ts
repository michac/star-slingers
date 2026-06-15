/**
 * Explosions — the shared asteroid burst (B29), ported from the locked
 * prototype `prototype/reference/explosion-lab.ts`. Owns ONE shared pair of
 * particle emitters (rock shards with gravity; additive white-hot sparks),
 * created once at scene start; `boom(x, y, radius)` fires a composed burst at
 * a pop position: a flash (white core under a transient magenta glow), a
 * shockwave ring, debris, and sparks.
 *
 * Perf (carried from the shield pass): never new emitters per pop — the two
 * shared ones are pooled/GPU-batched and reused; one transient glow per pop;
 * glow `quality` stays 0.3, no DPI. The burst graphics/particles live
 * independently of the asteroid and self-clean, so a fresh rock may respawn
 * before a burst finishes (fine — the emitters are shared).
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import { EXPLOSION, STAR_SHOWER } from '../layout';
import { TEX } from './textures';

export class Explosions {
  private readonly shardEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly showerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    this.shardEmitter = scene.add
      .particles(0, 0, TEX.shard, {
        lifespan: { ...EXPLOSION.debris.lifespan },
        speed: { ...EXPLOSION.debris.speed },
        angle: { min: 0, max: 360 },
        rotate: { min: 0, max: 360 },
        scale: { start: EXPLOSION.debris.scale.start, end: EXPLOSION.debris.scale.end },
        alpha: { start: 1, end: 0 },
        gravityY: EXPLOSION.debris.gravityY,
        emitting: false,
      })
      .setDepth(EXPLOSION.depth);

    this.sparkEmitter = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { ...EXPLOSION.sparks.lifespan },
        speed: { ...EXPLOSION.sparks.speed },
        angle: { min: 0, max: 360 },
        scale: { start: EXPLOSION.sparks.scale.start, end: EXPLOSION.sparks.scale.end },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(EXPLOSION.depth);

    // Wave-clear confetti (B7): one persistent shared emitter, like the pop
    // ones — created once, never per-event. Longer-lived, downward gravity,
    // wider scale, and a confetti tint cycle across the two player colors + the
    // accent so the shower reads as celebratory rather than as another burst.
    this.showerEmitter = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { ...STAR_SHOWER.lifespan },
        speed: { ...STAR_SHOWER.speed },
        angle: { min: STAR_SHOWER.angleDeg.min, max: STAR_SHOWER.angleDeg.max },
        scale: { start: STAR_SHOWER.scale.start, end: STAR_SHOWER.scale.end },
        alpha: { start: 1, end: 0 },
        gravityY: STAR_SHOWER.gravityY,
        tint: [COLORS.p1, COLORS.p2, COLORS.accent],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(EXPLOSION.depth);
  }

  /** Detonate at (x, y); flash + shockwave size off the asteroid's real radius. */
  boom(x: number, y: number, radius: number): void {
    this.flash(x, y, radius);
    this.shockwave(x, y, radius);
    this.shardEmitter.emitParticleAt(x, y, EXPLOSION.debris.count);
    this.sparkEmitter.emitParticleAt(x, y, EXPLOSION.sparks.count);
  }

  /** Wave-clear celebration (B7): rain confetti down over the whole playfield,
   *  seeding a batch at a spread of X positions across the field's top. */
  starShower(): void {
    const xs = STAR_SHOWER.spreadX;
    const per = Math.ceil(STAR_SHOWER.count / xs.length);
    for (const x of xs) {
      this.showerEmitter.emitParticleAt(x, STAR_SHOWER.seedY, per);
    }
  }

  /** A white core disc under a transient magenta glow that blows out fast. */
  private flash(x: number, y: number, radius: number): void {
    const g = this.scene.add.graphics({ x, y }).setDepth(EXPLOSION.depth);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, radius * EXPLOSION.flash.sizeFactor);
    g.postFX?.addGlow(COLORS.danger, EXPLOSION.flash.glowStrength, 0, false, EXPLOSION.glowQuality, 22);
    g.setScale(EXPLOSION.flash.scaleFrom);
    this.scene.tweens.add({
      targets: g,
      scale: EXPLOSION.flash.scaleTo,
      alpha: 0,
      duration: EXPLOSION.flash.durationMs,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  /** A thin magenta ring expanding + fading — the classic shock front. */
  private shockwave(x: number, y: number, radius: number): void {
    const g = this.scene.add.graphics({ x, y }).setDepth(EXPLOSION.depth);
    g.lineStyle(EXPLOSION.shockwave.width, COLORS.danger, EXPLOSION.shockwave.alpha);
    g.strokeCircle(0, 0, radius);
    g.setScale(EXPLOSION.shockwave.scaleFrom);
    this.scene.tweens.add({
      targets: g,
      scale: EXPLOSION.shockwave.scaleTo,
      alpha: 0,
      duration: EXPLOSION.shockwave.durationMs,
      ease: 'Cubic.Out',
      onComplete: () => g.destroy(),
    });
  }
}
