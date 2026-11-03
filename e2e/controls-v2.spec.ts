/**
 * controls-v2.spec.ts — two-thumb FIRE/HOME buttons + drag aim (#7), driven by real CDP touches.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, fieldRock, touchscreen, v2Layout, liveShots, mirrored, type LiveShot, type Page } from './helpers';
import { CONTROLS_V2, SLING } from '../src/layout';

const aimDeg = (page: Page, player: 1 | 2) => page.evaluate(`${SCENE}.__debug.aimDeg(${player})`) as Promise<number>;

/** Seat-frame units of sideways drag that turn the aim by `deg` (positive =
 *  toward the player's right, which lowers the seat-frame angle). */
const dragFor = (deg: number) => deg / CONTROLS_V2.drag.gainDegPerPx;

/** Launch direction of a shot in that seat's frame, degrees. */
const shotDeg = (shot: LiveShot, player: 1 | 2) => {
  const sign = player === 2 ? 1 : -1;
  return (Math.atan2(-sign * shot.vy, sign * shot.vx) * 180) / Math.PI;
};

test('v2: hold FIRE + drag-aim with a second finger fires an aimed railgun', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);

  await t.down(1, L.fire.x, L.fire.y);
  // No step yet: the scene's pointerdown already ran during the dispatch.
  expect(await page.evaluate(`${SCENE}.controls[1].held`)).toBe('fire');

  // Second thumb in P2's aim zone (right side of the band): touching down
  // doesn't move the aim; dragging right by 30° worth turns it to 60°.
  await t.down(2, 250, 600);
  expect(await aimDeg(page, 2)).toBe(90);
  await t.move(2, 250 + dragFor(30), 600);
  expect(await aimDeg(page, 2)).toBeCloseTo(60, 3);

  await stepGame(page, 16, 45); // 720ms of game time > CHARGE.fullMs (600)
  expect(await liveShots(page)).toHaveLength(0); // fires on release, not press
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  const [shot] = shots;
  expect(shot.player).toBe('p2');
  expect(shot.charged).toBe(true);
  expect(shot.homing).toBe(false);
  expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(SLING.maxSpeed, 3);
  expect(Math.abs(shotDeg(shot, 2) - 60)).toBeLessThan(2);
  await t.up(2);
  expect(await aimDeg(page, 2)).toBeCloseTo(60, 0); // aim persists after the thumb lifts
});

test('v2: a tap on FIRE fires one plain shot straight across', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await t.down(1, L.fire.x, L.fire.y);
  await stepGame(page, 16, 3); // ~50ms: well short of a charge
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].charged).toBe(false);
  expect(shots[0].homing).toBe(false);
  expect(Math.abs(shotDeg(shots[0], 2) - 90)).toBeLessThan(1); // boot aim = straight across
  expect(Math.hypot(shots[0].vx, shots[0].vy)).toBeCloseTo(SLING.maxSpeed, 3);
});

test('v2: releasing HOME fires a homing shot locked on the rock in line', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  // On P2's boot aim line (straight up from the launcher), inside the lanes.
  await fieldRock(page, { x: L.anchor.x, y: 400 });
  const t = await touchscreen(page);
  await t.down(1, L.home.x, L.home.y);
  expect(await page.evaluate(`${SCENE}.controls[1].held`)).toBe('home');
  // A press on FIRE while HOME is held is ignored (one button at a time).
  await t.down(2, L.fire.x, L.fire.y);
  await stepGame(page, 16, 45); // HOME never charges, however long it's held
  await t.up(2);
  expect(await liveShots(page)).toHaveLength(0);
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].homing).toBe(true);
  expect(shots[0].charged).toBe(false);
  expect(shots[0].targetIsRock0).toBe(true);
});

test('v2: the top seat is mirrored 180° (aim + fire)', async ({ page }) => {
  await gotoGame(page);
  const L1 = await v2Layout(page, 1);
  const L2 = await v2Layout(page, 2);
  // P1's controls are P2's rotated about the field centre.
  const want = { fire: mirrored(L2.fire), pad: mirrored(L2.pad) };
  expect(L1.fire.x).toBeCloseTo(want.fire.x, 5);
  expect(L1.fire.y).toBeCloseTo(want.fire.y, 5);
  expect(L1.pad.x).toBeCloseTo(want.pad.x, 5);
  const t = await touchscreen(page);
  // P1's aim zone is P2's rotated: world (60,140) is seat-frame (300,600). A
  // drag toward P1's LEFT (+x on screen, since P1 faces down the field) turns
  // the aim from 90° up to 130°.
  await t.down(1, 60, 140);
  await t.move(1, 60 + dragFor(40), 140);
  expect(await aimDeg(page, 1)).toBeCloseTo(130, 3);
  await t.down(2, L1.fire.x, L1.fire.y);
  await stepGame(page, 16, 2);
  await t.up(2);
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].player).toBe('p1');
  expect(shots[0].vy).toBeGreaterThan(0); // P1 shoots down the screen
  expect(Math.abs(shotDeg(shots[0], 1) - 130)).toBeLessThan(2);
});

test('v2: drag aim clamps; ?lefty mirrors a seat', async ({ page }) => {
  await gotoGame(page, '?lefty=p2');
  expect(await page.evaluate(`${SCENE}.__debug.lefty()`)).toBe('p2');
  const L = await v2Layout(page, 2);
  expect(L.fire.x).toBeGreaterThan(L.anchor.x); // lefty: buttons on the player's right
  expect(L.pad.x).toBeLessThan(L.anchor.x);
  const t = await touchscreen(page);
  // Thumb down anywhere in the (mirrored) aim zone: no jump, then drag right.
  await t.down(1, 60, 600);
  expect(await aimDeg(page, 2)).toBe(90);
  await t.move(1, 85, 600); // +25 units to the player's right
  expect(await aimDeg(page, 2)).toBeCloseTo(90 - 25 * CONTROLS_V2.drag.gainDegPerPx, 3);
  await t.move(1, 300, 600); // way past: clamps
  expect(await aimDeg(page, 2)).toBe(15);
  await t.up(1);
});
