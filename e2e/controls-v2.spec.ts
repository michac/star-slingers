/**
 * controls-v2.spec.ts — two-thumb FIRE/SPECIAL buttons + drag aim (#7), the two ammo pools (#22), driven by real CDP touches.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, stepUntil, fieldRock, touchscreen, v2Layout, liveShots, mirrored, countShots, fired, type LiveShot, type Page } from './helpers';
import { AMMO, AMMO_REGEN_MS, CONTROLS_V2, MISSILE, SLING, SPECIAL } from '../src/layout';

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
  expect(shot.missile).toBe(false);
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
  expect(shots[0].missile).toBe(false);
  expect(Math.abs(shotDeg(shots[0], 2) - 90)).toBeLessThan(1); // boot aim = straight across
  expect(Math.hypot(shots[0].vx, shots[0].vy)).toBeCloseTo(SLING.maxSpeed, 3);
});

test('v2: releasing SPECIAL fires a missile locked on the rock in line', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  // On P2's boot aim line (straight up from the launcher), inside the lanes.
  await fieldRock(page, { x: L.anchor.x, y: 400 });
  const t = await touchscreen(page);
  await t.down(1, L.special.x, L.special.y);
  expect(await page.evaluate(`${SCENE}.controls[1].held`)).toBe('special');
  // A press on FIRE while SPECIAL is held is ignored (one button at a time).
  await t.down(2, L.fire.x, L.fire.y);
  await stepGame(page, 16, 45); // SPECIAL never charges, however long it's held
  await t.up(2);
  expect(await liveShots(page)).toHaveLength(0);
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].missile).toBe(true);
  expect(Math.hypot(shots[0].vx, shots[0].vy)).toBeCloseTo(MISSILE.speed, 3);
  expect(shots[0].charged).toBe(false);
  expect(shots[0].targetIsRock0).toBe(true);
});

test('v2: the top seat is mirrored 180° (aim + fire)', async ({ page }) => {
  await gotoGame(page);
  const L1 = await v2Layout(page, 1);
  const L2 = await v2Layout(page, 2);
  // P1's controls are P2's rotated about the field centre.
  const fireWant = mirrored(L2.fire);
  expect(L1.fire.x).toBeCloseTo(fireWant.x, 5);
  expect(L1.fire.y).toBeCloseTo(fireWant.y, 5);
  expect(L1.pad.x).toBeCloseTo(mirrored(L2.pad).x, 5);
  const t = await touchscreen(page);
  // P1's aim zone is P2's rotated: seat-frame (300,600) is on screen at
  // mirrored(). A drag toward P1's LEFT (+x on screen, since P1 faces down the
  // field) turns the aim from 90° up to 130°.
  const aim = mirrored({ x: 300, y: 600 });
  await t.down(1, aim.x, aim.y);
  await t.move(1, aim.x + dragFor(40), aim.y);
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

// ---- the two ammo pools (#22) ----

const ammo = (page: Page, player: 1 | 2) => page.evaluate(`${SCENE}.__debug.ammo(${player})`) as Promise<number>;
const specialAmmo = (page: Page, player: 1 | 2) =>
  page.evaluate(`${SCENE}.__debug.specialAmmo(${player})`) as Promise<number>;
/** One tap on a P2 button (pressed for 3 frames, well short of a charge). */
async function tap(page: Page, t: Awaited<ReturnType<typeof touchscreen>>, at: { x: number; y: number }) {
  await t.down(1, at.x, at.y);
  await stepGame(page, 16, 3);
  await t.up(1);
}

