/**
 * solo.spec.ts — ?players=1: one-seat escort rule, the top seat hidden and ignored, the choice remembered.
 * Shared harness (gotoGame, the fixed-timestep steppers, the console gate):
 * ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, escortsAlive, hitEscort, escortLocks, startBoss, touchscreen, v2Layout, liveShots, type Page, type Pt } from './helpers';
import { GAME_HEIGHT, GAME_WIDTH } from '../src/layout';

const players = (page: Page) => page.evaluate(`${SCENE}.__debug.players()`) as Promise<string>;
const seats = (page: Page) => page.evaluate(`${SCENE}.__debug.seats()`) as Promise<string[]>;
const hudCount = (page: Page) => page.evaluate(`${SCENE}.scoreKeeper.huds.length`) as Promise<number>;
/** Per-seat copies of the wave banner's numeral / an end card's text. */
const bannerCopies = (page: Page) => page.evaluate(`${SCENE}.waveDirector.banner.numerals.length`) as Promise<number>;
const overlayCopies = (page: Page, which: 'failOverlay' | 'victoryOverlay') =>
  page.evaluate(`${SCENE}.${which}.container.list.filter((o) => o.type === 'Text').length`) as Promise<number>;
/** P1's spot for a P2 point: the top seat is P2's layout rotated 180° about the centre. */
const mirrored = (p: Pt): Pt => ({ x: GAME_WIDTH - p.x, y: GAME_HEIGHT - p.y });

test('solo: one player downs an escort with two of their own hits', async ({ page }) => {
  // ?players=1 (#6 slice): an escort still takes two hits, but a repeat from the
  // one seat fills the absent seat's lock instead of being rejected. (Two-player
  // rejection of a repeat colour is covered by the co-op boss case in boss.spec.ts.)
  await gotoGame(page, '?players=1');
  await startBoss(page);
  await page.evaluate(`${SCENE}.__debug.snapBossIn()`);
  await stepGame(page, 16, 1);
  await hitEscort(page, 0, 'p2');
  expect(await escortsAlive(page)).toBe(4); // one hit is not enough
  expect((await escortLocks(page))[0]).toBe(2);
  await hitEscort(page, 0, 'p2');
  await stepGame(page, 16, 1);
  expect(await escortsAlive(page)).toBe(3);
  expect(await page.evaluate(`${SCENE}.__debug.shieldLinks()`)).toBe(2);
});

test('solo (?players=1) keeps only the bottom seat, ignores the top, and is remembered', async ({ page }) => {
  await gotoGame(page, '?players=1');
  expect(await players(page)).toBe('1');
  expect(await seats(page)).toEqual(['p2']);
  expect(await v2Layout(page, 1)).toBeNull();
  expect(await hudCount(page)).toBe(1);
  // Nothing is drawn toward the empty top seat: one wave-banner copy, and one
  // text copy on each end-of-round card.
  expect(await bannerCopies(page)).toBe(1);
  expect(await overlayCopies(page, 'failOverlay')).toBe(1);
  expect(await overlayCopies(page, 'victoryOverlay')).toBe(1);

  // Touches where P1's FIRE, HOME and aim pad would be do nothing (and throw
  // nothing: the console gate fails the case otherwise).
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  for (const p of [L.fire, L.home, L.pad]) {
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

  // Saved: a bare reload stays solo; ?players=2 brings the top seat back.
  await gotoGame(page);
  expect(await players(page)).toBe('1');
  expect(await seats(page)).toEqual(['p2']);
  await gotoGame(page, '?players=2');
  expect(await seats(page)).toEqual(['p1', 'p2']);
  expect(await v2Layout(page, 1)).not.toBeNull();
  expect(await hudCount(page)).toBe(2);
  expect(await bannerCopies(page)).toBe(2);
  expect(await overlayCopies(page, 'failOverlay')).toBe(2);
});
