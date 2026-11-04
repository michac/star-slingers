/**
 * upgrades.spec.ts — boss upgrade pods and special modes (#26): a boss wave's
 * two pods and what may take them, the drop's leave rules (all seats picked,
 * solo, the 12 s timeout) and the flyby waiting for them, rotating a seat's
 * modes by an upward swipe on SPECIAL, the triple missile, the detonator, and
 * Try again keeping each seat's specials. Shared harness and the console gate:
 * ./helpers.ts.
 */
import {
  test,
  expect,
  SCENE,
  debug,
  fire,
  gotoGame,
  fieldRock,
  stepGame,
  stepUntil,
  enterBoss,
  countShots,
  clearField,
  score,
  fired,
  escortLocks,
  loseRun,
  tryAgain,
  winToFreshRun,
  liveShots,
  touchscreen,
  v2Layout,
  type Page,
  type Pt,
  type Touchscreen,
} from './helpers';
import { BOMB, MISSILE, PODS, SCORE, SLING, SPECIAL, SPECIAL_SWIPE } from '../src/layout';
import { BOSS, BOSS_DROPS } from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Modes = { modes: string[]; current: string };
const modes = (page: Page, player: 1 | 2) => debug<Modes>(page, `modes(${player})`);
type PodState = { phase: string; kinds: string[]; picks: Record<string, number>; elapsedMs: number; pods: { x: number; y: number; alpha: number }[] };
const pods = (page: Page) => debug<PodState>(page, 'pods()');

/** Clear wave 3 (the giant-asteroid boss wave) so its real drop starts. */
async function dropPods(page: Page): Promise<void> {
  await debug(page, 'jumpToWave(3)');
  await debug(page, 'clearWave()');
  await stepGame(page, 16, 2); // the wave clears, the bossDrop hook starts the drop
  expect(await pods(page)).toMatchObject({ phase: 'live', kinds: [...BOSS_DROPS.giantAsteroid] });
}

/** Launch a shot for a seat through the public pool (its texture, its seat id). */
const shoot = (page: Page, player: 'p1' | 'p2', from: Pt, vx: number, vy: number, opts = '{}') => fire(page, from.x, from.y, vx, vy, opts, player);

/** A press on SPECIAL that drags by (dx, dy) world units in `steps` moves, then lifts. */
async function dragSpecial(page: Page, t: Touchscreen, at: Pt, dx: number, dy: number, steps = 4): Promise<void> {
  await t.down(1, at.x, at.y);
  await stepGame(page, 16, 1);
  for (let i = 1; i <= steps; i++) {
    await t.move(1, at.x + (dx * i) / steps, at.y + (dy * i) / steps);
    await stepGame(page, 16, 1);
  }
  await t.up(1);
  await stepGame(page, 16, 1);
}

test('a boss wave drops two pods with distinct icons, and the flyby waits for them (AC1, AC3)', async ({ page }) => {
  await gotoGame(page);
  await dropPods(page);
  const drop = await pods(page);
  expect(new Set(drop.kinds).size).toBe(2);
  // Both pods sit on the lane's centre line, the same distance from both launchers.
  for (const [i, pod] of drop.pods.entries()) {
    expect(pod.x).toBe(PODS.xs[i]);
    expect(Math.abs(pod.y - PODS.y)).toBeLessThanOrEqual(PODS.bobPx);
  }
  // Each pod draws its own upgrade's icon (no text anywhere).
  expect(await page.evaluate(`${SCENE}.upgradeDrop.icons.every((g) => g.commandBuffer.length > 0)`)).toBe(true);
  expect(await page.evaluate(`${SCENE}.children.list.some((o) => o.type === 'Text' && o.visible && o.y > 200 && o.y < 540)`)).toBe(false);

  // The run holds while the pods are up: no flyby, no banner.
  await stepGame(page, 16, 300);
  expect(await debug(page, 'interludes()')).toEqual(['drop:3']);
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', flights: [] });
  expect(await debug(page, 'state()')).toBe('between');

  // Both seats pick: the pods leave, and only then does the real flyby start.
  expect(await debug(page, 'pickPod(1, 0)')).toBe(true);
  expect(await debug(page, 'pickPod(2, 0)')).toBe(true);
  expect(await pods(page)).toMatchObject({ phase: 'fading' });
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'idle', flights: [] });
  const gone = await stepUntil(page, "s.__debug.pods().phase === 'idle'", 60);
  expect(gone.done).toBe(true);
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'leadIn', flights: ['1-2'] });
  expect(await debug(page, 'interludes()')).toEqual(['drop:3', 'act:1-2']);
});

