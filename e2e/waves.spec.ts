/**
 * waves.spec.ts — the run and the src/waves.ts difficulty model: the 10-wave RUN table and its
 * play order, the act transition's fleet flyby (#29), the ?wave shortcut, Try again's retry wave,
 * the wave solver and solo target scaling.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, JOIN_SCENE, gotoGame, fieldRock, stepGame, stepUntil, sceneActive, loseShips, failVisible, type Page } from './helpers';
import { ACT_TRANSITION, AMMO_REGEN_MS, FLEET, GAME_WIDTH, REGROW, SPECIAL, STARFIELD, sublaneCenterY } from '../src/layout';
import {
  actStartWave,
  ASTEROID_KIND,
  BREATHER,
  breakEvenAccuracy,
  clearDamage,
  COMMAND_SHIP_WAVE,
  DAMAGE,
  requiredDamagePerSec,
  RUN,
  SOLO,
  solveWave,
  startWaveFromQuery,
  waveTarget,
} from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

const debug = <T>(page: Page, call: string) => page.evaluate(`${SCENE}.__debug.${call}`) as Promise<T>;

/** The run's position and the fail card, read in one round-trip. */
const runState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const d = s.__debug;
    return { wave: d.wave(), act: d.act(), kind: d.waveKind(), state: d.state(), failVisible: s.failOverlay.visible };
  });

test('the run is one table of 10 waves in 4 acts', () => {
  expect(RUN.map((w) => w.act)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
  expect(RUN.map((w) => w.boss ?? w.kind)).toEqual([
    'asteroid', 'asteroid', 'giantAsteroid',
    'ship', 'ship', 'commandShip',
    'monster', 'monster', 'monsterBoss',
    'finale',
  ]);
  expect(RUN.filter((w) => w.kind === 'boss').map((w) => RUN.indexOf(w) + 1)).toEqual([3, 6, 9]);
  expect(COMMAND_SHIP_WAVE).toBe(6);
  // Only the command ship is played by its encounter; every other wave is a solver field.
  expect(RUN.filter((w) => !w.field).map((w) => w.boss)).toEqual(['commandShip']);
  // Try again's target: each act's first wave.
  expect(RUN.map((_, i) => actStartWave(i + 1))).toEqual([1, 1, 1, 4, 4, 4, 7, 7, 7, 10]);
});

test('the start wave comes from ?wave, else ?boss, else wave 1', () => {
  expect(startWaveFromQuery('')).toBe(1);
  expect(startWaveFromQuery('?wave=9')).toBe(9);
  expect(startWaveFromQuery('?wave=10&utm_source=shelf')).toBe(10);
  expect(startWaveFromQuery('?boss')).toBe(6);
  expect(startWaveFromQuery('?wave=9&boss')).toBe(9);
  for (const bad of ['?wave=0', '?wave=11', '?wave=abc', '?wave=2.5', '?wave=']) {
    expect(startWaveFromQuery(bad)).toBe(1);
  }
});

test('the run plays waves 1 to 10 in order with breathers, then wins', async ({ page }) => {
  await gotoGame(page);
  // The whole run in ONE evaluate on the fixed-timestep clock: clear each wave
  // (clearWave empties the field at once; the command ship is snapped in and
  // defeated), read the banner, then step through the breather to the next wave.
  const run = await page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const d = s.__debug;
    const until = (cond: () => boolean, max: number) => {
      for (let n = 0; n < max && !cond(); n++) w.__step();
      return cond();
    };
    const playing = () => d.state() === 'live' || d.state() === 'boss';
    const rows: any[] = [];
    for (let n = 1; n <= 10; n++) {
      const row: any = { wave: d.wave(), act: d.act(), kind: d.waveKind(), state: d.state(), won: s.victoryOverlay.visible };
      if (d.state() === 'boss') {
        d.snapBossIn();
        w.__step();
        d.defeatBoss();
        row.afterBoss = { escorts: d.escortsAlive(), links: d.shieldLinks(), bossActive: s.bossEncounter.boss.active };
      } else {
        d.clearWave();
      }
      row.cleared = until(() => !playing(), 3);
      if (n < 10) {
        // A breather is the fleet's flyby (#29) after each act's last wave, then the banner.
        const numerals = s.waveDirector.banner.numerals;
        row.banner = until(() => numerals.every((t: any) => t.text === String(n + 1)), 300);
        row.next = until(() => d.wave() === n + 1 && playing(), 300);
      }
      rows.push(row);
    }
    const won = until(() => s.victoryOverlay.visible, 120);
    return { rows, won, state: d.state(), interludes: d.interludes(), transition: d.transition() };
  });

  run.rows.forEach((row: any, i: number) => {
    const n = i + 1;
    const w = RUN[i];
    expect(row, `wave ${n}`).toMatchObject({ wave: n, act: w.act, kind: w.boss ?? w.kind, won: false, cleared: true });
    expect(row.state, `wave ${n}`).toBe(w.field ? 'live' : 'boss');
    if (n < 10) {
      expect(row.banner, `banner announces wave ${n + 1}`).toBe(true);
      expect(row.next, `wave ${n + 1} starts`).toBe(true);
    }
  });
  // The command-ship win leaves the field clean and continues the run (no victory card).
  expect(run.rows[5].afterBoss).toEqual({ escorts: 0, links: 0, bossActive: false });
  // The boss-drop (#26) and act-transition (#29) seams fire at the right waves, in order.
  expect(run.interludes).toEqual(['drop:3', 'act:1-2', 'drop:6', 'act:2-3', 'drop:9', 'act:3-4']);
  expect(run.won).toBe(true);
  expect(run.state).toBe('won');
  // The fleet flew across once per act change, and not after the finale (#29).
  expect(run.transition).toEqual({ phase: 'idle', offsetX: 0, starScale: STARFIELD.speedScale, flights: ['1-2', '2-3', '3-4'] });
});

