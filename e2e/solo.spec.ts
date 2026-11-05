/**
 * solo.spec.ts — one joined seat (#6, #20): one-seat escort rule, the empty top seat hidden and ignored,
 * and the solo pace (the same field and boss at SOLO.pace; the pure model is in waves.spec.ts).
 * Joining through the join screen itself is join.spec.ts.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, stepUntil, escortsAlive, hitEscort, escortLocks, enterBoss, shieldLinks, touchscreen, v2Layout, liveShots, mirrored, seats, clearField, fieldRock, fire, debug, DUO, SOLO_BOTTOM, type Page } from './helpers';
import { FLEET, SPLITTER_CHILDREN } from '../src/layout';
import { BOSS, SOLO } from '../src/waves';

/** The stream rocks in play: kind, spec speed and the body's real drift. */
const fieldedRocks = (page: Page) =>
  page.evaluate(
    `${SCENE}.asteroids.filter((a) => a.isActive && !a.isChild).map((a) => ({ kind: a.spec.kind, speed: a.spec.speed, vx: a.sprite.body.velocity.x }))`
  ) as Promise<{ kind: string; speed: number; vx: number }[]>;

const hudCount = (page: Page) => page.evaluate(`${SCENE}.scoreKeeper.huds.length`) as Promise<number>;
/** Per-seat copies of the wave banner's numeral / an end card's text. */
const bannerCopies = (page: Page) => page.evaluate(`${SCENE}.waveDirector.banner.numerals.length`) as Promise<number>;
const overlayCopies = (page: Page, which: 'failOverlay' | 'victoryOverlay') =>
  page.evaluate(`${SCENE}.${which}.container.list.filter((o) => o.type === 'Text').length`) as Promise<number>;

test('solo: one player downs an escort with two of their own hits', async ({ page }) => {
  // Solo (#6 slice): an escort still takes two hits, but a repeat from the
  // one seat fills the absent seat's lock instead of being rejected. (Two-player
  // rejection of a repeat colour is covered by the co-op boss case in boss.spec.ts.)
  await gotoGame(page, '', SOLO_BOTTOM);
  await enterBoss(page);
  await hitEscort(page, 0, 'p2');
  expect(await escortsAlive(page)).toBe(4); // one hit is not enough
  expect((await escortLocks(page))[0]).toBe(2);
  await hitEscort(page, 0, 'p2');
  await stepGame(page, 16, 1);
  expect(await escortsAlive(page)).toBe(3);
  expect(await shieldLinks(page)).toBe(2);
});

test('solo (only the bottom seat joined) keeps only the bottom seat and ignores the top', async ({ page }) => {
  await gotoGame(page, '', SOLO_BOTTOM);
  expect(await seats(page)).toEqual(['p2']);
  expect(await v2Layout(page, 1)).toBeNull();
  expect(await hudCount(page)).toBe(1);
  // Nothing is drawn toward the empty top seat: one wave-banner copy, and one
  // text copy on each end-of-round card.
  expect(await bannerCopies(page)).toBe(1);
  expect(await overlayCopies(page, 'failOverlay')).toBe(1);
  expect(await overlayCopies(page, 'victoryOverlay')).toBe(1);

  // Touches where P1's FIRE, SPECIAL and aim pad would be do nothing (and throw
  // nothing: the console gate fails the case otherwise).
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  for (const p of [L.fire, L.special, L.pad]) {
    const at = mirrored(p);
    await t.down(1, at.x, at.y);
    await stepGame(page, 16, 3);
    await t.up(1);
  }
  expect(await liveShots(page)).toHaveLength(0);

  // P2 still fires.
  await t.down(1, L.fire.x, L.fire.y);
  await stepGame(page, 16, 3);
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].player).toBe('p2');

  // The "Try again" restart (scene.restart) keeps solo.
  await page.evaluate(`${SCENE}.scene.restart()`);
  await stepGame(page, 16, 1); // the scene manager processes the restart
  expect(await liveShots(page)).toHaveLength(0); // a fresh scene: P2's shot is gone
  expect(await seats(page)).toEqual(['p2']);

  // Nothing is remembered across a reload: joining both seats then brings the
  // top seat back.
  await gotoGame(page);
  expect(await seats(page)).toEqual(['p1', 'p2']);
  expect(await v2Layout(page, 1)).not.toBeNull();
  expect(await hudCount(page)).toBe(2);
  expect(await bannerCopies(page)).toBe(2);
  expect(await overlayCopies(page, 'failOverlay')).toBe(2);
});

