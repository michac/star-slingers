/**
 * join.spec.ts — the join screen (#20): a panel per seat, join → pick Easy or
 * Normal → countdown → the run with only the joined seats; leaving; Easy's
 * unlimited ammo; Try again keeps the lineup, a win goes back to the join screen.
 * Driven by real touches. Shared harness and the console gate: ./helpers.ts.
 */
import { AMMO, SPECIAL } from '../src/layout';
import {
  test, expect, SCENE, JOIN_SCENE, gotoGame, stepGame, touchscreen, v2Layout, liveShots, mirrored, seats, sceneActive as active,
  type Page, type Pt, type Touchscreen,
} from './helpers';

type Circle = Pt & { r: number };
type PanelInfo = { angle: number; ring: Circle; easy: Circle; normal: Circle; easyVisible: boolean; countdown: string | null };

const panel = (page: Page, player: 'p1' | 'p2') => page.evaluate(`${JOIN_SCENE}.__debug.panel('${player}')`) as Promise<PanelInfo>;
const picks = (page: Page) => page.evaluate(`${JOIN_SCENE}.__debug.picks()`) as Promise<Record<string, string | null>>;
const difficulty = (page: Page, player: 1 | 2) => page.evaluate(`${SCENE}.__debug.difficulty(${player})`) as Promise<string | null>;
/** Each live seat's banner copy / fail-card text, as its rotation (absolute:
 *  Phaser normalises 180° to -180°). */
const bannerAngles = (page: Page) =>
  page.evaluate(`${SCENE}.waveDirector.banner.container.list.map((g) => Math.abs(g.angle))`) as Promise<number[]>;
const failTextAngles = (page: Page) =>
  page.evaluate(`${SCENE}.failOverlay.container.list.filter((o) => o.type === 'Text').map((t) => Math.abs(t.angle))`) as Promise<number[]>;
/** The AMMO readout text of HUD `i` (index-aligned with the live seats). */
/** A seat's HUD readout for one ammo pool ('5', '0', '∞'…), by HUD index. */
const ammoText = (page: Page, i: number, pool: 'fire' | 'special' = 'fire') =>
  page.evaluate(`${SCENE}.huds[${i}].values.${pool}.text`) as Promise<string>;
const specialAmmo = (page: Page, player: 1 | 2) => page.evaluate(`${SCENE}.__debug.specialAmmo(${player})`) as Promise<number>;

/** One quick tap at a game point (finger 1), with a frame for the scene to read it. */
async function tap(page: Page, t: Touchscreen, at: Pt): Promise<void> {
  await t.down(1, at.x, at.y);
  await stepGame(page, 16, 1);
  await t.up(1);
  await stepGame(page, 16, 1);
}

test('each seat gets its own join panel, the top one facing the top seat', async ({ page }) => {
  await gotoGame(page, '', 'join');
  expect(await active(page, 'Join')).toBe(true);
  expect(await active(page, 'Sandbox')).toBe(false);
  const p1 = await panel(page, 'p1');
  const p2 = await panel(page, 'p2');
  expect(p2.angle).toBe(0);
  expect(Math.abs(p1.angle)).toBe(180); // Phaser normalises 180° to -180°
  // P1's panel is P2's rotated 180° about the field centre, so each sits in its own half.
  for (const part of ['ring', 'easy', 'normal'] as const) {
    expect(p1[part].x).toBeCloseTo(mirrored(p2[part]).x, 5);
    expect(p1[part].y).toBeCloseTo(mirrored(p2[part]).y, 5);
    expect(p1[part].y).toBeLessThan(370);
    expect(p2[part].y).toBeGreaterThan(370);
  }
  // Pick buttons only show once a seat joins; a touch in the top half joins only P1.
  expect(p1.easyVisible).toBe(false);
  const t = await touchscreen(page);
  await tap(page, t, p1.ring);
  expect(await picks(page)).toEqual({ p1: null });
  expect((await panel(page, 'p1')).easyVisible).toBe(true);
  expect((await panel(page, 'p2')).easyVisible).toBe(false);
});

test('the bottom seat alone: join, pick Normal, countdown, solo run at the bottom', async ({ page }) => {
  await gotoGame(page, '', 'join');
  const p2 = await panel(page, 'p2');
  const t = await touchscreen(page);
  await tap(page, t, p2.ring);
  // Joined but unpicked: no countdown yet, however long it waits.
  await stepGame(page, 100, 50);
  expect((await panel(page, 'p2')).countdown).toBeNull();
  await tap(page, t, p2.normal);
  expect((await panel(page, 'p2')).countdown).toBe('3');
  expect((await panel(page, 'p1')).countdown).toBeNull(); // nothing drawn at the empty seat
  // The run waits for the countdown...
  await stepGame(page, 100, 28);
  expect((await panel(page, 'p2')).countdown).toBe('1');
  expect(await active(page, 'Sandbox')).toBe(false);
  // ...then starts with only the joined seat.
  await stepGame(page, 100, 3);
  expect(await active(page, 'Sandbox')).toBe(true);
  expect(await active(page, 'Join')).toBe(false);
  expect(await seats(page)).toEqual(['p2']);
  expect(await difficulty(page, 2)).toBe('normal');
  expect(await difficulty(page, 1)).toBeNull();
  expect(await bannerAngles(page)).toEqual([0]);
});

