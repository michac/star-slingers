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
import { SHAKE, SHATTER, SHIELD_FX, SHIELD_RINGS, STATION } from '../layout';
import { BREATHER, WAVES } from '../waves';

/** Outer→inner ring colors, one per stop of the mock's #neon-shield gradient
 *  (cyan → purple → magenta). Indexed by the ring's slot in SHIELD_RINGS, so
 *  shatter/regrow (which only know a radius) recolor consistently. */
const SHIELD_RING_COLORS = [COLORS.shieldOuter, COLORS.shieldMid, COLORS.shieldInner];
function shieldColorFor(radius: number): number {
  const idx = (SHIELD_RINGS as readonly number[]).indexOf(radius);
  return SHIELD_RING_COLORS[idx] ?? COLORS.shieldOuter;
}

/** 0→1 brightness for ring `i` at time `elapsed`. The per-ring phase offset is
 *  the "flow": the crest sweeps outer (i=0) → inner. (Locked: shield-pulse.ts) */
function brightness(elapsed: number, i: number): number {
  const flow = i * Math.PI * 0.5;
  return (Math.sin((elapsed / SHIELD_FX.periodMs) * Math.PI * 2 - flow) + 1) / 2;
}

/** Scale a packed 0xRRGGBB color's brightness by f (0..1), kept fully opaque.
 *  We pulse the rings by darkening their color, NOT by lowering alpha: a thick
 *  semi-transparent stroked circle overlaps itself at its tessellation joins,
 *  and the doubled alpha there reads as faint radial "grid" spokes. */
function dim(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

export class Station {
  /** Static hull + windows. */
  private readonly gfx: Phaser.GameObjects.Graphics;
  /** Shield rings, cleared + redrawn every frame (pulse + flow). */
  private readonly rings: Phaser.GameObjects.Graphics;
  /** Ambient bloom disc behind everything, carrying the one shield glow FX. */
  private readonly glowDisc: Phaser.GameObjects.Graphics;
  private readonly ambientGlow?: Phaser.FX.Glow;
  /** Drives the breathing sine; advanced every frame. */
  private elapsed = 0;
  private hitsLeft: number = STATION.shieldHp;
  /** ms since the last shield hit — drives regen, counts only while damaged. */
  private msSinceHit = 0;
  /** Per-wave knob; the WaveDirector sets it at each wave start. */
  private shieldRegenMs: number = WAVES[0].shieldRegenMs;

  constructor(private readonly scene: Phaser.Scene) {
    // Construction order = depth (Station is added before asteroids/rockets):
    // glowDisc (behind) → hull → rings. postFX guarded so headless software
    // WebGL can't crash — the glow is simply absent there.
    this.glowDisc = scene.add.graphics();
    this.ambientGlow = this.glowDisc.postFX?.addGlow(
      COLORS.shieldOuter,
      2,
      0,
      false,
      SHIELD_FX.glowQuality,
      22
    );
    this.gfx = scene.add.graphics();
    this.rings = scene.add.graphics();
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
    // Rings are redrawn every frame from hitsLeft now — no static redraw needed.
    this.shatterRing(lostRadius);
    this.worriedShake();
    return 'shattered';
  }

  /** Per-frame: after a quiet stretch, the outermost missing ring regrows —
   *  the difficulty budget's "leak allowance" (you may miss 1 hit per
   *  shieldRegenMs forever). Pauses during the fail overlay for free: the
   *  scene stops calling update() then. */
  update(deltaMs: number): void {
    // The pulse/flow rings + ambient glow redraw EVERY frame (the early-return
    // below is only for the regen clock).
    this.elapsed += deltaMs;
    this.drawRings();
    this.drawAmbientGlow();

    if (this.hitsLeft >= STATION.shieldHp || this.shieldRegenMs <= 0) return;
    this.msSinceHit += deltaMs;
    if (this.msSinceHit < this.shieldRegenMs) return;
    this.msSinceHit = 0;
    this.hitsLeft += 1;
    this.regrowRing(this.contactRadius);
  }

  /** Remaining rings, flow-pulsed by COLOR brightness (opaque, alpha 1). */
  private drawRings(): void {
    const g = this.rings;
    g.clear();
    for (let i = STATION.shieldHp - this.hitsLeft; i < SHIELD_RINGS.length; i++) {
      const f = SHIELD_FX.pulseLo + brightness(this.elapsed, i) * (1 - SHIELD_FX.pulseLo);
      g.lineStyle(STROKES.shield.width, dim(SHIELD_RING_COLORS[i], f), 1);
      g.strokeCircle(STATION.cx, STATION.cy, SHIELD_RINGS[i]);
    }
  }

  /** Ambient bloom hugs + recolors to the outermost remaining ring, breathing.
   *  Hidden when the shield is gone (or when postFX is unavailable headless). */
  private drawAmbientGlow(): void {
    const g = this.glowDisc;
    g.clear();
    if (this.hitsLeft > 0 && this.ambientGlow) {
      const idx = STATION.shieldHp - this.hitsLeft;
      g.fillStyle(COLORS.sceneBg, 1);
      g.fillCircle(STATION.cx, STATION.cy, SHIELD_RINGS[idx]);
      this.ambientGlow.color = SHIELD_RING_COLORS[idx];
      this.ambientGlow.outerStrength = 1.5 + brightness(this.elapsed, idx) * 3;
      g.setVisible(true);
    } else {
      g.setVisible(false);
    }
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

  /** Hull sliver + windows (static — the rings are their own per-frame layer). */
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
  }

  /** The lost ring's locked destroy cue: a throwaway copy flares its glow bright
   *  (yoyo), then expands + fades away. Drawn at local (0,0) so the scale tween
   *  grows it around the station. postFX guarded for headless. */
  private shatterRing(radius: number): void {
    const color = shieldColorFor(radius);
    const g = this.scene.add.graphics({ x: STATION.cx, y: STATION.cy });
    g.lineStyle(STROKES.shield.width, color, 1);
    g.strokeCircle(0, 0, radius);
    const fx = g.postFX?.addGlow(color, 0, 0, false, SHIELD_FX.glowQuality, 26);
    if (fx) {
      this.scene.tweens.add({
        targets: fx,
        outerStrength: SHIELD_FX.flare.strength,
        duration: SHIELD_FX.flare.flareMs,
        yoyo: true,
        ease: 'Quad.Out',
      });
    }
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: SHIELD_FX.flare.scaleTo,
      duration: SHIELD_FX.flare.fadeMs,
      ease: 'Quad.Out',
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
