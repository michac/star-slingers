/**
 * giant.spec.ts — the giant-asteroid boss (#25), wave 3: it comes alone and
 * drifts at the fleet; only charged rounds hurt it (any one in solo, a pair
 * across seats in two-player); reaching the fleet loses the whole fleet;
 * popping it bursts it into one-hit rocks, and the wave clears (then the boss
 * drop runs) once they're gone. Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, stepUntil, healthBars, fleetStates, failVisible, clearField, type Page } from './helpers';
import { FLEET, GAME_WIDTH, GIANT_LAYOUT, LANE, SUBLANE_H } from '../src/layout';
import { ASTEROID_KIND, BOSS_DROPS, GIANT, RUN } from '../src/waves';
import type { Lineup } from '../src/lineup';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Giant = { active: boolean; hp: number; maxHp: number; lock: string | null; x: number; y: number; r: number; visible: boolean };
const giant = (page: Page) => page.evaluate(`${SCENE}.__debug.giant()`) as Promise<Giant>;
const hitGiant = (page: Page, player: 'p1' | 'p2', charged = true) =>
  page.evaluate(`${SCENE}.__debug.hitGiant('${player}', ${charged})`) as Promise<string>;
const state = (page: Page) => page.evaluate(`${SCENE}.__debug.state()`) as Promise<string>;

/** Boot at the giant's wave (both seats by default; `{ p1: 'normal' }` for solo)
 *  and move it on-screen at x, still drifting. */
async function bootGiant(page: Page, x = 220, lineup?: Partial<Lineup>): Promise<void> {
  await gotoGame(page, '?wave=3', lineup);
  await page.evaluate(`${SCENE}.__debug.setGiantX(${x})`);
  await stepGame(page, 16, 1);
}

/** Fire one of `player`'s rounds straight right along the giant's row from
 *  x=60 and step until it's spent. Returns the steps it flew. */
const shootGiant = (page: Page, player: 'p1' | 'p2', opts: string, afterFire = '') =>
  page.evaluate(
    `(() => {
      const w = window, s = w.__game.scene.keys['Sandbox'];
      const r = s.rockets.fire('rocket-${player}', 60, ${GIANT_LAYOUT.y}, 350, 0, '${player}', ${opts});
      ${afterFire}
      let n = 0;
      for (; n < 60 && r.active; n++) w.__step();
      return n;
    })()`
  ) as Promise<number>;

test('wave 3 is the giant alone: far bigger than any rock, entering at the right edge and reaching the fleet in ~30 s', async ({ page }) => {
  expect(RUN[2]).toEqual({ act: 1, kind: 'boss', boss: 'giantAsteroid' });
  await gotoGame(page, '?wave=3');
  expect(await state(page)).toBe('boss');
  const g0 = await giant(page);
  expect(g0).toMatchObject({ active: true, visible: true, hp: GIANT.hp, maxHp: GIANT.hp, lock: null, y: GIANT_LAYOUT.y });
  expect(g0.r).toBeGreaterThanOrEqual(2 * ASTEROID_KIND.splitter.radius); // clearly bigger than every rock
  expect(g0.x - g0.r).toBeGreaterThanOrEqual(GAME_WIDTH - 1); // its leading edge starts at the right edge
  // Alone: no stream rocks.
  expect(await page.evaluate(`${SCENE}.asteroids.filter((a) => a.isActive).length`)).toBe(0);
  // Full health: no bar.
  await stepGame(page, 16, 1);
  expect(await healthBars(page)).toEqual([]);
  // Its drift speed covers the trip to the bubble fronts in GIANT.travelMs.
  const before = (await giant(page)).x;
  await stepGame(page, 16, 125); // 2 s
  const pxPerSec = (before - (await giant(page)).x) / 2;
  const tripSec = (GAME_WIDTH - FLEET.bubbleFrontX) / pxPerSec;
  expect(tripSec).toBeGreaterThan(GIANT.travelMs / 1000 - 1);
  expect(tripSec).toBeLessThan(GIANT.travelMs / 1000 + 1);
});