test('solo fields the two-player rocks of a wave, drifting at SOLO.pace (#6)', async ({ page }) => {
  await gotoGame(page, '?wave=2');
  const duo = await fieldedRocks(page);
  await gotoGame(page, '?wave=2', SOLO_BOTTOM);
  const solo = await fieldedRocks(page);
  expect(duo.some((r) => r.kind === 'tough')).toBe(true); // wave 2's two-hit rocks stay in solo
  expect(solo.map((r) => r.kind)).toEqual(duo.map((r) => r.kind));
  solo.forEach((r, i) => {
    expect(r.speed).toBeCloseTo(duo[i].speed * SOLO.pace, 6);
    expect(r.vx).toBeCloseTo(-r.speed, 6);
  });
});

test("solo: a splitter's children cruise at SOLO.pace (#6)", async ({ page }) => {
  await gotoGame(page, '', SOLO_BOTTOM);
  await clearField(page);
  await fieldRock(page, { x: 250, y: 300, kind: 'splitter' });
  await fire(page, 170, 300, 400, 0, '{}', 'p2');
  expect((await stepUntil(page, 's.__debug.childrenAlive() === 2', 60)).done).toBe(true);
  await stepGame(page, 16, Math.ceil((SPLITTER_CHILDREN.scatterMs + 200) / 16));
  const vx = (await page.evaluate(`${SCENE}.asteroids.filter((a) => a.isChild && a.isActive).map((a) => a.sprite.body.velocity.x)`)) as number[];
  expect(vx).toHaveLength(2);
  for (const v of vx) expect(v).toBeCloseTo(-SPLITTER_CHILDREN.childSpeed * SOLO.pace, 6);
});

test("solo: a splitter's slower children outlast the two-player lifetime cap, so they still reach the fleet (#6)", async ({ page }) => {
  // Popped near the right edge, a solo child needs longer than the two-player
  // cap (SPLITTER_CHILDREN.lifetimeMs) to cross the lane at its slower cruise.
  await gotoGame(page, '', SOLO_BOTTOM);
  await clearField(page);
  await fieldRock(page, { x: 320, y: 300, kind: 'splitter' });
  await fire(page, 240, 300, 400, 0, '{}', 'p2');
  expect((await stepUntil(page, 's.__debug.childrenAlive() === 2', 60)).done).toBe(true);
  await stepGame(page, 16, Math.ceil((SPLITTER_CHILDREN.lifetimeMs + 300) / 16));
  const kids = (await page.evaluate(
    `${SCENE}.asteroids.filter((a) => a.isChild && a.isActive).map((a) => ({ x: a.sprite.x, vx: a.sprite.body.velocity.x }))`
  )) as { x: number; vx: number }[];
  expect(kids).toHaveLength(2); // still in play past the two-player cap…
  for (const { x, vx } of kids) {
    expect(vx).toBeCloseTo(-SPLITTER_CHILDREN.childSpeed * SOLO.pace, 6); // …still cruising at the solo pace…
    expect(x).toBeGreaterThan(FLEET.bubbleFrontX); // …and still short of the fleet
  }
});

test('the command ship charges and regrows escorts at SOLO.pace in solo, and on the BOSS timings with two players (#6)', async ({ page }) => {
  for (const [lineup, pace] of [[DUO, 1], [SOLO_BOTTOM, SOLO.pace]] as const) {
    await gotoGame(page, '', lineup);
    await enterBoss(page);
    // The beam: all four escorts up from the start, so the charge runs until it fires.
    const beam = await stepUntil(page, "s.__debug.fleet().some((ship) => ship !== 'shielded')", 600);
    expect(beam.done).toBe(true);
    expect(Math.abs(beam.steps * 16 - BOSS.chargeMs / pace)).toBeLessThanOrEqual(32);
    // A downed escort's regen.
    await debug(page, 'killEscort(0)');
    expect(await escortsAlive(page)).toBe(3);
    const back = await stepUntil(page, 's.__debug.escortsAlive() === 4', 700);
    expect(back.done).toBe(true);
    expect(Math.abs(back.steps * 16 - BOSS.escortRegenMs / pace)).toBeLessThanOrEqual(32);
  }
});
