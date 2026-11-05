/**
 * haptics.spec.ts — navigator.vibrate on the v2 buttons (#3): arming tick, buzz by shot kind, silent no-ops.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, stepGame, stubVibrate, touchscreen, v2Layout, vibes, liveShots, countShots, fired } from './helpers';
import { HAPTICS } from '../src/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */

test('v2: haptics — FIRE ticks once on arming, each shot fired buzzes by kind', async ({ page }) => {
  await stubVibrate(page);
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  // Count launches, not live rockets: a missile with no target takes a wave
  // rock it finds on its heading and is spent.
  await countShots(page);

  await t.down(1, L.fire.x, L.fire.y);
  await stepGame(page, 16, 30); // 480ms: still charging
  expect(await vibes(page)).toEqual([]);
  await stepGame(page, 16, 15); // past CHARGE.fullMs (600): armed
  expect(await vibes(page)).toEqual([HAPTICS.armedMs]);
  await stepGame(page, 16, 20); // held armed: no repeat ticks
  expect(await vibes(page)).toEqual([HAPTICS.armedMs]);
  await t.up(1);
  expect(await vibes(page)).toEqual([HAPTICS.armedMs, HAPTICS.chargedMs]);

  await t.down(1, L.fire.x, L.fire.y); // a tap: plain shot
  await stepGame(page, 16, 3);
  await t.up(1);
  await t.down(1, L.special.x, L.special.y); // SPECIAL: a missile (no rock to take; still a missile)
  await t.up(1);
  expect(await vibes(page)).toEqual([HAPTICS.armedMs, HAPTICS.chargedMs, HAPTICS.shotMs, HAPTICS.missileMs]);
  expect(await fired(page)).toBe(3);

  // No ammo: a tap fires nothing and doesn't buzz, and a full charge gives no
  // "ready" tick for a release that would fire nothing...
  await page.evaluate(`${SCENE}.controls[1].config.canFire = () => window.__ammo`);
  await page.evaluate(() => ((window as any).__ammo = false));
  await t.down(1, L.fire.x, L.fire.y);
  await stepGame(page, 16, 3);
  await t.up(1);
  await t.down(1, L.fire.x, L.fire.y);
  await stepGame(page, 16, 45);
  expect(await vibes(page)).toHaveLength(4);
  // ...until ammo regens mid-hold: then it ticks, once.
  await page.evaluate(() => ((window as any).__ammo = true));
  await stepGame(page, 16, 10);
  expect(await vibes(page)).toEqual([HAPTICS.armedMs, HAPTICS.chargedMs, HAPTICS.shotMs, HAPTICS.missileMs, HAPTICS.armedMs]);
  await t.up(1);
  expect(await fired(page)).toBe(4);
});

// 'missing': no vibrate API (iPhone). 'unactivated': before the first tap
// (Chrome blocks + logs it). Either way the shot still fires and the console
// gate (./helpers.ts) proves nothing threw or logged; 'unactivated' also records that
// nothing buzzed ('missing' has no recorder to check).
for (const mode of ['missing', 'unactivated'] as const) {
  test(`v2: haptics — ${mode} vibrate is a silent no-op`, async ({ page }) => {
    await stubVibrate(page, mode);
    await gotoGame(page);
    const L = await v2Layout(page, 2);
    const t = await touchscreen(page);
    await t.down(1, L.fire.x, L.fire.y);
    await stepGame(page, 16, 45); // through the armed tick
    await t.up(1);
    expect(await liveShots(page)).toHaveLength(1);
    if (mode === 'unactivated') expect(await vibes(page)).toEqual([]);
  });
}
