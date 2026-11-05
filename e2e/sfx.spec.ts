/**
 * sfx.spec.ts — the game's sound (#3). Real audio can't be heard headless, so
 * each case reads sfx.ts's log of requested sound names (window.__sfx.log),
 * clears it, drives one real game path, and asserts the specific names, so a
 * site that loses its sfx.play call fails here. Also: the join screen's
 * speaker toggle (remembered, sound only), the boss-hit buzz, and no
 * AudioContext before the first tap. Shared harness and the console gate:
 * ./helpers.ts.
 */
import {
  test,
  expect,
  SCENE,
  JOIN_SCENE,
  debug,
  fire,
  gotoGame,
  fieldRock,
  stepGame,
  stepUntil,
  enterBoss,
  clearField,
  hitEscort,
  loseRun,
  clearGiantField,
  touchscreen,
  v2Layout,
  sceneActive,
  type Page,
  type Pt,
  type Touchscreen,
} from './helpers';
import { FLEET, GIANT_LAYOUT, HAPTICS, PODS, SFX, SPECIAL_SWIPE, sublaneCenterY } from '../src/layout';
import { BOSS } from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

const sfxLog = (page: Page) => page.evaluate(() => [...(window as any).__sfx.log]) as Promise<string[]>;
const clearSfxLog = (page: Page) => page.evaluate(() => void ((window as any).__sfx.log.length = 0));
/** The log since it was last cleared, then clear it again. */
async function takeLog(page: Page): Promise<string[]> {
  const log = await sfxLog(page);
  await clearSfxLog(page);
  return log;
}

/** Record navigator.vibrate calls (window.__vibes) and count AudioContexts made
 *  (window.__contexts) and oscillators started (window.__oscillators), from
 *  before boot. `noAudio` removes Web Audio entirely instead. */
async function instrument(page: Page, noAudio = false): Promise<void> {
  await page.addInitScript((none) => {
    const w = window as any;
    w.__vibes = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: (ms: number) => (w.__vibes.push(ms), true),
    });
    if (none) {
      delete w.AudioContext;
      delete w.webkitAudioContext;
      return;
    }
    w.__contexts = 0;
    w.__oscillators = 0;
    const Real = w.AudioContext;
    w.AudioContext = class extends Real {
      constructor(...args: unknown[]) {
        super(...args);
        w.__contexts += 1;
      }
    };
    const create = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function (this: BaseAudioContext) {
      w.__oscillators += 1;
      return create.call(this);
    };
  }, noAudio);
}
const vibes = (page: Page) => page.evaluate(() => (window as any).__vibes) as Promise<number[]>;
const contexts = (page: Page) => page.evaluate(() => (window as any).__contexts) as Promise<number>;
const oscillators = (page: Page) => page.evaluate(() => (window as any).__oscillators) as Promise<number>;

/** A tap on a button: down, a few frames, up. */
async function press(page: Page, t: Touchscreen, at: Pt, frames = 3): Promise<void> {
  await t.down(1, at.x, at.y);
  await stepGame(page, 16, frames);
  await t.up(1);
}

test('every shot sounds by kind: thwip, charged, missile (one for the triple), bomb launch, and the blast', async ({ page }) => {
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await debug(page, 'setUnlimitedAmmo(2, true)');
  await clearSfxLog(page);

  await press(page, t, L.fire); // a tap: a plain round
  expect(await takeLog(page)).toEqual(['thwip']);
  await press(page, t, L.fire, 45); // held past CHARGE.fullMs: a charged round
  expect(await takeLog(page)).toEqual(['charged']);
  await press(page, t, L.special, 1); // the missile
  expect(await takeLog(page)).toEqual(['missile']);
  await debug(page, "setSpecial(2, 'triple')");
  await press(page, t, L.special, 1); // three missiles, one fwoosh
  expect(await takeLog(page)).toEqual(['missile']);
  await debug(page, "setSpecial(2, 'detonator')");
  await press(page, t, L.special, 1); // the bomb leaves...
  expect(await takeLog(page)).toEqual(['bombLaunch']);
  await press(page, t, L.special, 1); // ...and the next press blows it
  expect(await takeLog(page)).toEqual(['detonate']);
});