test('a stray join on the empty seat can leave again, then the lone top seat plays solo at the top', async ({ page }) => {
  await gotoGame(page, '', 'join');
  const p1 = await panel(page, 'p1');
  const p2 = await panel(page, 'p2');
  const t = await touchscreen(page);
  await tap(page, t, p1.ring);
  await tap(page, t, p1.easy);
  expect((await panel(page, 'p1')).countdown).toBe('3');
  // A stray touch in the bottom half joins P2, which holds the countdown...
  await tap(page, t, { x: 60, y: 450 });
  expect(await picks(page)).toEqual({ p1: 'easy', p2: null });
  expect((await panel(page, 'p1')).countdown).toBeNull();
  // A second tap on the ring right after joining (a double-tap, or two fingers
  // landing together) doesn't undo the join...
  await tap(page, t, p2.ring);
  expect(await picks(page)).toEqual({ p1: 'easy', p2: null });
  // ...but once the grace has passed, tapping the ring leaves; the countdown comes back.
  await stepGame(page, 100, 6);
  await tap(page, t, p2.ring);
  expect(await picks(page)).toEqual({ p1: 'easy' });
  await stepGame(page, 16, 1);
  expect((await panel(page, 'p1')).countdown).toBe('3');
  await stepGame(page, 100, 31);
  expect(await seats(page)).toEqual(['p1']);
  expect(await difficulty(page, 1)).toBe('easy');
  // The banner and end-card copies face the live top seat only.
  expect(await bannerAngles(page)).toEqual([180]);
  expect(await failTextAngles(page)).toEqual([180]);
  // Its controls are live: P1's FIRE fires a P1 shot.
  const L = await v2Layout(page, 1);
  await tap(page, t, L.fire);
  expect((await liveShots(page)).map((s) => s.player)).toEqual(['p1']);
});

test('both seats join for co-op, and a late join holds the countdown until it picks', async ({ page }) => {
  await gotoGame(page, '', 'join');
  const p1 = await panel(page, 'p1');
  const p2 = await panel(page, 'p2');
  const t = await touchscreen(page);
  await tap(page, t, p2.ring);
  await tap(page, t, p2.normal);
  await stepGame(page, 100, 12);
  expect((await panel(page, 'p2')).countdown).toBe('2');
  // P1 joins mid-countdown: it stops, and the run never starts while P1 picks.
  await tap(page, t, p1.ring);
  expect((await panel(page, 'p2')).countdown).toBeNull();
  await stepGame(page, 100, 40);
  expect(await active(page, 'Join')).toBe(true);
  // P1 picks Easy: a fresh countdown on both panels, then the co-op run.
  await tap(page, t, p1.easy);
  expect((await panel(page, 'p1')).countdown).toBe('3');
  expect((await panel(page, 'p2')).countdown).toBe('3');
  await stepGame(page, 100, 31);
  expect(await seats(page)).toEqual(['p1', 'p2']);
  expect(await difficulty(page, 1)).toBe('easy');
  expect(await difficulty(page, 2)).toBe('normal');
  expect(await bannerAngles(page)).toEqual([180, 0]);
});

test('a seat leaving mid-countdown restarts it, so the leaver has time to come back', async ({ page }) => {
  await gotoGame(page, '', 'join');
  const p1 = await panel(page, 'p1');
  const p2 = await panel(page, 'p2');
  const t = await touchscreen(page);
  await tap(page, t, p1.ring);
  await tap(page, t, p1.normal);
  await tap(page, t, p2.ring);
  await tap(page, t, p2.normal);
  await stepGame(page, 100, 22);
  expect((await panel(page, 'p2')).countdown).toBe('1');
  // P1 leaves at "1": P2's countdown starts over instead of running out.
  await tap(page, t, p1.ring);
  expect(await picks(page)).toEqual({ p2: 'normal' });
  await stepGame(page, 16, 1);
  expect((await panel(page, 'p2')).countdown).toBe('3');
  // P1 changes their mind and rejoins in time: the run waits for their pick.
  await tap(page, t, p1.ring);
  await tap(page, t, p1.easy);
  await stepGame(page, 100, 31);
  expect(await seats(page)).toEqual(['p1', 'p2']);
});