test('a FIRE round takes a pod for its seat only, and a seat takes one pod per drop (AC2, AC3)', async ({ page }) => {
  await gotoGame(page);
  await dropPods(page);
  // P2 (bottom) fires a plain round straight up into pod 0.
  await shoot(page, 'p2', { x: PODS.xs[0], y: 600 }, 0, -SLING.maxSpeed);
  expect((await stepUntil(page, 's.__debug.pods().picks.p2 !== undefined', 60)).done).toBe(true);
  expect(await pods(page)).toMatchObject({ phase: 'live', picks: { p2: 0 } });
  expect(await liveShots(page)).toEqual([]); // the pick spent the round
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'triple'], current: 'triple' });
  expect(await debug(page, 'special(2)')).toEqual({ control: 'triple', hud: 'triple' });
  expect(await modes(page, 1)).toEqual({ modes: ['missile'], current: 'missile' }); // P1 untouched

  // P2 has picked: its next round flies straight through the other pod.
  await shoot(page, 'p2', { x: PODS.xs[1], y: 600 }, 0, -SLING.maxSpeed);
  expect((await stepUntil(page, `s.rockets.group.getChildren().some((r) => r.active && r.y < ${PODS.y - PODS.r - 20})`, 60)).done).toBe(true);
  expect(await pods(page)).toMatchObject({ phase: 'live', picks: { p2: 0 } });
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'triple'], current: 'triple' });

  // P1 (top) takes the SAME pod with a charged round fired down at it: both
  // seats have it, and with every seat picked the pods leave.
  await shoot(page, 'p1', { x: PODS.xs[0], y: 140 }, 0, SLING.maxSpeed, '{ charged: true }');
  expect((await stepUntil(page, 's.__debug.pods().picks.p1 !== undefined', 60)).done).toBe(true);
  expect(await modes(page, 1)).toEqual({ modes: ['missile', 'triple'], current: 'triple' });
  expect(await debug(page, 'special(1)')).toEqual({ control: 'triple', hud: 'triple' });
  expect((await pods(page)).phase).toBe('fading');
});

test('missiles and bombs fly through pods without taking one (D3)', async ({ page }) => {
  await gotoGame(page);
  await dropPods(page);
  await shoot(page, 'p2', { x: PODS.xs[0], y: 600 }, 0, -MISSILE.speed, '{ missile: true }');
  await shoot(page, 'p1', { x: PODS.xs[1], y: 140 }, 0, BOMB.speed, '{ bomb: true }');
  await stepGame(page, 16, 60);
  expect(await pods(page)).toMatchObject({ phase: 'live', picks: {} });
  expect(await modes(page, 1)).toEqual({ modes: ['missile'], current: 'missile' });
  expect(await modes(page, 2)).toEqual({ modes: ['missile'], current: 'missile' });
});

test('unpicked pods blink, then leave after the timeout, and the run goes on (AC3)', async ({ page }) => {
  await gotoGame(page);
  await dropPods(page);
  await debug(page, 'pickPod(2, 1)'); // one seat picks; the other never does
  // Sample the pods' alpha every frame up to just before the timeout.
  const samples = await page.evaluate(({ until }) => {
    const w = window as any;
    const d = w.__game.scene.keys['Sandbox'].__debug;
    const out: { t: number; alpha: number; phase: string }[] = [];
    while (d.pods().elapsedMs < until) {
      w.__step();
      out.push({ t: d.pods().elapsedMs, alpha: d.pods().pods[0].alpha, phase: d.pods().phase });
    }
    return out;
  }, { until: PODS.timeoutMs - 32 });
  expect(samples.every((s) => s.phase === 'live')).toBe(true);
  const early = samples.filter((s) => s.t < PODS.timeoutMs - PODS.blinkMs);
  const late = samples.filter((s) => s.t > PODS.timeoutMs - PODS.blinkMs);
  expect(early.every((s) => s.alpha === 1)).toBe(true);
  expect(late.some((s) => s.alpha < 1)).toBe(true); // blinking: "going soon"
  // Past the timeout the pods go, P1 keeps what it had, and the flyby follows.
  expect((await stepUntil(page, "s.__debug.pods().phase === 'idle'", 60)).done).toBe(true);
  expect(await modes(page, 1)).toEqual({ modes: ['missile'], current: 'missile' });
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'detonator'], current: 'detonator' });
  expect(await debug(page, 'transition()')).toMatchObject({ phase: 'leadIn', flights: ['1-2'] });
});