/** Clear wave 3 (act 1's last wave) and sample the flyby (#29) every fixed
 *  step until wave 4 is live: the transition's phase, fleet offset and star
 *  speed, whether the banner shows, and the run's state. */
async function flyAct1To2(page: Page) {
  await debug(page, 'jumpToWave(3)');
  await debug(page, 'clearWave()');
  return page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const d = s.__debug;
    const samples: any[] = [];
    for (let n = 0; n < 800 && !(d.wave() === 4 && d.state() === 'live'); n++) {
      w.__step();
      const banner = s.waveDirector.banner.numerals.every((t: any) => t.text === '4');
      samples.push({ ...d.transition(), banner, state: d.state() });
    }
    return { samples, wave: d.wave(), state: d.state() };
  });
}

test('between acts the fleet flies across, the stars rush, then it is back in place (#29)', async ({ page }) => {
  await gotoGame(page);
  const { samples, wave, state } = await flyAct1To2(page);
  expect({ wave, state }).toEqual({ wave: 4, state: 'live' });

  const flying = samples.filter((s) => s.phase === 'out' || s.phase === 'in');
  const out = samples.filter((s) => s.phase === 'out');
  const back = samples.filter((s) => s.phase === 'in');
  // Left to right: the out leg only moves right, and leaves the screen.
  for (let i = 1; i < out.length; i++) expect(out[i].offsetX).toBeGreaterThanOrEqual(out[i - 1].offsetX);
  expect(Math.max(...out.map((s) => s.offsetX))).toBeGreaterThan(GAME_WIDTH);
  // Then it comes in from the left, still moving right, and settles in its slot.
  expect(back[0].offsetX).toBeLessThan(0);
  for (let i = 1; i < back.length; i++) expect(back[i].offsetX).toBeGreaterThanOrEqual(back[i - 1].offsetX);
  // The stars rush mid-flight and settle back to cruise.
  expect(Math.max(...flying.map((s) => s.starScale))).toBeGreaterThan(ACT_TRANSITION.starRush * 0.9);
  const last = samples[samples.length - 1];
  expect(last).toMatchObject({ phase: 'idle', offsetX: 0, starScale: STARFIELD.speedScale, flights: ['1-2'] });
  // Nothing else happens meanwhile: the run stays between waves, no banner yet.
  expect(samples.filter((s) => s.phase !== 'idle').every((s) => s.state === 'between' && !s.banner)).toBe(true);
  expect(samples.some((s) => s.banner)).toBe(true); // the banner follows the flyby
  // It doesn't drag on: the flyby lasts about its dials (the lead-in also waits
  // for the rebuilt ships to show, which takes less than that here).
  const flybyMs = samples.filter((s) => s.phase !== 'idle').length * 16;
  const dialsMs = ACT_TRANSITION.leadInMs + ACT_TRANSITION.outMs + ACT_TRANSITION.inMs;
  expect(flybyMs).toBeGreaterThanOrEqual(dialsMs - 32);
  expect(flybyMs).toBeLessThanOrEqual(dialsMs + 64);
});

