import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './layout';
import { asteroidsFor, breakEvenAccuracy, requiredDamagePerSec, ROCK_STREAMS, RUN, SOLO } from './waves';
import { COLORS } from './tokens';
import { JoinScene } from './scenes/JoinScene';
import { SandboxScene } from './scenes/SandboxScene';

// Difficulty readout — the tuning loop is: change a RUN target, reload,
// read these. Shows target vs achieved (the solver lands at-or-above target,
// or below if saturated) and the tier the solver settled on (see docs/design.md §7).
// A solo run fields the same field at SOLO.pace (#6), so each wave logs once,
// with the two-player and the solo break-even side by side.
if (import.meta.env.DEV) {
  for (const [i, { act, kind, boss, field: w, placeholder }] of RUN.entries()) {
    const label = `wave ${i + 1} (act ${act}, ${boss ?? kind}${placeholder ? ' placeholder' : ''})`;
    if (!w) {
      console.log(`${label}: boss encounter (${boss === 'giantAsteroid' ? 'GIANT' : 'BOSS'} dials)`);
      continue;
    }
    const specs = asteroidsFor(w, 2);
    const count = (k: string) => specs.filter((s) => s.kind === k).length;
    const speedScale = (specs[0].speed / ROCK_STREAMS[0].baseSpeed).toFixed(2);
    const pct = (players: 1 | 2) => `${(breakEvenAccuracy(w, players) * 100).toFixed(0)}%`;
    console.log(
      `${label}: target ${w.required.toFixed(2)} -> achieved ` +
        `${requiredDamagePerSec(w, 2).toFixed(2)} required damage/s ` +
        `[streams ${specs.length}, speed x${speedScale}, tough ${count('tough')}, splitters ${count('splitter')}], ` +
        `break-even 2p ${pct(2)} / solo ${pct(1)} (pace x${SOLO.pace}), quota ${w.quota}`
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
    // The join screen (#20) runs first; it starts Sandbox with the lineup.
    scene: [JoinScene, SandboxScene],
  });

  // Debug handle for the headless e2e suite (e2e/) and console poking.
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

// Wait for the neon font (Audiowide) so the first HUD text paints in it, not
// the fallback. Boot anyway if the Font Loading API is missing or the fetch
// fails — a fallback font beats no game.
const fontReady = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
fontReady.catch(() => undefined).then(boot);
