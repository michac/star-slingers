/**
 * Glow Lab — a prototype page for B22 (neon glow / bloom pass).
 * Not part of the game; lives under prototype/ and ships to /prototype/glow-lab.html
 * so it can be reviewed remotely (see prototype/README or the gallery index).
 *
 * Round 4 — outer-only glow on the REAL station. Trick: behind the station,
 * draw a background-colored disc the size of the fully-shielded station and
 * give IT a glow. The disc is invisible (bg color) but its glow halo shows,
 * and because the disc edge sits at the outer shield radius the halo only
 * appears OUTSIDE the station. Then draw the normal 3-ring station on top.
 * Glow is pink for now, to contrast the cyan outermost ring.
 *
 * Three panels = the same thing at increasing glow amounts. Tap a row to pause.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../src/tokens';
import { SHIELD_RINGS, STATION } from '../src/layout';

const W = 360;
const H = 720;
const CX = 180;

const PINK = COLORS.shieldInner; // magenta 0xff5ec7 — contrasts the cyan outer ring
const OUTER_R = SHIELD_RINGS[0]; // 46 — radius of the fully-shielded station

/** Outer→inner ring colors, same mapping as Station.ts. */
const RING_COLORS = [COLORS.shieldOuter, COLORS.shieldMid, COLORS.shieldInner];

const PANELS = [
  { cy: 130, label: 'A · station + pink glow  (d12 s3)', distance: 12, strength: 3 },
  { cy: 370, label: 'B · station + pink glow  (d20 s4)', distance: 20, strength: 4 },
  { cy: 610, label: 'C · station + pink glow  (d30 s6)', distance: 30, strength: 6 },
];

/** The normal station graphic (hull + windows + 3 shield rings), centered at
 *  (cx, cy). Windows are stored as absolute coords around STATION.cx/cy, so we
 *  re-base them to wherever we're drawing. Mirrors Station.redraw(). */
function drawStation(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.hullFill, 1);
  g.fillCircle(cx, cy, STATION.hullR);
  g.lineStyle(STROKES.hull.width, COLORS.p1, 1);
  g.strokeCircle(cx, cy, STATION.hullR);
  g.fillStyle(COLORS.hullWindow, 1);
  for (const wnd of STATION.windows) {
    g.fillCircle(cx + (wnd.x - STATION.cx), cy + (wnd.y - STATION.cy), wnd.r);
  }
  for (let i = 0; i < SHIELD_RINGS.length; i++) {
    g.lineStyle(STROKES.shield.width, RING_COLORS[i], STROKES.shield.alpha);
    g.strokeCircle(cx, cy, SHIELD_RINGS[i]);
  }
}

class GlowLab extends Phaser.Scene {
  /** Per-panel pulse state: a proxy we tween and an enabled flag. */
  private pulses: { v: number; on: boolean; apply: (v: number) => void }[] = [];

  create(): void {
    this.add
      .text(CX, 30, 'B22 · OUTER GLOW', {
        fontFamily: FONTS.display,
        fontSize: '18px',
        color: CSS.ink,
      })
      .setOrigin(0.5);
    this.add
      .text(CX, 52, 'tap a row to pause its pulse', {
        fontFamily: FONTS.body,
        fontSize: '11px',
        color: CSS.chromeMuted,
      })
      .setOrigin(0.5);

    for (const panel of PANELS) this.buildGlowStation(panel);

    // One shared 0→1 pulse driver; each panel maps it to its own glow strength.
    const driver = { v: 0 };
    this.tweens.add({
      targets: driver,
      v: 1,
      duration: 1400,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
    this.events.on('update', () => {
      for (const p of this.pulses) p.apply(p.on ? driver.v : 0.5);
    });

    // Labels + tap-to-toggle hit zones, one per panel.
    PANELS.forEach((panel, i) => {
      this.add
        .text(CX, panel.cy + 80, panel.label, {
          fontFamily: FONTS.body,
          fontSize: '13px',
          color: CSS.chromeMuted,
        })
        .setOrigin(0.5);
      const zone = this.add.zone(CX, panel.cy, W, 200).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        if (this.pulses[i]) this.pulses[i].on = !this.pulses[i].on;
      });
    });
  }

  /** Background-colored disc (sized to the fully-shielded station) carrying a
   *  pink glow → the halo shows only outside the station. Then the real station
   *  on top. Pulse modulates the glow's outerStrength. */
  private buildGlowStation(panel: { cy: number; distance: number; strength: number }): void {
    const glowDisc = this.add.graphics();
    glowDisc.fillStyle(COLORS.sceneBg, 1); // invisible against the bg — only its glow shows
    glowDisc.fillCircle(CX, panel.cy, OUTER_R);
    // postFX is WebGL-only; AUTO picks WebGL on phone/desktop Chrome.
    // addGlow(color, outerStrength, innerStrength, knockout, quality, distance)
    let glow: Phaser.FX.Glow | undefined;
    if (glowDisc.postFX) {
      glow = glowDisc.postFX.addGlow(PINK, panel.strength, 0, false, 0.3, panel.distance);
    }

    const station = this.add.graphics();
    drawStation(station, CX, panel.cy);

    this.pulses.push({
      v: 0.5,
      on: true,
      apply: (v) => {
        if (glow) glow.outerStrength = panel.strength * (0.6 + v * 0.8); // 0.6×→1.4×
      },
    });
  }
}

const fontReady = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
fontReady.catch(() => undefined).then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: COLORS.sceneBg,
    scale: {
      width: W,
      height: H,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [GlowLab],
  });
});