test('v2: SPECIAL spends its own smaller pool, which regenerates on its own clock', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await countShots(page);
  // Sit full for a while first: a regen clock that kept ticking while the pool
  // was full would refill the first shot early (the fix: restart on spend).
  await stepGame(page, 16, 70);
  expect(await specialAmmo(page, 2)).toBe(SPECIAL.max);
  for (let i = 0; i < SPECIAL.max + 1; i++) await tap(page, t, L.special); // spend: on each tap's 3rd frame
  expect(await fired(page)).toBe(SPECIAL.max); // the extra tap fires nothing
  expect(await specialAmmo(page, 2)).toBe(0);
  expect(await ammo(page, 2)).toBe(AMMO.max); // FIRE's pool is untouched…
  await tap(page, t, L.fire); // …and FIRE still fires
  expect(await fired(page)).toBe(SPECIAL.max + 1);
  expect(await ammo(page, 2)).toBe(AMMO.max - 1);
  // Empty-from-full: nothing comes back before a whole interval from the
  // spend that left full. FIRE's round, spent 0 frames ago, after AMMO_REGEN_MS…
  const fireBack = await stepUntil(page, `s.__debug.ammo(2) === ${AMMO.max}`, 200);
  expect(fireBack.done).toBe(true);
  expect(fireBack.steps * 16).toBeGreaterThanOrEqual(AMMO_REGEN_MS);
  expect(fireBack.steps * 16).toBeLessThan(AMMO_REGEN_MS + 32);
  expect(await specialAmmo(page, 2)).toBe(0);
  // …and the first missile, spent 9 frames (three 3-frame taps) before FIRE's
  // round, after SPECIAL.regenMs.
  const missileBack = await stepUntil(page, 's.__debug.specialAmmo(2) > 0', 200);
  expect(missileBack.done).toBe(true);
  const sinceSpend = (9 + fireBack.steps + missileBack.steps) * 16;
  expect(sinceSpend).toBeGreaterThanOrEqual(SPECIAL.regenMs);
  expect(sinceSpend).toBeLessThan(SPECIAL.regenMs + 32);
  // The next missile takes a full SPECIAL.regenMs more.
  await stepGame(page, 16, Math.floor(SPECIAL.regenMs / 16) - 3);
  expect(await specialAmmo(page, 2)).toBe(1);
  await stepGame(page, 16, 6);
  expect(await specialAmmo(page, 2)).toBe(2);
  expect(await specialAmmo(page, 1)).toBe(SPECIAL.max); // the other seat's pool is its own
});

test('v2: an unlimited seat never runs dry on either pool', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await page.evaluate(`${SCENE}.__debug.setUnlimitedAmmo(2, true)`);
  await countShots(page);
  for (let i = 0; i < AMMO.max + 2; i++) await tap(page, t, L.fire);
  for (let i = 0; i < SPECIAL.max + 2; i++) await tap(page, t, L.special);
  expect(await fired(page)).toBe(AMMO.max + SPECIAL.max + 4);
  expect(await ammo(page, 2)).toBe(AMMO.max);
  expect(await specialAmmo(page, 2)).toBe(SPECIAL.max);
  // The switch is per seat: P1 still spends.
  const L1 = await v2Layout(page, 1);
  await tap(page, t, L1.fire);
  expect(await ammo(page, 1)).toBe(AMMO.max - 1);
});

test('v2: the SPECIAL icon follows the seat\'s current special', async ({ page }) => {
  await gotoGame(page);
  // One special exists today (the missile); this pins the field both the
  // button and the HUD row draw their icon from, which #26's upgrades change.
  for (const player of [1, 2] as const) {
    expect(await page.evaluate(`${SCENE}.__debug.special(${player})`)).toEqual({ control: 'missile', hud: 'missile' });
  }
  const icons = () =>
    page.evaluate(`[${SCENE}.controls[1].specialIconGfx.commandBuffer.length, ${SCENE}.huds[1].specialIcon.commandBuffer.length]`) as Promise<number[]>;
  const drawn = await icons();
  expect(drawn[0]).toBeGreaterThan(0);
  expect(drawn[1]).toBeGreaterThan(0);
  // Setting the special redraws (not appends to) both icons.
  await page.evaluate(`${SCENE}.__debug.setSpecial(2, 'missile')`);
  expect(await icons()).toEqual(drawn);
});

test('v2: an empty SPECIAL pool shows no target ring and dims the nocked rocket while held', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  await fieldRock(page, { x: L.anchor.x, y: 400 }); // on the boot aim line
  const t = await touchscreen(page);
  const held = () =>
    page.evaluate(`[${SCENE}.controls[1].lockGfx.commandBuffer.length, ${SCENE}.controls[1].nockedRocket.alpha]`) as Promise<number[]>;
  // With missiles: the ring is drawn and the rocket is bright.
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 1);
  const [ring, alpha] = await held();
  expect(ring).toBeGreaterThan(0);
  expect(alpha).toBe(1);
  await page.evaluate(`${SCENE}.huds[1].counts.special = 0`); // pool empty (FIRE's still full)
  await stepGame(page, 16, 1);
  expect(await held()).toEqual([0, 0.35]);
  await t.up(1);
  expect(await liveShots(page)).toHaveLength(0);
});