test('solo: every charged round takes a point; plain rounds and missiles spark off', async ({ page }) => {
  await bootGiant(page, 220, { p1: 'normal' });
  // Each is spent ON the giant (~10 steps from x=60), not at the screen edge.
  expect(await shootGiant(page, 'p1', '{}')).toBeLessThan(25);
  expect((await giant(page)).hp).toBe(GIANT.hp);
  expect(await shootGiant(page, 'p1', '{ missile: true, target: null }', "r.setData('armAt', 1e9);")).toBeLessThan(25);
  expect((await giant(page)).hp).toBe(GIANT.hp);
  await stepGame(page, 16, 1);
  expect(await healthBars(page)).toEqual([]); // nothing landed, so still no bar
  expect(await shootGiant(page, 'p1', '{ charged: true }')).toBeLessThan(25);
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 1, lock: null });
  // A second charged hit from the same (only) seat counts too.
  await shootGiant(page, 'p1', '{ charged: true }');
  expect((await giant(page)).hp).toBe(GIANT.hp - 2);
  // Damaged: its health bar shows what's left.
  await stepGame(page, 16, 1);
  const bars = await healthBars(page);
  expect(bars).toHaveLength(1);
  expect(bars[0].frac).toBeCloseTo((GIANT.hp - 2) / GIANT.hp, 5);
});

test('two-player: a charged hit lights that seat\'s ring, and only the other seat\'s charged hit inside the window takes a point', async ({ page }) => {
  await bootGiant(page);
  // Real rounds from each seat: P1's lights its ring, P2's inside the window is the point.
  await shootGiant(page, 'p1', '{ charged: true }');
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp, lock: 'p1' });
  await shootGiant(page, 'p2', '{ charged: true }');
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 1, lock: null });

  // The same seat twice just relights its own ring.
  expect(await hitGiant(page, 'p2')).toBe('locked');
  expect(await hitGiant(page, 'p2')).toBe('locked');
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 1, lock: 'p2' });
  // A plain round or missile from the other seat is refused and leaves the ring lit.
  expect(await hitGiant(page, 'p1', false)).toBe('refused');
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 1, lock: 'p2' });
  // Unmatched: the ring lapses after the window, and nothing happened.
  await stepGame(page, 16, Math.ceil(GIANT.pairWindowMs / 16) + 1);
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 1, lock: null });
  // A charged hit after the lapse starts a new pair rather than finishing the old one.
  expect(await hitGiant(page, 'p1')).toBe('locked');
  expect((await giant(page)).hp).toBe(GIANT.hp - 1);
  // Matched just inside the window: the point.
  await stepGame(page, 16, Math.floor(GIANT.pairWindowMs / 16) - 2);
  expect(await hitGiant(page, 'p2')).toBe('damaged');
  expect(await giant(page)).toMatchObject({ hp: GIANT.hp - 2, lock: null });
});

test('missiles never home on the giant', async ({ page }) => {
  await bootGiant(page);
  // Aimed straight down its row from the left, with nothing else on the field.
  expect(await page.evaluate(`${SCENE}.pickMissileTarget(60, ${GIANT_LAYOUT.y}, 1, 0)`)).toBeNull();
});

/** Fire the seat's current SPECIAL from (x, y) along (dirx, diry), through the
 *  scene's real shot path (fireShot: the triple's fan, the bomb's bookkeeping). */
const fireSpecial = (page: Page, player: 'p1' | 'p2', x: number, y: number, dirx: number, diry: number) =>
  page.evaluate(`${SCENE}.fireShot('rocket-${player}', '${player}', ${x}, ${y}, ${dirx}, ${diry}, { button: 'special', charged: false })`);

test('#26 specials: a triple missile never takes the giant and breaks harmlessly on it', async ({ page }) => {
  await bootGiant(page);
  await page.evaluate(`${SCENE}.__debug.setSpecial(1, 'triple')`);
  await fireSpecial(page, 'p1', 60, GIANT_LAYOUT.y, 1, 0);
  const missiles = (await page.evaluate(
    `${SCENE}.rockets.group.getChildren().filter((r) => r.active && r.getData('missile')).map((r) => r.getData('target'))`
  )) as unknown[];
  expect(missiles).toEqual([null, null, null]); // three missiles, none locked on the giant
  // They fly on (re-acquiring along their headings: never the giant) and are spent on it or the edge.
  expect((await stepUntil(page, "!s.rockets.group.getChildren().some((r) => r.active && r.getData('missile'))", 200)).done).toBe(true);
  expect(await giant(page)).toMatchObject({ active: true, hp: GIANT.hp, lock: null });
});

test('#26 specials: a detonator bomb blows up on the giant without hurting it, and the seat can bomb again', async ({ page }) => {
  await bootGiant(page);
  await page.evaluate(`${SCENE}.__debug.setSpecial(1, 'detonator')`);
  // Straight down onto its top rim: the bomb touches it and blows up there,
  // with the giant well inside the blast.
  await fireSpecial(page, 'p1', 220, LANE.top + 10, 0, 1);
  expect(await page.evaluate(`${SCENE}.__debug.bomb(1)`)).not.toBeNull();
  expect((await stepUntil(page, 's.__debug.bomb(1) === null', 60)).done).toBe(true);
  expect(await giant(page)).toMatchObject({ active: true, hp: GIANT.hp, lock: null });
  // The seat's bomb is spent (not stuck "in flight"), so its next SPECIAL sends another.
  await fireSpecial(page, 'p1', 220, LANE.top + 10, 0, 1);
  expect(await page.evaluate(`${SCENE}.__debug.bomb(1)`)).not.toBeNull();
});

