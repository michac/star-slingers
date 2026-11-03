/**
 * solo.spec.ts — one joined seat (#6, #20): one-seat escort rule, the empty top seat hidden and ignored.
 * Joining through the join screen itself is join.spec.ts.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, escortsAlive, hitEscort, escortLocks, enterBoss, shieldLinks, touchscreen, v2Layout, liveShots, mirrored, seats, type Page } from './helpers';

const hudCount = (page: Page) => page.evaluate(`${SCENE}.scoreKeeper.huds.length`) as Promise<number>;
/** Per-seat copies of the wave banner's numeral / an end card's text. */
const bannerCopies = (page: Page) => page.evaluate(`${SCENE}.waveDirector.banner.numerals.length`) as Promise<number>;
const overlayCopies = (page: Page, which: 'failOverlay' | 'victoryOverlay') =>
  page.evaluate(`${SCENE}.${which}.container.list.filter((o) => o.type === 'Text').length`) as Promise<number>;

test('solo: one player downs an escort with two of their own hits', async ({ page }) => {
  // Solo (#6 slice): an escort still takes two hits, but a repeat from the
  // one seat fills the absent seat's lock instead of being rejected. (Two-player
  // rejection of a repeat colour is covered by the co-op boss case in boss.spec.ts.)
  await gotoGame(page, '', { p2: 'normal' });
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
  await gotoGame(page, '', { p2: 'normal' });
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
