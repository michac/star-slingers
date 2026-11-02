import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './layout';
import { asteroidsFor, breakEvenAccuracy, LANE_SLOTS, requiredHitsPerSec, WAVES } from './waves';
import { COLORS } from './tokens';
import { SandboxScene } from './scenes/SandboxScene';

// Difficulty readout — the tuning loop is: change a WAVES target, reload,
// read these. Shows target vs achieved (the solver lands at-or-above target,
// or below if saturated) and the tier the solver settled on (see spec.md §7).
if (import.meta.env.DEV) {
  for (const [i, w] of WAVES.entries()) {
    const specs = asteroidsFor(w);
    const splitters = specs.filter((s) => s.kind === 'splitter').length;
    const speedScale = (specs[0].speed / LANE_SLOTS[0].baseSpeed).toFixed(2);
    console.log(
      `wave ${i + 1}: target ${w.required.toFixed(2)} -> achieved ` +
        `${requiredHitsPerSec(w).toFixed(2)} required hits/s ` +
        `[lanes ${specs.length}, speed x${speedScale}, splitters ${splitters}], ` +
        `break-even ${(breakEvenAccuracy(w) * 100).toFixed(0)}%, quota ${w.quota}`
    );
  }
}

// Register the offline service worker (B12 PWA) — PROD only, so dev and
// the e2e suite (run against the dev server) never register one. Relative path →
// scope auto-set to the subpath dir; no {scope} option. Failure is swallowed so
// a SW problem can never block the game.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

function boot(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: COLORS.sceneBg,
    scale: {
      // 360x740 logical units == the mock's viewBox, scaled to fit the screen.
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 } },
    },
    // Touch pointers to track at once: controls v2 (#7) is two thumbs per seat,
    // so four thumbs + two spares (a resting palm, a stray finger). Phaser's
    // default is 1, which drops every simultaneous touch after the first.
    input: { activePointers: 6 },
    scene: [SandboxScene],
  });

  // Debug handle for the headless e2e suite (e2e/sandbox.spec.ts) and console poking.
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

// Wait for the neon font (Audiowide) so the first HUD text paints in it, not
// the fallback. Boot anyway if the Font Loading API is missing or the fetch
// fails — a fallback font beats no game.
const fontReady = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
fontReady.catch(() => undefined).then(boot);