test('solo: the pods leave as soon as the one seat picks (AC3)', async ({ page }) => {
  await gotoGame(page, '', { p2: 'normal' });
  await dropPods(page);
  expect(await debug(page, 'pickPod(1, 0)')).toBe(false); // no top seat in this run
  await shoot(page, 'p2', { x: PODS.xs[1], y: 600 }, 0, -SLING.maxSpeed);
  expect((await stepUntil(page, "s.__debug.pods().phase === 'idle'", 80)).done).toBe(true);
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'detonator'], current: 'detonator' });
});

test('an upward swipe on SPECIAL rotates the modes and fires nothing; a wobbly tap still fires (AC6)', async ({ page }) => {
  await gotoGame(page);
  const t = await touchscreen(page);
  const L = await v2Layout(page, 2);
  await countShots(page);
  const swipe = SPECIAL_SWIPE.minUpPx + 12;

  // One mode: a swipe neither rotates nor fires, and no pips are drawn.
  await dragSpecial(page, t, L.special, 0, -swipe);
  expect(await fired(page)).toBe(0);
  expect(await modes(page, 2)).toEqual({ modes: ['missile'], current: 'missile' });
  expect(await page.evaluate(`${SCENE}.controls[1].pipsGfx.commandBuffer.length`)).toBe(0);

  await debug(page, "setSpecial(2, 'triple')");
  await debug(page, "setSpecial(2, 'detonator')");
  expect(await page.evaluate(`${SCENE}.controls[1].pipsGfx.commandBuffer.length`)).toBeGreaterThan(0);
  // detonator → missile (wraps) → triple; the button and the HUD row follow.
  await dragSpecial(page, t, L.special, 0, -swipe);
  expect(await debug(page, 'special(2)')).toEqual({ control: 'missile', hud: 'missile' });
  await dragSpecial(page, t, L.special, 4, -swipe); // a little off vertical still counts
  expect(await debug(page, 'special(2)')).toEqual({ control: 'triple', hud: 'triple' });
  expect(await fired(page)).toBe(0);
  expect(await debug(page, 'specialAmmo(2)')).toBe(SPECIAL.max);
  // The carousel settles: the outgoing icon is gone once it's played.
  await stepGame(page, 16, Math.ceil(SPECIAL_SWIPE.carouselMs / 16) + 1);
  expect(await page.evaluate(`${SCENE}.controls[1].outgoingIconGfx.visible`)).toBe(false);

  // A wobbly tap (short drift) and a sideways slide are taps: they fire, no rotation.
  await dragSpecial(page, t, L.special, 6, -(SPECIAL_SWIPE.minUpPx - 10));
  expect(await fired(page)).toBe(3); // the triple's three missiles
  await page.evaluate(`${SCENE}.huds[1].setUnlimitedAmmo(true)`);
  await dragSpecial(page, t, L.special, -40, -30);
  expect(await fired(page)).toBe(6);
  expect((await modes(page, 2)).current).toBe('triple');
});

