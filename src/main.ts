import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './layout';
import { asteroidsFor, breakEvenAccuracy, requiredDamagePerSec, ROCK_STREAMS, RUN, shipFleetHitsPerSec, waveTarget } from './waves';
import { COLORS } from './tokens';
import { JoinScene } from './scenes/JoinScene';
import { SandboxScene } from './scenes/SandboxScene';

// Difficulty readout — the tuning loop is: change a RUN target, reload,
// read these. Shows target vs achieved (the solver lands at-or-above target,
// or below if saturated) and the tier the solver settled on (see docs/design.md §7).
// Logged for solo and co-op: the join screen picks the seat count later. A
// ship wave (#27) logs its dials and the bolts/s that would reach the fleet if
// nobody shot (the same for any seat count).
if (import.meta.env.DEV) {
  for (const players of [1, 2] as const) for (const [i, { act, kind, boss, field: w, ships, placeholder }] of RUN.entries()) {
    const label = `wave ${i + 1} (act ${act}, ${boss ?? kind}${placeholder ? ' placeholder' : ''})`;
    if (ships) {
      if (players === 2) {
        console.log(
          `${label}: ${ships.onScreen} ships at once, quota ${ships.quota}, ` +
            `${ships.shieldedEvery ? `every ${ships.shieldedEvery} shielded` : 'no shields'}, ` +
            `one shot per ${ships.fireEveryMs}ms each = ${shipFleetHitsPerSec(ships).toFixed(2)} bolts/s unattended`
        );
      }
      continue;
    }
    if (!w) {
      if (players === 2) console.log(`${label}: boss encounter (${boss === 'giantAsteroid' ? 'GIANT' : 'BOSS'} dials)`);
      continue;
    }
    const specs = asteroidsFor(w, players);
    const count = (k: string) => specs.filter((s) => s.kind === k).length;
    const speedScale = (specs[0].speed / ROCK_STREAMS[0].baseSpeed).toFixed(2);
    console.log(
      `${label} (${players}p): target ${waveTarget(w, players).toFixed(2)} -> achieved ` +
        `${requiredDamagePerSec(w, players).toFixed(2)} required damage/s ` +
        `[streams ${specs.length}, speed x${speedScale}, tough ${count('tough')}, splitters ${count('splitter')}], ` +
        `break-even ${(breakEvenAccuracy(w, players) * 100).toFixed(0)}%, quota ${w.quota}`
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
