/**
 * waves.spec.ts — the run and the src/waves.ts difficulty model: the 10-wave RUN table and its
 * play order, the ?wave shortcut, Try again's retry wave, the wave solver and solo target scaling.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, JOIN_SCENE, gotoGame, fieldRock, stepGame, stepUntil, type Page } from './helpers';
import {
  actStartWave,
  ASTEROID_KIND,
  breakEvenAccuracy,
  clearDamage,
  COMMAND_SHIP_WAVE,
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
  expect(startWaveFromQuery('?wave=10&lefty=p1')).toBe(10);
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
      row.banner = s.waveDirector.banner.numerals.map((t: any) => t.text);
      if (n < 10) row.next = until(() => d.wave() === n + 1 && playing(), 300);
      rows.push(row);
    }
    return { rows, won: until(() => s.victoryOverlay.visible, 120), state: d.state(), interludes: d.interludes() };
  });

  run.rows.forEach((row: any, i: number) => {
    const n = i + 1;
    const w = RUN[i];
    expect(row, `wave ${n}`).toMatchObject({ wave: n, act: w.act, kind: w.boss ?? w.kind, won: false, cleared: true });
    expect(row.state, `wave ${n}`).toBe(w.field ? 'live' : 'boss');
    if (n < 10) {
      expect(row.banner.every((t: string) => t === String(n + 1)), `banner after wave ${n}: ${row.banner}`).toBe(true);
      expect(row.next, `wave ${n + 1} starts`).toBe(true);
    }
  });
  // The command-ship win leaves the field clean and continues the run (no victory card).
  expect(run.rows[5].afterBoss).toEqual({ escorts: 0, links: 0, bossActive: false });
  // The boss-drop (#26) and act-transition (#29) seams fire at the right waves, in order.
  expect(run.interludes).toEqual(['drop:3', 'act:1-2', 'drop:6', 'act:2-3', 'drop:9', 'act:3-4']);
  expect(run.won).toBe(true);
  expect(run.state).toBe('won');
});

/** Lose the current wave through the real station-contact path: strip the
 *  shield, then field a rock touching the hull and step it into contact. */
async function loseRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    while (s.station.shieldHitsLeft > 0) s.station.onEnemyReached();
  });
  await fieldRock(page, { x: 20, y: 370 });
  await stepGame(page, 16, 2);
  expect(await page.evaluate(`${SCENE}.failOverlay.visible`)).toBe(true);
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

  // A win after that retry goes back to the join screen (#20), and the next run
  // starts fresh at wave 1, not at the retry wave (Phaser keeps the last
  // restart's data unless given new data).
  await debug(page, 'jumpToWave(10)');
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, 's.victoryOverlay.visible', 200)).done).toBe(true);
  await page.evaluate(`${SCENE}.victoryOverlay.tapZone.emit('pointerdown')`);
  await stepGame(page, 16, 2);
  expect(await page.evaluate(`window.__game.scene.isActive('Join')`)).toBe(true);
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
