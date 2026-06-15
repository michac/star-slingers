/**
 * Station — the thing both players defend: a hull sliver mostly off-screen
 * left plus a shield of 3 concentric rings. Rings are pure HP — the
 * outermost remaining one shatters when any enemy reaches it, wherever the
 * contact happened (no positional weak spots; decided 2026-06-06). Full
 * circles are drawn and the left world edge crops them to arcs, the same
 * trick the v5 mock uses.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { SHAKE, SHATTER, SHIELD_RINGS, STATION } from '../layout';
import { BREATHER, WAVES } from '../waves';

/** Outer→inner ring colors, one per stop of the mock's #neon-shield gradient
 *  (cyan → purple → magenta). Indexed by the ring's slot in SHIELD_RINGS, so
 *  shatter/regrow (which only know a radius) recolor consistently. */
const SHIELD_RING_COLORS = [COLORS.shieldOuter, COLORS.shieldMid, COLORS.shieldInner];
function shieldColorFor(radius: number): number {
  const idx = (SHIELD_RINGS as readonly number[]).indexOf(radius);
  return SHIELD_RING_COLORS[idx] ?? COLORS.shieldOuter;
}

export class Station {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private hitsLeft: number = STATION.shieldHp;
  /** ms since the last shield hit — drives regen, counts only while damaged. */
  private msSinceHit = 0;
  /** Per-wave knob; the WaveDirector sets it at each wave start. */
  private shieldRegenMs: number = WAVES[0].shieldRegenMs;

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
    this.redraw();
  }

  /** How close an enemy may get to the station center before it "reaches"
   *  it: the outermost remaining ring — honest visuals, enemies penetrate
   *  deeper as the shield weakens — or the bare hull once the shield is gone. */
  get contactRadius(): number {
    return this.hitsLeft > 0
      ? SHIELD_RINGS[STATION.shieldHp - this.hitsLeft]
      : STATION.hullR;
  }

  /** An enemy got here. Shatters the outermost remaining ring, or reports
   *  the station destroyed when one reaches the bare hull. */
  onEnemyReached(): 'shattered' | 'destroyed' {
    if (this.hitsLeft === 0) return 'destroyed';
    const lostRadius = this.contactRadius;
    this.hitsLeft -= 1;
    this.msSinceHit = 0; // a hit restarts the regen clock
    this.redraw();
    this.shatterRing(lostRadius);
    this.worriedShake();
    return 'shattered';
  }

  /** Per-frame: after a quiet stretch, the outermost missing ring regrows —
   *  the difficulty budget's "leak allowance" (you may miss 1 hit per
   *  shieldRegenMs forever). Pauses during the fail overlay for free: the
   *  scene stops calling update() then. */
  update(deltaMs: number): void {
    if (this.hitsLeft >= STATION.shieldHp || this.shieldRegenMs <= 0) return;
    this.msSinceHit += deltaMs;
    if (this.msSinceHit < this.shieldRegenMs) return;
    this.msSinceHit = 0;
    this.hitsLeft += 1;
    this.regrowRing(this.contactRadius);
  }

  setShieldRegenMs(ms: number): void {
    this.shieldRegenMs = ms;
  }

  /** Breather perk: every missing ring regrows, one-by-one (outermost-in,
   *  same order as regen), reusing the regrow cue. */
  restoreShield(): void {
    this.msSinceHit = 0;
    const missing = STATION.shieldHp - this.hitsLeft;
    for (let i = 0; i < missing; i++) {
      this.scene.time.delayedCall(i * BREATHER.ringRestoreStaggerMs, () => {
        if (this.hitsLeft >= STATION.shieldHp) return; // regen beat us to it
        this.hitsLeft += 1;
        this.regrowRing(this.contactRadius);
      });
    }
  }

  /** Hull sliver + windows + the innermost `hitsLeft` rings. */
  private redraw(): void {
    const g = this.gfx;
    g.clear();
    g.fillStyle(COLORS.hullFill, 1);
    g.fillCircle(STATION.cx, STATION.cy, STATION.hullR);
    g.lineStyle(STROKES.hull.width, COLORS.p1, 1);
    g.strokeCircle(STATION.cx, STATION.cy, STATION.hullR);
    g.fillStyle(COLORS.hullWindow, 1);
    for (const w of STATION.windows) {
      g.fillCircle(w.x, w.y, w.r);
    }
    // Each remaining ring keeps its own gradient-stop color (outer→inner).
    for (let i = STATION.shieldHp - this.hitsLeft; i < SHIELD_RINGS.length; i++) {
      g.lineStyle(STROKES.shield.width, shieldColorFor(SHIELD_RINGS[i]), STROKES.shield.alpha);
      g.strokeCircle(STATION.cx, STATION.cy, SHIELD_RINGS[i]);
    }
  }

  /** The lost ring flies apart: a throwaway copy scales up and fades out.
   *  Drawn at local (0,0) so the scale tween grows it around the station. */
  private shatterRing(radius: number): void {
    const g = this.scene.add.graphics({ x: STATION.cx, y: STATION.cy });
    g.lineStyle(STROKES.shield.width, shieldColorFor(radius), STROKES.shield.alpha);
    g.strokeCircle(0, 0, radius);
    this.scene.tweens.add({
      targets: g,
      scale: SHATTER.scaleTo,
      alpha: 0,
      duration: SHATTER.durationMs,
      onComplete: () => g.destroy(),
    });
  }

  /** Reverse of shatterRing — the ring settles back in (scale 1.25→1,
   *  alpha 0→full), then the persistent rings are redrawn to include it. */
  private regrowRing(radius: number): void {
    const g = this.scene.add.graphics({ x: STATION.cx, y: STATION.cy });
    g.lineStyle(STROKES.shield.width, shieldColorFor(radius), STROKES.shield.alpha);
    g.strokeCircle(0, 0, radius);
    g.setScale(SHATTER.scaleTo).setAlpha(0);
    this.scene.tweens.add({
      targets: g,
      scale: 1,
      alpha: 1,
      duration: SHATTER.durationMs,
      onComplete: () => {
        g.destroy();
        this.redraw();
      },
    });
  }

  /** Brief vertical tremble of the whole station — local, not camera shake,
   *  so the players' slings and HUDs stay still. */
  private worriedShake(): void {
    this.scene.tweens.killTweensOf(this.gfx); // a re-hit mid-shake restarts it
    this.gfx.setY(0);
    this.scene.tweens.add({
      targets: this.gfx,
      y: SHAKE.amplitude,
      duration: SHAKE.durationMs,
      yoyo: true,
      repeat: SHAKE.repeats,
      onComplete: () => this.gfx.setY(0),
    });
  }
}