test('the giant reaching the fleet loses the whole fleet and shows the fail card', async ({ page }) => {
  await bootGiant(page, FLEET.bubbleFrontX + GIANT_LAYOUT.radius + 4);
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'shielded', 'shielded']);
  expect((await stepUntil(page, 's.failOverlay.visible', 60)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['lost', 'lost', 'lost', 'lost']);
  expect(await failVisible(page)).toBe(true);
});

test('popping it bursts it into one-hit rocks; the wave clears once they are gone, then its upgrade pods drop', async ({ page }) => {
  await bootGiant(page);
  // Every pair in one evaluate: P1 locks, P2 takes the point.
  const results = (await page.evaluate(
    `(() => { const d = ${SCENE}.__debug, r = []; for (let i = 0; i < ${GIANT.hp}; i++) { d.hitGiant('p1', true); r.push(d.hitGiant('p2', true)); } return r; })()`
  )) as string[];
  expect(results).toEqual([...Array(GIANT.hp - 1).fill('damaged'), 'popped']);
  expect(await giant(page)).toMatchObject({ active: false, hp: 0 });
  const burst = (await page.evaluate(
    `${SCENE}.asteroids.filter((a) => a.isActive && a.isChild).map((a) => [a.spec.kind, a.maxHp])`
  )) as [string, number][];
  expect(burst).toHaveLength(GIANT.burstCount);
  expect(burst.every(([kind, hp]) => kind === 'standard' && hp === 1)).toBe(true);
  // The wave plays on while the burst rocks are out, and the drop hasn't run.
  await stepGame(page, 16, 30);
  expect(await state(page)).toBe('live');
  expect(await page.evaluate(`${SCENE}.__debug.interludes()`)).toEqual([]);
  // Once they're gone (taken off at once: a pop's fade is a wall-clock tween
  // that stepping doesn't advance), the wave clears into the boss drop.
  await clearField(page);
  expect((await stepUntil(page, "s.__debug.state() === 'between'", 5)).done).toBe(true);
  expect((await page.evaluate(`${SCENE}.__debug.interludes()`) as string[])[0]).toBe('drop:3');
  // AC3: the giant's two upgrade pods (#26) are up.
  expect(await page.evaluate(`${SCENE}.__debug.pods()`)).toMatchObject({ phase: 'live', kinds: [...BOSS_DROPS.giantAsteroid] });
});

test('the burst spreads over all four sublanes, and the charged round that popped the giant spares its rocks', async ({ page }) => {
  await bootGiant(page, 220, { p1: 'normal' });
  // Solo, down to its last point, then a real 560 px/s charged round from the
  // top seat straight down through it: it pops the giant and carries on.
  for (let i = 0; i < GIANT.hp - 1; i++) await hitGiant(page, 'p1');
  const fired = (await page.evaluate(
    `(() => {
      const w = window, s = w.__game.scene.keys['Sandbox'];
      const r = s.rockets.fire('rocket-p1', 220, ${LANE.top}, 0, 560, 'p1', { charged: true });
      let n = 0;
      for (; n < 120 && r.active; n++) w.__step();
      return { popped: !s.giant.isActive, steps: n };
    })()`
  )) as { popped: boolean; steps: number };
  expect(fired.popped).toBe(true);
  const live = `${SCENE}.asteroids.filter((a) => a.isActive && a.isChild && !a.isPopping)`;
  expect(await page.evaluate(`${live}.length`)).toBe(GIANT.burstCount); // none died to the popping round
  expect(await page.evaluate(`${SCENE}.__debug.score()`)).toBe(0);
  // After the scatter the rocks sit across every sublane, so every ship is threatened.
  await stepGame(page, 16, Math.ceil(GIANT_LAYOUT.burst.scatterMs / 16) + 2);
  const sublanes = (await page.evaluate(`${live}.map((a) => Math.floor((a.sprite.y - ${LANE.top}) / ${SUBLANE_H}))`)) as number[];
  expect(new Set(sublanes)).toEqual(new Set([0, 1, 2, 3]));
  // And they outlive the trip to the fleet, even from a pop at the right edge.
  const tripMs = ((GAME_WIDTH + GIANT_LAYOUT.radius - FLEET.bubbleFrontX) / GIANT_LAYOUT.burst.childSpeed) * 1000;
  expect(GIANT_LAYOUT.burst.lifetimeMs).toBeGreaterThan(tripMs);
});
