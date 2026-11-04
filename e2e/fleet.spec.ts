/**
 * fleet.spec.ts — the colony fleet, the enemy lane and the starfield (#19): a
 * rock hits only its own sublane's ship (shield first, then the ship), a lost
 * ship's sublane lets rocks pass harmlessly, losing all four ships (and only
 * all four) fails the run, shields regrow and the breather rebuilds, rocks fly
 * straight left and spawn evenly across the sublanes, splitter children
 * stay in the lane, and the stars scroll on the stepped clock.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, stepUntil, fieldRock, fire, fleetStates, loseShips, score, failVisible, clearField, type Page } from './helpers';
import { FLEET, LANE, SPLITTER_CHILDREN, STARFIELD, SUBLANE_H, sublaneCenterY, sublaneOf } from '../src/layout';
import { ASTEROID_KIND, RUN } from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

const R = ASTEROID_KIND.standard.radius;

/** Take every rock but stream 0's off the field (no score), so a case owns the
 *  field. The wave's quota is untouched, so the wave doesn't clear. */
const clearOthers = (page: Page) =>
  page.evaluate(`${SCENE}.asteroids.forEach((a, i) => { if (i !== 0 && a.isActive) a.vanish(); })`);
/** Stream 0's rock: where it is and whether it's been consumed (the pop tween is
 *  wall-clock, so under stepping a consumed rock stays isPopping). */
const rock0 = (page: Page) =>
  page.evaluate(
    `(() => { const a = ${SCENE}.asteroids[0]; return { x: a.sprite.x, y: a.sprite.y, popping: a.isPopping }; })()`
  ) as Promise<{ x: number; y: number; popping: boolean }>;

test('a rock hits only its own sublane\'s ship: the shield at the bubble, then the ship at the hull', async ({ page }) => {
  await gotoGame(page);
  await clearOthers(page);
  // Near ship 2's sublane's lower edge: contact goes by sublane, not by shape,
  // so a rock skimming the edge still hits its own ship and no other.
  const y = sublaneCenterY(2) + SUBLANE_H / 2 - R - 2;
  expect(sublaneOf(y)).toBe(2);

  await fieldRock(page, { x: 150, y, speed: 200 });
  expect((await stepUntil(page, 's.asteroids[0].isPopping', 120)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'exposed', 'shielded']);
  // Stopped at the bubble's front, not deeper at the hull.
  const first = await rock0(page);
  expect(first.x - R).toBeLessThanOrEqual(FLEET.bubbleFrontX);
  expect(first.x - R).toBeGreaterThan(FLEET.noseX);

  await fieldRock(page, { x: 150, y, speed: 200 });
  expect((await stepUntil(page, 's.asteroids[0].isPopping', 120)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'lost', 'shielded']);
  // With the shield popped it got in to the hull's nose.
  expect((await rock0(page)).x - R).toBeLessThanOrEqual(FLEET.noseX);
  expect(await score(page)).toBe(0); // reaching the fleet never scores
  expect(await failVisible(page)).toBe(false);
});

test('a rock in a lost ship\'s sublane flies past: no damage, no score, no fail', async ({ page }) => {
  await gotoGame(page);
  await clearOthers(page);
  await loseShips(page, 1);
  await fieldRock(page, { x: 120, y: sublaneCenterY(1), speed: 300 });
  // It crosses the fleet's line and leaves off the left edge, where the wave's
  // quota respawns it at the right edge. A consumed rock would stay popping
  // instead (wall-clock pop tween) and never get back to the right.
  const passed = await stepUntil(page, 's.asteroids[0].sprite.x > 300', 120);
  expect(passed.done).toBe(true);
  expect(await fleetStates(page)).toEqual(['shielded', 'lost', 'shielded', 'shielded']);
  expect(await score(page)).toBe(0);
  expect(await page.evaluate(`${SCENE}.__debug.hits()`)).toBe(0);
  expect(await failVisible(page)).toBe(false);
});

