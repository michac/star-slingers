/**
 * Shield Pulse — LOCKED reference for the chosen shield look (B22 glow + B23 pulse).
 * Design is agreed; this file is the spec to match when we build it into
 * src/objects/Station.ts. Kept here as a reference, not an open experiment.
 *
 * Decisions (see plans/star-slingers/polish-pass.md):
 *   - Shields PULSE: ring brightness breathes on a sine, trough 0.6 (half-fade,
 *     never ghostly), crest full. Slow — ~3.2s per breath.
 *   - Multiple shields FLOW: each ring is phase-offset so the bright crest
 *     travels outer→inner, like energy moving through the layers.
 *   - A GLOW bloom hugs the outermost remaining ring, recolors to it
 *     (cyan→purple→magenta as rings peel) and breathes with the pulse.
 *   - DESTROYED ring FLARES its glow bright, then expands and fades away.
 *
 * Station is drawn ~2.2× the game's actual size so the effect reads on a phone.
 * Tap anywhere to take a hit (flare + drop a ring); tap with no shield to reset.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../../src/tokens';
import { SHIELD_RINGS, STATION } from '../../src/layout';

const W = 360;
const H = 720;
const CX = 180;
const CY = 300;
const SCALE = 2.2; // zoom the tightly-packed rings (46/39/32) up for review

const PERIOD = 3200; // ms per breath — slow (half the first prototype's speed)
const PULSE_LO = 0.6; // trough brightness: a half-dim, still clearly lit
const PULSE_HI = 1.0; // crest brightness: full
const SHIELD_HP = SHIELD_RINGS.length;
const GLOW_QUALITY = 0.3; // glow bloom sample size — keep low; higher lags the Pixel 6

/** Outer→inner ring colors, same mapping as Station.ts. */
const RING_COLORS = [COLORS.shieldOuter, COLORS.shieldMid, COLORS.shieldInner];

/** 0→1 brightness for ring `i` at time `elapsed`. The per-ring phase offset is
 *  the "flow": the crest sweeps outer (i=0) → inner. */
function brightness(elapsed: number, i: number): number {
  const flow = i * Math.PI * 0.5;
  return (Math.sin((elapsed / PERIOD) * Math.PI * 2 - flow) + 1) / 2;
}

/** Scale a packed 0xRRGGBB color's brightness by f (0..1), kept fully opaque.
 *  We pulse the rings by darkening their color, NOT by lowering alpha: a thick
 *  semi-transparent stroked circle overlaps itself at its tessellation joins,
 *  and the doubled alpha there reads as faint radial "grid" spokes. Opaque
 *  strokes don't show that — and it's cheaper. */
function dim(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

class ShieldPulse extends Phaser.Scene {
  private elapsed = 0;
  private hitsLeft: number = SHIELD_HP;
  private rings!: Phaser.GameObjects.Graphics;
  private glowDisc!: Phaser.GameObjects.Graphics;
  private ambientGlow?: Phaser.FX.Glow;

  create(): void {
    this.add
      .text(CX, 30, 'B23 · SHIELD — chosen look', {
        fontFamily: FONTS.display,
        fontSize: '18px',
        color: CSS.ink,
      })
      .setOrigin(0.5);
    this.add
      .text(CX, 52, 'glow + flow + pulse · tap to take a hit', {
        fontFamily: FONTS.body,
        fontSize: '11px',
        color: CSS.chromeMuted,
      })
      .setOrigin(0.5);

    // Ambient outer bloom — behind everything; sized/recolored per frame.
    this.glowDisc = this.add.graphics();
    if (this.glowDisc.postFX) {
      this.ambientGlow = this.glowDisc.postFX.addGlow(COLORS.shieldOuter, 2, 0, false, GLOW_QUALITY, 22);
    }

    this.drawHull();
    this.rings = this.add.graphics();

    this.input.on('pointerdown', () => this.takeHit());
  }

  /** Hull sliver + windows (static), scaled and centered at (CX, CY). */
  private drawHull(): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.hullFill, 1);
    g.fillCircle(CX, CY, STATION.hullR * SCALE);
    g.lineStyle(STROKES.hull.width * SCALE, COLORS.p1, 1);
    g.strokeCircle(CX, CY, STATION.hullR * SCALE);
    g.fillStyle(COLORS.hullWindow, 1);
    for (const w of STATION.windows) {
      g.fillCircle(CX + (w.x - STATION.cx) * SCALE, CY + (w.y - STATION.cy) * SCALE, w.r * SCALE);
    }
  }

  /** Tap: drop the outermost remaining ring with a flare; reset when empty. */
  private takeHit(): void {
    if (this.hitsLeft === 0) {
      this.hitsLeft = SHIELD_HP;
      return;
    }
    const idx = SHIELD_HP - this.hitsLeft; // outermost remaining ring
    this.hitsLeft -= 1; // the ambient layer drops it immediately
    this.flare(idx);
  }

  /** Destroyed ring: flare its glow bright, then expand + fade away. The graphic
   *  sits at (CX, CY) and draws at local (0,0) so scaling grows it about center. */
  private flare(idx: number): void {
    const color = RING_COLORS[idx];
    const g = this.add.graphics({ x: CX, y: CY });
    g.lineStyle(STROKES.shield.width * SCALE, color, 1);
    g.strokeCircle(0, 0, SHIELD_RINGS[idx] * SCALE);
    const fx = g.postFX?.addGlow(color, 0, 0, false, GLOW_QUALITY, 26);
    if (fx) this.tweens.add({ targets: fx, outerStrength: 11, duration: 150, yoyo: true, ease: 'Quad.Out' });
    this.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.45,
      duration: 540,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  update(_t: number, deltaMs: number): void {
    this.elapsed += deltaMs;

    // Remaining rings, flow-pulsed alpha.
    this.rings.clear();
    for (let i = SHIELD_HP - this.hitsLeft; i < SHIELD_RINGS.length; i++) {
      const f = PULSE_LO + brightness(this.elapsed, i) * (PULSE_HI - PULSE_LO);
      this.rings.lineStyle(STROKES.shield.width * SCALE, dim(RING_COLORS[i], f), 1);
      this.rings.strokeCircle(CX, CY, SHIELD_RINGS[i] * SCALE);
    }

    // Ambient bloom hugs + recolors to the outermost remaining ring, breathing.
    this.glowDisc.clear();
    if (this.hitsLeft > 0 && this.ambientGlow) {
      const idx = SHIELD_HP - this.hitsLeft;
      this.glowDisc.fillStyle(COLORS.sceneBg, 1);
      this.glowDisc.fillCircle(CX, CY, SHIELD_RINGS[idx] * SCALE);
      this.ambientGlow.color = RING_COLORS[idx];
      this.ambientGlow.outerStrength = 1.5 + brightness(this.elapsed, idx) * 3;
      this.glowDisc.setVisible(true);
    } else {
      this.glowDisc.setVisible(false);
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
    scene: [ShieldPulse],
  });
});