test('rocks: a kill booms, a two-hit rock\'s first hit tonks, and a rock reaching the fleet is only the shield pop', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  const y = sublaneCenterY(1);
  const shootRock = async () => {
    await fire(page, 60, y, 350, 0);
    expect((await stepUntil(page, 's.rockets.group.countActive(true) === 0', 40)).done).toBe(true);
  };
  await clearSfxLog(page);

  await fieldRock(page, { x: 200, y, kind: 'tough' });
  await shootRock();
  expect(await takeLog(page)).toEqual(['toughDent']);
  await shootRock();
  expect(await takeLog(page)).toEqual(['rockBreak']);

  await fieldRock(page, { x: FLEET.bubbleFrontX + 30, y: sublaneCenterY(2), speed: 300 });
  expect((await stepUntil(page, "s.__debug.fleet()[2] === 'exposed'", 20)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['shieldPop']);
});

test('the fleet: a ship lost bwomps, a shield coming back chimes, a wave clear plays its fanfare, a lost run plays Try again', async ({ page }) => {
  await gotoGame(page);
  await clearSfxLog(page);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(2)`);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(2)`);
  expect(await takeLog(page)).toEqual(['shieldPop', 'shipLost']);

  // Ship 1's shield regrows after a quiet stretch.
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(1)`);
  await clearSfxLog(page);
  expect((await stepUntil(page, "s.__debug.fleet()[1] === 'shielded'", 1000)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['shieldRebuild']);

  // The wave clears: its fanfare, then ship 2 rebuilt (its chime).
  await clearField(page);
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, "s.__debug.fleet()[2] === 'shielded' && !s.fleet.restoring", 200)).done).toBe(true);
  const clear = await takeLog(page);
  expect(clear[0]).toBe('waveClear');
  expect(clear).toContain('shieldRebuild');

  await loseRun(page);
  const lost = await takeLog(page);
  expect(lost.filter((s) => s === 'tryAgain')).toHaveLength(1);
  expect(lost[lost.length - 1]).toBe('tryAgain');
});

test('winning the run plays its fanfare', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(10)');
  await clearSfxLog(page);
  await debug(page, 'clearWave()');
  expect((await stepUntil(page, 's.victoryOverlay.visible', 200)).done).toBe(true);
  const log = await sfxLog(page);
  expect(log).toContain('waveClear');
  expect(log[log.length - 1]).toBe('runWon');
});

test('pods sparkle in, jingle when taken, fade on the timeout; then the flyby\'s engine; and a SPECIAL swipe clicks', async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(3)');
  await clearSfxLog(page);
  await clearGiantField(page); // the giant pops (its burst) and the wave clears into the drop
  await stepGame(page, 16, 2);
  expect(await takeLog(page)).toEqual(['giantBurst', 'waveClear', 'podsAppear']);
  await debug(page, 'pickPod(2, 1)');
  expect(await takeLog(page)).toEqual(['podPickup']);
  expect((await stepUntil(page, "s.__debug.pods().phase === 'fading'", Math.ceil(PODS.timeoutMs / 16) + 10)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['podTimeout']);
  expect((await stepUntil(page, "s.__debug.transition().phase === 'out'", 200)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['flyby']);

  // P2 now has two modes: an upward swipe on SPECIAL rotates them.
  await debug(page, 'skipTransition()');
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await clearSfxLog(page);
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 1);
  await t.move(1, L.special.x, L.special.y - SPECIAL_SWIPE.minUpPx - 12);
  await stepGame(page, 16, 1);
  await t.up(1);
  expect(await takeLog(page)).toEqual(['modeSwipe']);
});

test('the command ship: rumble in, clunks on escorts, tinks off the web and its hull, a counted hit clangs and buzzes', async ({ page }) => {
  await instrument(page);
  await gotoGame(page);
  await clearSfxLog(page);
  await enterBoss(page);
  expect(await takeLog(page)).toEqual(['bossEnter']);

  // A plain round at the middle of a web link, from just outside it: blocked.
  await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const { ax, ay, bx, by } = s.__debug.webLinks().links[0];
    const b = s.bossEncounter.boss.sprite;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const len = Math.hypot(mx - b.x, my - b.y);
    const ux = (mx - b.x) / len, uy = (my - b.y) / len;
    s.rockets.fire('rocket-p1', mx + ux * 30, my + uy * 30, -ux * 250, -uy * 250, 'p1', {});
  });
  expect((await stepUntil(page, 's.rockets.group.countActive(true) === 0', 40)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['refused']);

  await hitEscort(page, 2, 'p2'); // a lock
  await hitEscort(page, 2, 'p2'); // the same seat again: refused
  await hitEscort(page, 2, 'p1'); // the second lock downs it
  expect(await takeLog(page)).toEqual(['escortClunk', 'refused', 'escortClunk']);
  await stepGame(page, 16, 1);

  // Through the gap along y=370: a plain round only tinks off the hull; a charged one counts.
  const shoot = async (opts: string) => {
    await page.evaluate(`${SCENE}.rockets.fire('rocket-p1', 60, 370, 350, 0, 'p1', ${opts})`);
    expect((await stepUntil(page, 's.rockets.group.countActive(true) === 0', 40)).done).toBe(true);
  };
  await page.evaluate(() => void ((window as any).__vibes.length = 0));
  await shoot('{}');
  expect(await takeLog(page)).toEqual(['refused']);
  await shoot('{ charged: true }');
  expect(await takeLog(page)).toEqual(['bossHit']);
  expect(await vibes(page)).toEqual([HAPTICS.bossHitMs]);

  await debug(page, 'defeatBoss()');
  expect((await takeLog(page))[0]).toBe('bossDefeated');
});

test('the beam whines over the last of its charge and zaps when it fires; a reset cuts the whine', async ({ page }) => {
  await gotoGame(page);
  await enterBoss(page);
  const whineAt = BOSS.chargeMs - SFX.beamWhineMs;
  const setCharge = (ms: number) => page.evaluate(`${SCENE}.bossEncounter.timer = ${ms}`);
  await setCharge(whineAt - 40);
  await clearSfxLog(page);
  await stepGame(page, 16, 2); // 32ms: not yet
  expect(await sfxLog(page)).toEqual([]);
  await stepGame(page, 16, 1);
  expect(await takeLog(page)).toEqual(['beamCharge']);
  expect((await stepUntil(page, 's.__debug.bossCharge() < 0.5', Math.ceil(SFX.beamWhineMs / 16) + 5)).done).toBe(true);
  expect(await takeLog(page)).toEqual(['beamZap', 'shieldPop']);

  // Whining, then an escort goes down: the charge resets and the whine stops.
  await setCharge(whineAt + 100);
  await stepGame(page, 16, 1);
  await debug(page, 'killEscort(0)');
  expect(await takeLog(page)).toEqual(['escortClunk', 'escortClunk', '-beamCharge']);
});

test('the giant: a refused round tinks, a counted hit thumps and buzzes, the popping hit buzzes and bursts', async ({ page }) => {
  await instrument(page);
  await gotoGame(page, '?wave=3', { p1: 'normal' }); // solo: every charged round counts
  await page.evaluate(`${SCENE}.__debug.setGiantX(220)`);
  await stepGame(page, 16, 1);
  const shoot = async (opts: string) => {
    await page.evaluate(`${SCENE}.rockets.fire('rocket-p1', 60, ${GIANT_LAYOUT.y}, 350, 0, 'p1', ${opts})`);
    expect((await stepUntil(page, 's.rockets.group.countActive(true) === 0', 60)).done).toBe(true);
  };
  await clearSfxLog(page);
  await shoot('{}');
  expect(await takeLog(page)).toEqual(['refused']);
  await shoot('{ charged: true }');
  expect(await takeLog(page)).toEqual(['giantThump']);
  expect(await vibes(page)).toEqual([HAPTICS.bossHitMs]);
  await page.evaluate(`${SCENE}.giant.hpLeft = 1`);
  await shoot('{ charged: true }');
  expect((await takeLog(page))[0]).toBe('giantBurst');
  expect(await vibes(page)).toEqual([HAPTICS.bossHitMs, HAPTICS.bossHitMs]);
});

test('the join screen: a join blips, the countdown beeps 3-2-1 and goes', async ({ page }) => {
  await gotoGame(page, '', 'join');
  const t = await touchscreen(page);
  const p2 = (await page.evaluate(`${JOIN_SCENE}.__debug.panel('p2')`)) as { ring: Pt; normal: Pt };
  await clearSfxLog(page);
  await press(page, t, p2.ring, 1);
  expect(await takeLog(page)).toEqual(['joinBlip']);
  await press(page, t, p2.normal, 1);
  await stepGame(page, 100, 31);
  expect(await sceneActive(page, 'Sandbox')).toBe(true);
  expect(await sfxLog(page)).toEqual(['countBeep', 'countBeep', 'countBeep', 'countGo']);
});

test('the speaker on the join screen\'s centre line mutes sound (only), and is remembered', async ({ page }) => {
  await instrument(page);
  await gotoGame(page, '', 'join');
  const t = await touchscreen(page);
  const speaker = () => page.evaluate(`${JOIN_SCENE}.__debug.speaker()`) as Promise<Pt & { r: number; muted: boolean }>;
  const at = await speaker();
  expect(at.muted).toBe(false);
  await press(page, t, at, 1);
  expect((await speaker()).muted).toBe(true);
  // The tap was the speaker's alone: neither seat joined.
  expect(await page.evaluate(`${JOIN_SCENE}.__debug.picks()`)).toEqual({});

  // Remembered across a reload.
  await gotoGame(page, '', 'join');
  expect((await speaker()).muted).toBe(true);
  // Taps just off it, either side of the centre line, still join their seats.
  await press(page, t, { x: at.x, y: at.y + at.r + 20 }, 1);
  await press(page, t, { x: at.x, y: at.y - at.r - 20 }, 1);
  expect(await page.evaluate(`${JOIN_SCENE}.__debug.picks()`)).toEqual({ p1: null, p2: null });

  // Muted, in play: a shot is still requested and still buzzes, but makes no sound.
  await page.evaluate(`${JOIN_SCENE}.__debug.startRun({ p1: 'normal', p2: 'normal' })`);
  await stepGame(page, 16, 1);
  const L = await v2Layout(page, 2);
  const before = await oscillators(page);
  await page.evaluate(() => void ((window as any).__vibes.length = 0));
  await clearSfxLog(page);
  await press(page, t, L.fire);
  expect(await sfxLog(page)).toEqual(['thwip']);
  expect(await vibes(page)).toEqual([HAPTICS.shotMs]);
  expect(await oscillators(page)).toBe(before);

  // Back on: the next shot is synthesized.
  await page.evaluate(() => void ((window as any).__sfx.muted = false));
  await press(page, t, L.fire);
  expect(await oscillators(page)).toBeGreaterThan(before);
});

test('no AudioContext before the first tap; the first tap makes exactly one, and sounds then play', async ({ page }) => {
  await instrument(page);
  await gotoGame(page);
  await stepGame(page, 16, 100);
  await clearField(page);
  await fieldRock(page, { x: 200, y: sublaneCenterY(1) });
  await fire(page, 60, sublaneCenterY(1), 350, 0); // a kill with no tap yet: requested, not played
  await stepUntil(page, 's.rockets.group.countActive(true) === 0', 40);
  expect(await sfxLog(page)).toContain('rockBreak');
  expect(await contexts(page)).toBe(0); // and Phaser made none (audio: noAudio)
  expect(await oscillators(page)).toBe(0);

  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await press(page, t, L.fire);
  expect(await contexts(page)).toBe(1);
  expect(await oscillators(page)).toBeGreaterThan(0);
  await press(page, t, L.fire);
  expect(await contexts(page)).toBe(1);
});

test('without Web Audio the game plays on, silent and error-free', async ({ page }) => {
  await instrument(page, true);
  await gotoGame(page);
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);
  await clearSfxLog(page);
  await press(page, t, L.fire);
  await stepGame(page, 16, 20);
  expect(await sfxLog(page)).toContain('thwip');
  expect(await vibes(page)).toEqual([HAPTICS.shotMs]);
});