test('a fleet still being rebuilt finishes before it takes off (#29)', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(3)');
  await loseShips(page, 0, 1, 2); // three rebuilds, staggered past the lead-in
  await debug(page, 'clearWave()');
  const { done, steps } = await stepUntil(page, "s.__debug.transition().phase === 'out'", 300);
  expect(done).toBe(true);
  // The last ship reappears 2 staggers after the clear, then its bubble settles in.
  expect(steps * 16).toBeGreaterThanOrEqual(2 * BREATHER.shipRestoreStaggerMs + REGROW.durationMs);
  expect(await debug(page, 'fleet()')).toEqual(['shielded', 'shielded', 'shielded', 'shielded']);
});

test('the flyby can be skipped, and a wave jump cancels it (#29)', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(3)');
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, "s.__debug.transition().phase === 'out' && s.__debug.transition().offsetX > 50", 300)).done).toBe(true);
  await debug(page, 'skipTransition()');
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', offsetX: 0, starScale: STARFIELD.speedScale });
  // Skipping counts as finishing: the banner and wave 4 follow.
  expect((await stepUntil(page, "s.__debug.wave() === 4 && s.__debug.state() === 'live'", 300)).done).toBe(true);

  // A jump mid-flight snaps the fleet home and drops the rest of the breather.
  await debug(page, 'jumpToWave(6)'); // the command ship: act 2's last wave
  await debug(page, 'snapBossIn()');
  await stepGame(page, 16, 1);
  await debug(page, 'defeatBoss()');
  expect((await stepUntil(page, "s.__debug.transition().phase === 'in'", 400)).done).toBe(true);
  await debug(page, 'jumpToWave(2)');
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', offsetX: 0, starScale: STARFIELD.speedScale });
  await stepGame(page, 16, 400);
  expect(await runState(page)).toMatchObject({ wave: 2, state: 'live' });
});

test('the flyby waits for the boss drop to finish (#29 AC3)', async ({ page }) => {
  await gotoGame(page);
  // Hold the boss-drop seam open, as #26's pods will until they're collected or gone.
  await page.evaluate(() => {
    const w = window as any;
    const hooks = w.__game.scene.keys['Sandbox'].waveDirector.run.hooks;
    hooks.bossDrop = (_wave: unknown, done: () => void) => {
      w.__releaseDrop = done;
    };
  });
  await debug(page, 'jumpToWave(3)');
  await debug(page, 'clearWave()');
  await stepGame(page, 16, 300);
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', offsetX: 0, flights: [] });
  expect(await debug(page, 'state()')).toBe('between');
  await page.evaluate(() => (window as any).__releaseDrop());
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'leadIn', flights: ['1-2'] });
});

test('shots fired during the flyby hit nothing and break nothing (#29)', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(3)');
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, "s.__debug.transition().phase === 'out' && s.__debug.transition().offsetX > 100", 300)).done).toBe(true);
  const hits = await debug<number>(page, 'hits()');
  // A FIRE round straight through the moving fleet's row, and a SPECIAL
  // through the seat's real shot path (its missile looks for a target).
  const at = { x: 300, y: sublaneCenterY(1) };
  await page.evaluate(({ x, y }) => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    s.fireShot('rocket-p1', 'p1', x, y, -1, 0, { button: 'fire', charged: true });
    s.fireShot('rocket-p2', 'p2', x, y + 40, -1, 0, { button: 'special', charged: false });
  }, at);
  expect((await stepUntil(page, "s.__debug.wave() === 4 && s.__debug.state() === 'live'", 400)).done).toBe(true);
  expect(await debug(page, 'hits()')).toBe(hits);
  expect(await debug(page, 'fleet()')).toEqual(['shielded', 'shielded', 'shielded', 'shielded']);
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', offsetX: 0, flights: ['1-2'] });
});

/** Lose the current wave through the real fleet-contact path: lose ships 1-3
 *  and pop ship 0's shield, then field a rock at ship 0's bare hull and step
 *  it into contact. */