test('an Easy seat fires past both Normal ammo caps; its readouts show ∞', async ({ page }) => {
  await gotoGame(page, '', { p1: 'normal', p2: 'easy' });
  expect(await ammoText(page, 0)).toBe(String(AMMO.max));
  expect(await ammoText(page, 1)).toBe('∞');
  expect(await ammoText(page, 0, 'special')).toBe(String(SPECIAL.max));
  expect(await ammoText(page, 1, 'special')).toBe('∞');
  const L1 = await v2Layout(page, 1);
  const L2 = await v2Layout(page, 2);
  const t = await touchscreen(page);
  // Eight FIRE taps per seat, well inside one ammo regen tick (1s).
  for (let i = 0; i < 8; i++) {
    await tap(page, t, L1.fire);
    await tap(page, t, L2.fire);
  }
  const shots = await liveShots(page);
  expect(shots.filter((s) => s.player === 'p1')).toHaveLength(5); // Normal: the cap
  expect(shots.filter((s) => s.player === 'p2')).toHaveLength(8); // Easy: never runs dry
  expect(await ammoText(page, 0)).toBe('0');
  expect(await ammoText(page, 1)).toBe('∞');
  // The SPECIAL pool too: two more taps than a Normal seat holds, inside one
  // special regen tick (3s).
  for (let i = 0; i < SPECIAL.max + 2; i++) {
    await tap(page, t, L1.special);
    await tap(page, t, L2.special);
  }
  const missiles = (await liveShots(page)).filter((s) => s.missile);
  expect(missiles.filter((s) => s.player === 'p1')).toHaveLength(SPECIAL.max); // Normal: the cap
  expect(missiles.filter((s) => s.player === 'p2')).toHaveLength(SPECIAL.max + 2); // Easy: never runs dry
  expect(await specialAmmo(page, 1)).toBe(0);
  expect(await specialAmmo(page, 2)).toBe(SPECIAL.max);
  expect(await ammoText(page, 1, 'special')).toBe('∞');
});

/** Show an end card and tap it. A zone made interactive joins the input list
 *  on the next frame, so one frame runs before the tap (as it would on a phone). */
async function tapCard(page: Page, t: Touchscreen, which: 'failOverlay' | 'victoryOverlay'): Promise<void> {
  await page.evaluate(`${SCENE}.${which}.show()`);
  await stepGame(page, 16, 1);
  await tap(page, t, { x: 180, y: 370 });
  await stepGame(page, 16, 1); // the scene manager processes the restart / switch
}

const wave = (page: Page) => page.evaluate(`${SCENE}.__debug.wave()`) as Promise<number>;

/** The bottom seat alone joins on Normal with real taps, then the countdown
 *  runs out and its solo run starts. */
async function startBottomSolo(page: Page, t: Touchscreen): Promise<void> {
  const p2 = await panel(page, 'p2');
  await tap(page, t, p2.ring);
  await tap(page, t, p2.normal);
  await stepGame(page, 100, 31);
  expect(await seats(page)).toEqual(['p2']);
}

test('Try again keeps the seats and picks; a win goes back to an empty join screen', async ({ page }) => {
  await gotoGame(page, '', { p1: 'easy' });
  const t = await touchscreen(page);
  await page.evaluate(`${SCENE}.__debug.jumpToWave(5)`);
  await tap(page, t, (await v2Layout(page, 1)).fire);
  expect(await liveShots(page)).toHaveLength(1);
  await tapCard(page, t, 'failOverlay');
  expect(await liveShots(page)).toHaveLength(0); // a fresh scene: the shot is gone
  expect(await active(page, 'Sandbox')).toBe(true);
  expect(await wave(page)).toBe(4); // #24: the lost act's first wave
  expect(await seats(page)).toEqual(['p1']);
  expect(await difficulty(page, 1)).toBe('easy');
  expect(await ammoText(page, 0)).toBe('∞');

  await tapCard(page, t, 'victoryOverlay');
  expect(await active(page, 'Join')).toBe(true);
  expect(await active(page, 'Sandbox')).toBe(false);
  expect(await picks(page)).toEqual({});
  // The next run starts fresh at wave 1, not at the last retry's wave.
  await startBottomSolo(page, t);
  expect(await wave(page)).toBe(1);
});

test('?wave=N and ?boss still work behind the join screen, and Try again keeps the shortcut wave', async ({ page }) => {
  await gotoGame(page, '?wave=8', 'join');
  const t = await touchscreen(page);
  await startBottomSolo(page, t);
  expect(await wave(page)).toBe(8);
  await tapCard(page, t, 'failOverlay');
  expect(await wave(page)).toBe(8); // never before the shortcut's wave (#24)
  expect(await seats(page)).toEqual(['p2']);

  await gotoGame(page, '?boss', 'join');
  await startBottomSolo(page, await touchscreen(page));
  expect(await page.evaluate(`${SCENE}.__debug.bossPhase()`)).not.toBe('idle');
});