test('losing three ships plays on; losing the fourth shows Try again', async ({ page }) => {
  await gotoGame(page);
  await clearOthers(page);
  await loseShips(page, 0, 1, 2);
  await stepGame(page, 16, 2);
  expect(await fleetStates(page)).toEqual(['lost', 'lost', 'lost', 'shielded']);
  expect(await failVisible(page)).toBe(false);

  // The last ship goes through the real contact path: pop its shield, then
  // step a rock into its hull.
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(3)`);
  await fieldRock(page, { x: FLEET.noseX + R + 4, y: sublaneCenterY(3), speed: 200 });
  expect((await stepUntil(page, 's.failOverlay.visible', 30)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['lost', 'lost', 'lost', 'lost']);
});

test('a popped shield regrows after the wave\'s quiet stretch; the breather rebuilds lost ships', async ({ page }) => {
  await gotoGame(page);
  // An empty field for the whole quiet stretch (the quota stays, so the wave doesn't clear).
  await clearField(page);
  const regenMs = RUN[0].field!.shieldRegenMs;
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(0)`);
  await loseShips(page, 3);
  await stepGame(page, 16, Math.floor((regenMs - 200) / 16));
  expect(await fleetStates(page)).toEqual(['exposed', 'shielded', 'shielded', 'lost']);
  await stepGame(page, 16, 25);
  // Ship 0's shield is back; a lost ship never regrows mid-wave.
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'shielded', 'lost']);

  // Clear the wave: the breather rebuilds ship 3 with its shield.
  await page.evaluate(`${SCENE}.__debug.clearWave()`);
  await stepGame(page, 16, 2);
  expect(await page.evaluate(`${SCENE}.__debug.state()`)).toBe('between');
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'shielded', 'shielded']);
  expect(await page.evaluate(`${SCENE}.fleet.ships[3].image.visible`)).toBe(true);
});

test('rocks drift straight left to their ship', async ({ page }) => {
  await gotoGame(page);
  await clearOthers(page);
  // Off-centre in ship 0's sublane: it keeps that y and vy = 0 all the way in.
  const y = sublaneCenterY(0) + 25;
  await fieldRock(page, { x: 330, y, speed: 150 });
  const run = await stepUntil(
    page,
    `(s.__drift = Math.max(s.__drift ?? 0, Math.abs(s.asteroids[0].sprite.y - ${y}), Math.abs(s.asteroids[0].sprite.body.velocity.y))) >= 0 && s.asteroids[0].isPopping`,
    200
  );
  expect(run.done).toBe(true);
  expect(await page.evaluate(`${SCENE}.__drift`)).toBe(0);
  expect(await fleetStates(page)).toEqual(['exposed', 'shielded', 'shielded', 'shielded']);
});

test('spawns cover every sublane evenly and stay inside the lane', async ({ page }) => {
  await gotoGame(page);
  // Wave 1 fields all four streams at once, drawing one full round of the
  // sublane bag: one rock per sublane.
  const opening = (await page.evaluate(
    `${SCENE}.asteroids.filter((a) => a.isActive).map((a) => a.sprite.y)`
  )) as number[];
  expect(opening.map(sublaneOf).sort()).toEqual([0, 1, 2, 3]);

  // Over many spawns each sublane gets an equal share (±1 for a partly dealt
  // round), and every rock sits wholly inside its sublane.
  const ys = (await page.evaluate(
    `Array.from({ length: 40 }, () => ${SCENE}.waveDirector.pickY(${R}))`
  )) as number[];
  const counts = [0, 0, 0, 0];
  for (const y of ys) {
    const i = sublaneOf(y);
    counts[i] += 1;
    expect(Math.abs(y - sublaneCenterY(i))).toBeLessThanOrEqual(SUBLANE_H / 2 - R);
  }
  for (const n of counts) expect(Math.abs(n - 10)).toBeLessThanOrEqual(1);
});