test('the swipe is "up" toward the field for the top seat and for a lefty seat (AC6)', async ({ page }) => {
  await gotoGame(page);
  const t = await touchscreen(page);
  await countShots(page);
  const swipe = SPECIAL_SWIPE.minUpPx + 12;
  for (const player of [1, 2] as const) await debug(page, `setSpecial(${player}, 'triple')`);

  // The top seat's "up" is down the screen.
  const top = await v2Layout(page, 1);
  await dragSpecial(page, t, top.special, 0, -swipe); // up the screen: away from the field, so a tap
  expect((await modes(page, 1)).current).toBe('triple');
  expect(await fired(page)).toBe(3); // it fired the triple
  await dragSpecial(page, t, top.special, 0, swipe);
  expect((await modes(page, 1)).current).toBe('missile');

  // A lefty seat (mirrored buttons) swipes up the same way.
  await page.evaluate(`${SCENE}.controls[1].toggleLefty()`);
  const lefty = await v2Layout(page, 2);
  expect(lefty.special.x).toBeGreaterThan(180);
  await dragSpecial(page, t, lefty.special, 0, -swipe);
  expect((await modes(page, 2)).current).toBe('missile');
  expect(await fired(page)).toBe(3); // the swipes fired nothing
});

test('the triple missile: one press, one ammo, three missiles on three different rocks (AC4)', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  // Three rocks across the boot aim (straight up from P2's launcher at x=180).
  const rocks = [{ x: 120, y: 380 }, { x: 180, y: 380 }, { x: 240, y: 380 }];
  for (const [slot, r] of rocks.entries()) await fieldRock(page, { ...r, slot });
  await debug(page, "setSpecial(2, 'triple')");
  await countShots(page);
  const t = await touchscreen(page);
  const L = await v2Layout(page, 2);
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 2);
  await t.up(1);
  await stepGame(page, 16, 1);
  expect(await fired(page)).toBe(3);
  expect(await debug(page, 'specialAmmo(2)')).toBe(SPECIAL.max - 1);
  const targets = (await page.evaluate(
    `${SCENE}.rockets.group.getChildren().filter((r) => r.active && r.getData('missile')).map((r) => ${SCENE}.asteroids.indexOf(r.getData('target')))`
  )) as number[];
  expect(targets.sort()).toEqual([0, 1, 2]);
  expect((await stepUntil(page, `[0, 1, 2].every((i) => !s.asteroids[i].isActive || s.asteroids[i].isPopping)`, 120)).done).toBe(true);
});

test('the detonator: a straight bomb that blows up on the next SPECIAL press (AC4)', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  await stepGame(page, 16, 1);
  const blastY = 460;
  // Off the bomb's line (x=180), so it flies past them to blastY.
  await fieldRock(page, { x: 180 + 40, y: blastY - 10, hp: 3, slot: 0 }); // inside: 3 hp → 1
  await fieldRock(page, { x: 180 - 40, y: blastY, slot: 1 }); // inside: 1 hp → popped
  await fieldRock(page, { x: 180 + BOMB.blastRadius + 50, y: blastY, slot: 2 }); // outside: untouched
  await debug(page, "setSpecial(2, 'detonator')");
  await countShots(page);
  const t = await touchscreen(page);
  const L = await v2Layout(page, 2);
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 1);
  await t.up(1);
  await stepGame(page, 16, 1);
  const bomb = await debug<{ vx: number; vy: number }>(page, 'bomb(2)');
  expect(bomb).toMatchObject({ vx: expect.closeTo(0, 3), vy: expect.closeTo(-BOMB.speed, 3) });
  expect(await page.evaluate(`${SCENE}.controls[1].iconFace`)).toBe('detonate');
  expect((await stepUntil(page, `s.__debug.bomb(2) && s.__debug.bomb(2).y <= ${blastY}`, 120)).done).toBe(true);
  expect((await debug<{ vx: number }>(page, 'bomb(2)')).vx).toBeCloseTo(0, 3); // still straight

  // The next press blows it up, even one that slides up like a swipe: no rotation, no shot.
  await dragSpecial(page, t, L.special, 0, -(SPECIAL_SWIPE.minUpPx + 12));
  expect(await debug(page, 'bomb(2)')).toBeNull();
  expect(await fired(page)).toBe(1);
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'detonator'], current: 'detonator' });
  expect(await debug(page, 'specialAmmo(2)')).toBe(SPECIAL.max - 1);
  expect(await debug(page, 'asteroidHp(0)')).toBe(1);
  // Rock 1 popped (its score; the wall-clock pop tween may already have
  // respawned it off the right edge), and rock 2, outside the blast, is untouched.
  expect(await score(page)).toBe(SCORE.standard);
  expect(await debug(page, 'asteroidHp(2)')).toBe(1);
  expect(await page.evaluate(`${SCENE}.asteroids[2].sprite.x`)).toBe(180 + BOMB.blastRadius + 50);
  expect(await page.evaluate(`${SCENE}.controls[1].iconFace`)).toBe('detonator');
});

