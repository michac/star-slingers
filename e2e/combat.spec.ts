/**
 * combat.spec.ts — rocket vs asteroid: boot, hits, score, FIRE damage + charged pass-through, the SPECIAL missile, splitters, hp.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, shot, stepGame, stepUntil, fieldRock, fire, healthBars, touchscreen, v2Layout, liveShots, type Page } from './helpers';
import { GAME_WIDTH, HEALTH_BAR, MISSILE } from '../src/layout';
import { ASTEROID_KIND } from '../src/waves';

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

// ---- shot rules (#22): FIRE rounds (plain / charged) and the SPECIAL missile ----

/** Take every rock off the field at once (no score), so a case owns the field. */
const clearField = (page: Page) =>
  page.evaluate(`for (const a of ${SCENE}.asteroids) if (a.isActive) a.vanish()`);
/** A lane rock's state: hp left, and alive = fielded and not popping (the pop
 *  tween is wall-clock, so under stepping a killed rock stays isPopping). */
const rock = (page: Page, slot: number) =>
  page.evaluate(
    `(() => { const a = ${SCENE}.asteroids[${slot}]; return { hp: a.hp, alive: a.isActive && !a.isPopping }; })()`
  ) as Promise<{ hp: number; alive: boolean }>;
const liveRockets = (page: Page) => page.evaluate(`${SCENE}.rockets.group.countActive(true)`) as Promise<number>;
/** Fire a P1 FIRE round straight right along y=300, through the pool's shot options. */
const fireRound = (page: Page, charged: boolean) =>
  page.evaluate(`void ${SCENE}.rockets.fire('rocket-p1', 170, 300, 400, 0, 'p1', { charged: ${charged} })`);

test('an uncharged FIRE round does 1 damage and stops at the first rock', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  // Two rocks on the round's line: a 2-hp one in front, a 1-hp one behind.
  await fieldRock(page, { x: 230, y: 300, hp: 2, slot: 0 });
  await fieldRock(page, { x: 300, y: 300, slot: 1 });
  await fireRound(page, false);
  await stepGame(page, 16, 40); // a round that carried on would reach x=300 by ~step 20
  expect(await rock(page, 0)).toEqual({ hp: 1, alive: true });
  expect(await rock(page, 1)).toEqual({ hp: 1, alive: true });
  expect(await liveRockets(page)).toBe(0);
});

test('a charged FIRE round that kills carries on to the next rock', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  await fieldRock(page, { x: 230, y: 300, slot: 0 });
  await fieldRock(page, { x: 300, y: 300, slot: 1 });
  await fireRound(page, true);
  const both = await stepUntil(page, 's.asteroids[0].isPopping && s.asteroids[1].isPopping', 60);
  expect(both.done).toBe(true);
  expect(await score(page)).toBe(20);
});

test('a charged FIRE round does 2 damage and stops in a rock it does not kill', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  await fieldRock(page, { x: 230, y: 300, hp: 3, slot: 0 });
  await fieldRock(page, { x: 300, y: 300, slot: 1 });
  await fireRound(page, true);
  await stepGame(page, 16, 40);
  expect(await rock(page, 0)).toEqual({ hp: 1, alive: true });
  expect(await rock(page, 1)).toEqual({ hp: 1, alive: true });
  expect(await liveRockets(page)).toBe(0);
});

test('a SPECIAL missile connects with a moving rock from a rough aim', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  // A rock drifting left at wave speed (lanes cruise at ~40-70 px/s).
  const rx = 320, ry = 300, speed = 65;
  await page.evaluate(
    ({ rx, ry, speed, radius }) => {
      const a = (window as any).__game.scene.keys['Sandbox'].asteroids[0];
      a.reconfigure({ kind: 'standard', radius, y: ry, speed }, 0);
      a.spawn();
      a.sprite.setPosition(rx, ry);
      a.sprite.body.reset(rx, ry);
      a.sprite.body.setVelocityX(-speed);
    },
    { rx, ry, speed, radius: ASTEROID_KIND.standard.radius }
  );
  // The bottom seat aims 35° off its launcher→rock line (to the rock's left).
  const L = await v2Layout(page, 2);
  const onLineDeg = (Math.atan2(L.anchor.y - ry, rx - L.anchor.x) * 180) / Math.PI;
  const aimDeg = onLineDeg + 35;
  await page.evaluate(`${SCENE}.controls[1].aimDeg = ${aimDeg}`);
  // That aim misses outright on a straight line, and would not have locked
  // under the old HOME rule (cone 25°, ray within 50px of the rock's centre).
  const a = (aimDeg * Math.PI) / 180;
  const perp = Math.abs((rx - L.anchor.x) * -Math.sin(a) - (ry - L.anchor.y) * Math.cos(a));
  expect(perp).toBeGreaterThan(50);
  expect(35).toBeLessThan(MISSILE.coneHalfAngleDeg);

  const hitsBefore = await hits(page);
  const t = await touchscreen(page);
  await t.down(1, L.special.x, L.special.y);
  await t.up(1);
  const [missile] = await liveShots(page);
  expect(missile.missile).toBe(true);
  expect(missile.targetIsRock0).toBe(true);
  const hit = await stepUntil(page, `s.__debug.hits() > ${hitsBefore}`, Math.ceil(MISSILE.lifetimeMs / 16));
  expect(hit.done).toBe(true);
  expect((await rock(page, 0)).alive).toBe(false);
});