test('splitter children scatter inside the lane, then drift straight left', async ({ page }) => {
  await gotoGame(page);
  await clearOthers(page);
  // Right under the lane's top edge, so the upward child would leave the lane
  // within its scatter burst if nothing held it in.
  const y = LANE.top + ASTEROID_KIND.splitter.radius + 2;
  await fieldRock(page, { x: 250, y, kind: 'splitter' });
  await fire(page, 170, y, 400, 0);
  expect((await stepUntil(page, 's.__debug.childrenAlive() === 2', 60)).done).toBe(true);

  const frames = Math.ceil((SPLITTER_CHILDREN.scatterMs + 200) / 16);
  const run = await stepUntil(
    page,
    `(() => {
      s.__steps = (s.__steps ?? 0) + 1;
      for (const a of s.asteroids) {
        if (!a.isChild || !a.isActive) continue;
        s.__top = Math.min(s.__top ?? Infinity, a.sprite.y - a.radius);
        s.__bottom = Math.max(s.__bottom ?? -Infinity, a.sprite.y + a.radius);
      }
      return s.__steps >= ${frames};
    })()`,
    frames + 1
  );
  expect(run.done).toBe(true);
  const span = (await page.evaluate(`({ top: ${SCENE}.__top, bottom: ${SCENE}.__bottom })`)) as { top: number; bottom: number };
  expect(span.top).toBeGreaterThanOrEqual(LANE.top - 1); // ≤ one frame's overshoot
  expect(span.bottom).toBeLessThanOrEqual(LANE.bottom);
  const velocities = (await page.evaluate(
    `${SCENE}.asteroids.filter((a) => a.isChild && a.isActive).map((a) => [a.sprite.body.velocity.x, a.sprite.body.velocity.y])`
  )) as [number, number][];
  expect(velocities).toEqual([
    [-SPLITTER_CHILDREN.childSpeed, 0],
    [-SPLITTER_CHILDREN.childSpeed, 0],
  ]);
});

test('the starfield scrolls on the game clock, near layers faster', async ({ page }) => {
  await gotoGame(page);
  const before = (await page.evaluate(`${SCENE}.__debug.starOffsets()`)) as number[];
  await stepGame(page, 16, 60); // 0.96s
  const after = (await page.evaluate(`${SCENE}.__debug.starOffsets()`)) as number[];
  STARFIELD.layers.forEach((layer, i) => {
    expect(after[i] - before[i]).toBeCloseTo(layer.speed * 0.96 * STARFIELD.speedScale, 1);
  });
});

test('a ship lost mid-shake is rebuilt level with its sublane', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  const cy = sublaneCenterY(2);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(2)`);
  // The worried shake is a wall-clock tween, which doesn't advance under
  // stepping: put the hull where the shake would have it mid-way, as a second
  // hit within ~360ms would find it.
  await page.evaluate(`${SCENE}.fleet.ships[2].image.setY(${cy + 3})`);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(2)`);
  expect((await fleetStates(page))[2]).toBe('lost');

  await page.evaluate(`${SCENE}.__debug.clearWave()`);
  expect((await stepUntil(page, 's.fleet.ships[2].image.visible', 120)).done).toBe(true);
  expect(await page.evaluate(`${SCENE}.fleet.ships[2].image.y`)).toBe(cy);
});

test('the starfield carries on across a Try again restart instead of jumping back', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  await stepGame(page, 16, 60);
  // Lose the run through the real contact path, then tap Try again.
  await loseShips(page, 1, 2, 3);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(0)`);
  await fieldRock(page, { x: FLEET.noseX, y: sublaneCenterY(0) });
  await stepGame(page, 16, 2);
  expect(await failVisible(page)).toBe(true);
  const before = (await page.evaluate(`${SCENE}.__debug.starOffsets()`)) as number[];
  expect(Math.min(...before)).toBeGreaterThan(0);

  await page.evaluate(`${SCENE}.failOverlay.tapZone.emit('pointerdown')`);
  await stepGame(page, 16, 2);
  const after = (await page.evaluate(`${SCENE}.__debug.starOffsets()`)) as number[];
  STARFIELD.layers.forEach((layer, i) => {
    // At most the restart's couple of frames further on, never back at 0.
    expect(after[i]).toBeGreaterThanOrEqual(before[i]);
    expect(after[i] - before[i]).toBeLessThanOrEqual(layer.speed * 0.05);
  });
});