async function loseRun(page: Page): Promise<void> {
  await loseShips(page, 1, 2, 3);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(0)`);
  await fieldRock(page, { x: FLEET.noseX, y: sublaneCenterY(0) });
  await stepGame(page, 16, 2);
  expect(await failVisible(page)).toBe(true);
}

/** Tap the fail card (its full-field zone) and step the scene restart through. */
async function tryAgain(page: Page): Promise<void> {
  await page.evaluate(`${SCENE}.failOverlay.tapZone.emit('pointerdown')`);
  await stepGame(page, 16, 2);
}

test('Try again after a loss restarts at the first wave of that act', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(5)');
  expect(await debug(page, 'wave()')).toBe(5);
  await loseRun(page);
  await tryAgain(page);
  expect(await runState(page)).toMatchObject({ wave: 4, act: 2, state: 'live', failVisible: false });
  // Restarting at an act's first wave doesn't replay the flyby into it (#29).
  expect(await debug(page, 'transition()')).toEqual({ phase: 'idle', offsetX: 0, starScale: STARFIELD.speedScale, flights: [] });

  // A win after that retry goes back to the join screen (#20), and the next run
  // starts fresh at wave 1, not at the retry wave (Phaser keeps the last
  // restart's data unless given new data).
  await debug(page, 'jumpToWave(10)');
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, 's.victoryOverlay.visible', 200)).done).toBe(true);
  await page.evaluate(`${SCENE}.victoryOverlay.tapZone.emit('pointerdown')`);
  await stepGame(page, 16, 2);
  expect(await sceneActive(page, 'Join')).toBe(true);
  await page.evaluate(`${JOIN_SCENE}.__debug.startRun({ p1: 'normal', p2: 'normal' })`);
  await stepGame(page, 16, 2);
  expect(await runState(page)).toMatchObject({ wave: 1, act: 1, state: 'live' });
});

test('?wave=N boots at wave N, and Try again retries that wave', async ({ page }) => {
  await gotoGame(page, '?wave=9');
  expect(await runState(page)).toMatchObject({ wave: 9, act: 3, kind: 'monsterBoss', state: 'live' });
  await loseRun(page);
  await tryAgain(page);
  expect(await debug(page, 'wave()')).toBe(9); // the shortcut pins the retry, not act 3's start

  // Past the shortcut's wave, Try again is the act's first wave again (act 4 = wave 10).
  await debug(page, 'jumpToWave(10)');
  await loseRun(page);
  await tryAgain(page);
  expect(await debug(page, 'wave()')).toBe(10);
});

test('wave solver uses only standards and three-hit splitters', () => {
  const specs = solveWave(0.75, 0);
  expect(specs.every((spec) => spec.kind === 'standard' || spec.kind === 'splitter')).toBe(true);
  expect(specs.every((spec) => spec.radius === ASTEROID_KIND[spec.kind].radius)).toBe(true);
  const cost = specs.reduce((sum, spec) => sum + clearDamage(spec), 0);
  expect(cost).toBeGreaterThan(specs.length); // a splitter contributes 3, not 2
});

test('solo scales wave targets; two-player targets are untouched', () => {
  // SOLO.requiredScale ships at 1.0, so drive the wiring with an explicit scale.
  for (const w of RUN.flatMap((r) => (r.field ? [r.field] : []))) {
    expect(waveTarget(w, 2, 0.5)).toBe(w.required);
    expect(waveTarget(w, 1, 0.5)).toBeCloseTo(w.required * 0.5, 10);
    expect(waveTarget(w, 1)).toBeCloseTo(w.required * SOLO.requiredScale, 10);
    // Break-even is over the seats in play: per unit of required damage/s, one
    // seat must land twice the share two seats do (whatever SOLO's scale is).
    const perRequired = (players: 1 | 2) => breakEvenAccuracy(w, players) / requiredDamagePerSec(w, players);
    expect(requiredDamagePerSec(w, 1)).toBeGreaterThan(0);
    expect(perRequired(1) / perRequired(2)).toBeCloseTo(2, 10);
  }
});

test('break-even accuracy is over both ammo pools (#22)', () => {
  // A seat's ceiling = FIRE rounds (1/s × 1 damage) + SPECIAL missiles
  // (1 per 3s × 1 damage) = 4/3 damage/s. Pinned as numbers, so a wrong pool,
  // rate or damage key in the formula fails here.
  expect([AMMO_REGEN_MS, SPECIAL.regenMs, DAMAGE.fire, DAMAGE.missile]).toEqual([1000, 3000, 1, 1]);
  const w = RUN.flatMap((r) => (r.field ? [r.field] : []))[0];
  expect(breakEvenAccuracy(w, 2)).toBeCloseTo(requiredDamagePerSec(w, 2) / (2 * (4 / 3)), 10);
  expect(breakEvenAccuracy(w, 1)).toBeCloseTo(requiredDamagePerSec(w, 1) / (4 / 3), 10);
});
