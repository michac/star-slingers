/**
 * combat.spec.ts — rocket vs asteroid: boot, hits, score, homing, railgun pierce, splitters, hp.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, shot, stepUntil, fieldRock, fire, type Page } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const hits = (page: Page) => page.evaluate(`${SCENE}.__debug.hits()`) as Promise<number>;
const score = (page: Page) => page.evaluate(`${SCENE}.__debug.score()`) as Promise<number>;
const splitCount = (page: Page) => page.evaluate(`${SCENE}.__debug.splitCount()`) as Promise<number>;
const childrenAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.childrenAlive()`) as Promise<number>;

test('boots clean — canvas renders and score is 0', async ({ page }) => {
  await gotoGame(page);
  await shot(page, 'smoke-boot.png');
  // Scoring seam (B6): the shared score starts at 0 and must climb once a pop
  // lands. (The one check the old smoke already threw on.)
  expect(await score(page)).toBe(0);
});

test('head-on rocket ticks the hit counter', async ({ page }) => {
  await gotoGame(page);

  // Field a rock directly (drift-free) and fire a head-on rocket from its left;
  // the cumulative hit counter must tick. On the fixed-timestep clock this is
  // deterministic — no waiting for a wave rock to drift into range, and no
  // dependency on which toughness the difficulty solver happened to pick.
  const hitsBefore = await hits(page);
  await fieldRock(page, { x: 250, y: 300 });
  await fire(page, 170, 300, 400, 0);

  const ticked = await stepUntil(page, `s.__debug.hits() > ${hitsBefore}`, 120);
  await shot(page, 'smoke-hit.png');
  expect(ticked.done).toBe(true); // the shot reaches the rock near step ~13
  expect(await hits(page)).toBeGreaterThan(hitsBefore);
});

test('one splitter hit scores and creates children', async ({ page }) => {
  await gotoGame(page);

  // A splitter has no chip state: one hit immediately awards 20 and creates
  // two children. Deterministic on the fixed-timestep clock.
  await fieldRock(page, { x: 250, y: 300, kind: 'splitter' });

  await fire(page, 170, 300, 400, 0);
  const scored = await stepUntil(page, 's.__debug.score() >= 20', 120);
  expect(scored.done).toBe(true);
  expect(await score(page)).toBe(20);
  expect(await childrenAlive(page)).toBe(2);
});

test('off-axis homing shot curves in', async ({ page }) => {
  await gotoGame(page);

  // Deterministic homing check on the fixed-timestep clock (no wall-clock race).
  // Field a STATIONARY 1-hit rock in-field, clear of the station, via the public
  // reconfigure()/spawn() path (as the split case does) — removes the old
  // drift-window scan AND the moving-target race. Fire an OFF-AXIS rocket whose
  // straight path clears the rock by > its radius (a non-homing shot misses
  // below), tagged homing + locked on the rock as a HOME release would. Step
  // frames until the hit counter ticks: if it ticks within the step budget, the
  // shot curved in.
  const homingBefore = await hits(page);
  await fieldRock(page, { x: 250, y: 300 });
  await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const a = s.asteroids[0];
    // Off-axis: dy = +30 (> the 17px radius) so a straight shot misses below; a
    // small explicit armAt starts the turn-rate ramp early on the short runway.
    const r = s.rockets.fire('rocket-p1', 40, 330, 150, 0);
    r.setData('homing', true);
    r.setData('target', a);
    r.setData('speed', 150);
    r.setData('dist', 0);
    r.setData('armAt', 30);
  });

  const ticked = await stepUntil(page, `s.__debug.hits() > ${homingBefore}`, 300);
  await shot(page, 'smoke-homing.png');
  expect(ticked.done).toBe(true); // the shot connects near step ~80; ample headroom
  expect(await hits(page)).toBeGreaterThan(homingBefore);
});

test('charged shot rails through', async ({ page }) => {
  await gotoGame(page);

  // A charged shot is a RAILGUN: it pierces every asteroid in its path instead
  // of recycling on first contact. Field a rock directly, fire a charged rocket
  // head-on, then step until the rocket records a chip in its per-pass hitSet and
  // assert the SAME sprite is STILL active at that moment — proving it railed
  // through rather than recycled. (A normal shot would have been killAndHide'd by
  // handleHit on that first hit.) Fire + step + read all live in ONE evaluate, so
  // `active` is sampled in the same tick as the chip and there's no round-trip
  // race against world-bounds. Stepping one frame at a time catches the chip frame
  // before the rocket rails on to the world edge and recycles (which clears the
  // hitSet).
  await fieldRock(page, { x: 250, y: 300 });
  const pierce = (await page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const r = s.rockets.fire('rocket-p1', 170, 300, 400, 0);
    r.setData('charged', true);
    for (let n = 0; n < 60; n++) {
      const hs = r.getData('hitSet');
      if (hs && hs.size > 0) return { hit: true, active: r.active };
      w.__step();
    }
    const hs = r.getData('hitSet');
    return { hit: !!(hs && hs.size > 0), active: r.active };
  })) as { hit: boolean; active: boolean };
  await shot(page, 'smoke-pierce.png');
  expect(pierce.hit).toBe(true);
  expect(pierce.active).toBe(true);
});

test('a splitter immediately splits into two standard children', async ({ page }) => {
  await gotoGame(page);

  // One splitter hit scatters two standard-size, one-hit children that score 10
  // each. Field it directly through the public reconfigure()/spawn() path
  // (exactly what startWave does) and kill it on the fixed-timestep clock. Lane
  // wrappers are asteroids[0..3]; the child pool is the tail.
  const splitBefore = await splitCount(page);
  await fieldRock(page, { x: 260, y: 300, kind: 'splitter' });

  // One head-on rocket splits it immediately.
  await fire(page, 180, 300, 400, 0);
  const split = await stepUntil(page, `s.__debug.splitCount() > ${splitBefore}`, 120);
  expect(split.done).toBe(true);

  const kidsAlive = await childrenAlive(page);
  const scoreAfterKill = await score(page);
  await shot(page, 'smoke-split.png');
  expect(kidsAlive).toBe(2);
  expect(scoreAfterKill).toBe(20);

  // Pop the scattered children in one in-browser loop. Each is standard-size
  // and one-hit, so the two pops add exactly 20.
  const scoreDelta = (await page.evaluate((scoreAfterKill) => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    let delta = 0;
    for (let n = 0; n < 400 && delta < 20; n++) {
      if (n % 3 === 0) {
        s.asteroids.forEach((a: any) => {
          if (a.isChild && a.active && !a.popping) {
            const t = a.sprite;
            s.rockets.fire('rocket-p1', t.x + 40, t.y, -500, 0); // chase + intercept
          }
        });
      }
      w.__step();
      delta = s.__debug.score() - scoreAfterKill;
    }
    return delta;
  }, scoreAfterKill)) as number;
  expect(scoreDelta).toBe(20);
});

test('an hp-3 rock survives two hits and pops on the third', async ({ page }) => {
  await gotoGame(page);

  // Asteroid health: a rock fielded with a 3-hp override takes damage from each
  // plain shot (DAMAGE.normal = 1) but only pops — and scores — on the hit that
  // takes it to 0. Each shot is stepped to its hit before the next is fired, so
  // the hit counter isolates them on the fixed-timestep clock.
  await fieldRock(page, { x: 250, y: 300, hp: 3 });
  const hitsBefore = await hits(page);
  const hp = () => page.evaluate(`${SCENE}.__debug.asteroidHp(0)`) as Promise<number>;
  const active = () => page.evaluate(`${SCENE}.asteroids[0].isActive && !${SCENE}.asteroids[0].isPopping`);
  expect(await hp()).toBe(3);

  for (const [n, hpLeft] of [[1, 2], [2, 1]] as const) {
    await fire(page, 170, 300, 400, 0);
    const hit = await stepUntil(page, `s.__debug.hits() >= ${hitsBefore + n}`, 120);
    expect(hit.done).toBe(true);
    expect(await hp()).toBe(hpLeft);
    expect(await score(page)).toBe(0); // a non-lethal hit never scores
    expect(await active()).toBe(true); // ...and the rock stays in play
  }

  await fire(page, 170, 300, 400, 0);
  const popped = await stepUntil(page, `s.__debug.score() >= 10`, 120);
  expect(popped.done).toBe(true);
  expect(await hits(page)).toBe(hitsBefore + 3);
  expect(await score(page)).toBe(10); // a standard's points, awarded once on the kill
});