test('a SPECIAL missile whose target dies takes the next enemy along its heading', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  const L = await v2Layout(page, 2);
  // A sits on the boot aim (straight up), B off to the right: a missile that
  // flew straight on after losing A would pass B by 60px (> its 13px radius).
  await fieldRock(page, { x: L.anchor.x, y: 350, slot: 0 });
  await fieldRock(page, { x: L.anchor.x + 60, y: 280, slot: 1 });
  const t = await touchscreen(page);
  await t.down(1, L.special.x, L.special.y);
  await t.up(1);
  expect((await liveShots(page))[0].targetIsRock0).toBe(true);
  await stepGame(page, 16, 12); // armed and turning, still well short of A
  await page.evaluate(`${SCENE}.asteroids[0].vanish()`); // A dies by other means
  const hitB = await stepUntil(page, 's.asteroids[1].isPopping', Math.ceil(MISSILE.lifetimeMs / 16));
  expect(hitB.done).toBe(true);
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
  // the hit counter isolates them on the fixed-timestep clock. Its health bar
  // (#23) is absent at full hp, shows the remaining fraction off the rock's
  // right side after each non-lethal hit, and goes on the kill.
  await fieldRock(page, { x: 250, y: 300, hp: 3 });
  const hitsBefore = await hits(page);
  const hp = () => page.evaluate(`${SCENE}.__debug.asteroidHp(0)`) as Promise<number>;
  const active = () => page.evaluate(`${SCENE}.asteroids[0].isActive && !${SCENE}.asteroids[0].isPopping`);
  const rockAt = () => page.evaluate(`({ x: ${SCENE}.asteroids[0].sprite.x, y: ${SCENE}.asteroids[0].sprite.y, r: ${SCENE}.asteroids[0].radius })`) as Promise<{ x: number; y: number; r: number }>;
  /** The one bar sits beside the rock's current position. */
  const expectBarBeside = async (frac: number) => {
    const bars = await healthBars(page);
    const rock = await rockAt();
    expect(bars).toHaveLength(1);
    expect(bars[0].frac).toBeCloseTo(frac, 5);
    expect(bars[0].x).toBeCloseTo(rock.x + rock.r + HEALTH_BAR.gap + HEALTH_BAR.width / 2, 5);
    expect(bars[0].y).toBeCloseTo(rock.y, 5);
  };
  expect(await hp()).toBe(3);
  await stepGame(page, 16, 1);
  expect(await healthBars(page)).toEqual([]); // full hp: no bar

  for (const [n, hpLeft] of [[1, 2], [2, 1]] as const) {
    await fire(page, 170, 300, 400, 0);
    const hit = await stepUntil(page, `s.__debug.hits() >= ${hitsBefore + n}`, 120);
    expect(hit.done).toBe(true);
    expect(await hp()).toBe(hpLeft);
    expect(await score(page)).toBe(0); // a non-lethal hit never scores
    expect(await active()).toBe(true); // ...and the rock stays in play
    await expectBarBeside(hpLeft / 3);
  }

  // The bar moves with its rock: drift it down for a few real frames (Arcade
  // syncs the sprite in postUpdate, which the bar draws after), then park it.
  await page.evaluate(`${SCENE}.asteroids[0].sprite.body.setVelocity(0, 240)`);
  await stepGame(page, 16, 5);
  await page.evaluate(`${SCENE}.asteroids[0].sprite.body.setVelocity(0, 0)`);
  await stepGame(page, 16, 1);
  const moved = await rockAt();
  expect(moved.y).toBeGreaterThan(310);
  await expectBarBeside(1 / 3);

  await fire(page, 170, moved.y, 400, 0);
  const popped = await stepUntil(page, `s.__debug.score() >= 10`, 120);
  expect(popped.done).toBe(true);
  expect(await hits(page)).toBe(hitsBefore + 3);
  expect(await score(page)).toBe(10); // a standard's points, awarded once on the kill
  expect(await healthBars(page)).toEqual([]); // the bar goes with the rock
});

test('a health bar near the right edge flips to the rock\'s left side', async ({ page }) => {
  await gotoGame(page);

  // A rock chipped just after it enters (e.g. by a missile) sits so close to
  // the right edge that a right-side bar would be off-screen (#23), so the bar
  // takes the rock's left side instead and stays on the field.
  await fieldRock(page, { x: GAME_WIDTH - 10, y: 300, hp: 3 });
  await page.evaluate(`${SCENE}.asteroids[0].takeHit(1)`);
  await stepGame(page, 16, 1);
  const bars = await healthBars(page);
  const rock = (await page.evaluate(`({ x: ${SCENE}.asteroids[0].sprite.x, r: ${SCENE}.asteroids[0].radius })`)) as { x: number; r: number };
  expect(bars).toHaveLength(1);
  expect(bars[0].frac).toBeCloseTo(2 / 3, 5);
  expect(bars[0].x).toBeCloseTo(rock.x - rock.r - HEALTH_BAR.gap - HEALTH_BAR.width / 2, 5);
  expect(bars[0].x + HEALTH_BAR.width / 2).toBeLessThanOrEqual(GAME_WIDTH);
});