test('a bomb also blows up on touching a rock, and at the screen edge (AC4)', async ({ page }) => {
  await gotoGame(page);
  await clearField(page);
  await stepGame(page, 16, 1);
  await fieldRock(page, { x: 180, y: 420, slot: 0 }); // on the line
  await fieldRock(page, { x: 180 + 30, y: 400, slot: 1 }); // beside it, inside the blast
  await debug(page, "setSpecial(2, 'detonator')");
  const t = await touchscreen(page);
  const L = await v2Layout(page, 2);
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 1);
  await t.up(1);
  expect((await stepUntil(page, 's.__debug.bomb(2) === null', 120)).done).toBe(true);
  expect(await score(page)).toBe(2 * SCORE.standard); // both popped by the one blast

  // Nothing in its way: it reaches the top edge and blows up there.
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 1);
  await t.up(1);
  await stepGame(page, 16, 1);
  expect(await debug(page, 'bomb(2)')).not.toBeNull();
  expect((await stepUntil(page, 's.__debug.bomb(2) === null', 200)).done).toBe(true);
  expect(await liveShots(page)).toEqual([]);
});

test('boss fight: a blast takes each escort it reaches as that seat\'s lock and never hurts the boss (AC4)', async ({ page }) => {
  await gotoGame(page);
  await enterBoss(page);
  const at = (await page.evaluate(`(() => { const e = ${SCENE}.bossEncounter.escorts[0].sprite; return { x: e.x, y: e.y }; })()`)) as Pt;
  // A P2 bomb blown up right on escort 0: its P2 lock (bit 2) is set, as a P2 shot would.
  await page.evaluate(`${SCENE}.detonate(${SCENE}.rockets.fire('rocket-p2', ${at.x}, ${at.y}, 0, 0, 'p2', { bomb: true }))`);
  expect((await escortLocks(page))[0]).toBe(2);
  // One blown up on the boss itself does nothing to it.
  const boss = (await page.evaluate(`(() => { const b = ${SCENE}.bossEncounter.boss.sprite; return { x: b.x, y: b.y }; })()`)) as Pt;
  await page.evaluate(`${SCENE}.detonate(${SCENE}.rockets.fire('rocket-p1', ${boss.x}, ${boss.y}, 0, 0, 'p1', { bomb: true }))`);
  expect(await debug(page, 'bossHp()')).toBe(BOSS.hp);
});

test('Try again keeps the specials the seats had when the act began; a fresh run has only the missile (AC7)', async ({ page }) => {
  await gotoGame(page);
  await dropPods(page);
  await debug(page, 'pickPod(1, 0)');
  await debug(page, 'pickPod(2, 1)');
  await debug(page, 'skipDrop()');
  expect((await stepUntil(page, "(s.__debug.skipTransition(), s.__debug.wave() === 4 && s.__debug.state() === 'live')", 400)).done).toBe(true);
  // Rotate P1 back to the missile mid-act: Try again restores the act-start picture.
  await debug(page, "setSpecial(1, 'missile')");
  await loseRun(page);
  await tryAgain(page);
  expect(await debug(page, 'wave()')).toBe(4);
  expect(await modes(page, 1)).toEqual({ modes: ['missile', 'triple'], current: 'triple' });
  expect(await modes(page, 2)).toEqual({ modes: ['missile', 'detonator'], current: 'detonator' });
  expect(await debug(page, 'special(1)')).toEqual({ control: 'triple', hud: 'triple' });
  expect(await debug(page, 'special(2)')).toEqual({ control: 'detonator', hud: 'detonator' });

  // A win goes back to the join screen, and the next run starts with only the missile.
  await winToFreshRun(page);
  for (const player of [1, 2] as const) expect(await modes(page, player)).toEqual({ modes: ['missile'], current: 'missile' });
});
