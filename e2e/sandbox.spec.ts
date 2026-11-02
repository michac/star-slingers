/**
 * sandbox.spec.ts — Playwright Test port of the old smoke.mjs. Boots the game in
 * a Pixel-6-sized touch viewport, drives it with coordinate taps + direct
 * `scene.rockets.fire(...)` shots, and reads live state through the
 * `window.__game` hook (src/main.ts) and the scene's DEV `__debug` surface
 * (src/scenes/SandboxScene.ts) to assert the seams in CLAUDE.md: hit-counter,
 * scoring, homing, charged-pierce, asteroid split, the boss shield-web cycle,
 * and the ?boss shortcut — plus zero console errors per case.
 *
 * Every old `console.log("…OK/FAIL")` is now an `expect()`, so a real
 * regression goes red with a non-zero exit (the gap the hand-rolled script
 * left open — its semantic checks printed FAIL but still exited 0).
 *
 * Headless caveat (load-bearing): software-WebGL ReadPixels stalls clamp
 * Phaser's per-frame delta, so headless game-time runs ~10× slower than
 * wall-clock. A Sonnet review confirmed this is a rendering artifact, not a
 * game bug.
 *
 * B36 fixed the flaky suite by taking the game clock directly: every interaction
 * case (hits, score, homing, pierce, split, boss) FIELDS a stationary rock via
 * fieldRock() — the public reconfigure()/spawn() path — then drives a fixed 16ms
 * timestep with stepGame(): pause the RAF loop and advance via game.scene.update
 * (physics, overlaps, deltaMs timers — all in lockstep, no rendering, no
 * wall-clock racing). No case waits for a wave rock to drift on-screen. Phaser's
 * TweenManager is wall-clock driven and does NOT advance under stepping, so the
 * boss slide-in is skipped with the __debug.snapBossIn() hook.
 *
 * Speed (the suite is ~15s / 8 cases, ~1min at --repeat-each=5): two headless-
 * swiftshader costs dominated the old runtime. (1) A screenshot forces a ~7s
 * ReadPixels render, so the smoke-*.png eyeball frames are now OPT-IN
 * (SMOKE_SHOTS=1) — the stepped frame is stale anyway. (2) Any page.evaluate that
 * runs against a LIVE render loop stalls ~0.8s waiting for the in-flight software
 * frame, so gotoGame() parks the RAF loop right after boot — every interaction is
 * then instant (boss 8s→1.7s). stepUntil() also runs its whole loop inside one
 * evaluate, so a 200-frame window is one round-trip, not one per frame.
 */
import { test, expect, type Page } from '@playwright/test';
import { ASTEROID_KIND, clearDamage, solveWave } from '../src/waves';
import { SLING } from '../src/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCENE = `window.__game.scene.keys['Sandbox']`;

// Console/page errors collected per test (listeners attached in beforeEach).
let errors: string[];

async function gotoGame(page: Page, query = ''): Promise<void> {
  // Default 'load' (not 'networkidle' — Vite HMR keeps the socket busy).
  await page.goto('/' + query);
  await page.waitForSelector('#game canvas', { timeout: 15_000 });
  // Wait for the scene's create() to run (its DEV __debug hook is the last thing
  // it installs) rather than a fixed sleep — returns as soon as the game is ready
  // to drive, which is both faster and less flaky than "hope a second is enough".
  await page.waitForFunction(
    () => (window as any).__game?.scene?.keys?.['Sandbox']?.__debug !== undefined,
    undefined,
    { timeout: 15_000 }
  );
  // Park the RAF loop immediately. Under headless SwiftShader a live render frame
  // is slow, and any page.evaluate that touches the scene stalls waiting for the
  // in-flight frame (~0.8s each) — the dominant cost once screenshots are off.
  // The interaction cases drive time via stepGame anyway, so nothing needs the
  // live loop; this makes every subsequent evaluate cheap.
  // Then install the ONE fixed-timestep stepper every case drives time through:
  // window.__step(n, d) advances n frames of exactly d ms game-time via
  // game.scene.update on a manual clock (window.__stepTime). The loop is parked,
  // so loop.time is frozen and seeding the clock here is the same as seeding it
  // on first use.
  await page.evaluate(() => {
    const w = window as any;
    const g = w.__game;
    g.loop.sleep();
    w.__stepTime = g.loop.time;
    w.__step = (n = 1, d = 16) => {
      for (let i = 0; i < n; i++) {
        w.__stepTime += d;
        g.scene.update(w.__stepTime, d);
      }
    };
  });
}

/** Eyeball-aid screenshot — OFF by default (a headless swiftshader ReadPixels
 *  render costs ~7s/frame, and since the interaction cases step WITHOUT rendering
 *  the frame is stale anyway). Set SMOKE_SHOTS=1 to write the smoke-*.png frames. */
const SMOKE_SHOTS = !!process.env.SMOKE_SHOTS;
async function shot(page: Page, path: string): Promise<void> {
  if (SMOKE_SHOTS) await page.screenshot({ path });
}

/** Advance `count` frames of exactly `deltaMs` game-time on the parked loop (via
 *  the window.__step stepper gotoGame installs) — physics, overlaps and every
 *  deltaMs timer step in lockstep, no rendering and no wall-clock racing. Each
 *  case runs serial on a fresh page (fresh game), so owning the clock is clean.
 *  NB Phaser's TweenManager is wall-clock driven and does NOT advance here — use
 *  the __debug snap hooks (e.g. snapBossIn) for tween-gated state. */
async function stepGame(page: Page, deltaMs = 16, count = 1): Promise<void> {
  await page.evaluate(({ d, n }) => (window as any).__step(n, d), { d: deltaMs, n: count });
}

/** Step the game up to `maxSteps` fixed 16ms frames INSIDE the browser — the
 *  whole loop is one page.evaluate, so it costs a single CDP round-trip no matter
 *  how many frames it takes (a ~188-frame boss window is still ~30ms, and it
 *  never pays per-frame round-trip latency). Stops as soon as `cond` — the SOURCE
 *  of a boolean expression over the scene `s` (e.g. `"s.__debug.hits() > 0"`) —
 *  reads truthy. Physics/overlaps/deltaMs timers advance in lockstep, no render,
 *  no wall-clock racing. Returns whether it fired and how many steps it took. */
async function stepUntil(
  page: Page,
  cond: string,
  maxSteps = 400
): Promise<{ done: boolean; steps: number }> {
  return page.evaluate(
    ({ cond, maxSteps }) => {
      const w = window as any;
      const s = w.__game.scene.keys['Sandbox'];
      // eslint-disable-next-line no-new-func
      const test = new Function('s', `return (${cond});`) as (scene: unknown) => boolean;
      let steps = 0;
      while (steps < maxSteps && !test(s)) {
        w.__step();
        steps++;
      }
      return { done: test(s), steps };
    },
    { cond, maxSteps }
  );
}

/** Field a rock directly through the public reconfigure()/spawn() path (exactly
 *  what startWave does for lane rocks), then park it STATIONARY in-field at
 *  (x,y), clear of the station — so an interaction test never has to wait for a
 *  wave rock to drift into range. Uses a lane wrapper (asteroids[slot], slots
 *  0..3; the splitter-child pool is the tail). */
async function fieldRock(
  page: Page,
  {
    x,
    y,
    kind = 'standard',
    radius = ASTEROID_KIND[kind].radius,
    slot = 0,
    hp,
  }: { x: number; y: number; kind?: 'standard' | 'splitter'; radius?: number; slot?: number; hp?: number }
): Promise<void> {
  await page.evaluate(
    ({ x, y, kind, radius, slot, hp }) => {
      const s = (window as any).__game.scene.keys['Sandbox'];
      const a = s.asteroids[slot]; // a lane wrapper (NOT a child)
      // hp omitted = the kind's default max hp (1 today).
      a.reconfigure({ kind, radius, y, speed: 0, ...(hp === undefined ? {} : { hp }) }, 0);
      a.spawn(); // field it (off the right edge)...
      a.sprite.setPosition(x, y); // ...then place it in-field, clear of the station
      a.sprite.body.reset(x, y);
      a.sprite.body.setVelocity(0, 0);
    },
    { x, y, kind, radius, slot, hp }
  );
}

// --- thin wrappers over the scene's DEV __debug surface + public fields ---
/** Fire a plain P1 rocket through the public pool (no railgun/homing tags). */
const fire = (page: Page, x: number, y: number, vx: number, vy: number) =>
  page.evaluate(`void ${SCENE}.rockets.fire('rocket-p1', ${x}, ${y}, ${vx}, ${vy})`);
const hits = (page: Page) => page.evaluate(`${SCENE}.__debug.hits()`) as Promise<number>;
const score = (page: Page) => page.evaluate(`${SCENE}.__debug.score()`) as Promise<number>;
const splitCount = (page: Page) => page.evaluate(`${SCENE}.__debug.splitCount()`) as Promise<number>;
const childrenAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.childrenAlive()`) as Promise<number>;
const bossPhase = (page: Page) => page.evaluate(`${SCENE}.__debug.bossPhase()`) as Promise<string>;
const bossHp = (page: Page) => page.evaluate(`${SCENE}.__debug.bossHp()`) as Promise<number>;
const escortsAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.escortsAlive()`) as Promise<number>;
const hitEscort = (page: Page, i: number, player: 'p1' | 'p2') =>
  page.evaluate(`${SCENE}.__debug.hitEscort(${i}, '${player}')`);
const escortLocks = (page: Page) => page.evaluate(`${SCENE}.__debug.escortLocks()`) as Promise<number[]>;
const startBoss = (page: Page) => page.evaluate(`${SCENE}.__debug.startBoss()`);

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
});

test.afterEach(() => {
  // Every case gates on a clean console.
  expect(errors).toEqual([]);
});

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

  const hitsBefore = await hits(page);
  await fire(page, 170, 300, 400, 0);
  const scored = await stepUntil(page, 's.__debug.score() >= 20', 120);
  expect(scored.done).toBe(true);
  expect(await score(page)).toBe(20);
  expect(await childrenAlive(page)).toBe(2);
});

test('wave solver uses only standards and three-hit splitters', () => {
  const specs = solveWave(0.75, 0);
  expect(specs.every((spec) => spec.kind === 'standard' || spec.kind === 'splitter')).toBe(true);
  expect(specs.every((spec) => spec.radius === ASTEROID_KIND[spec.kind].radius)).toBe(true);
  const cost = specs.reduce((sum, spec) => sum + clearDamage(spec), 0);
  expect(cost).toBeGreaterThan(specs.length); // a splitter contributes 3, not 2
});

test('off-axis homing shot curves in', async ({ page }) => {
  await gotoGame(page);

  // Deterministic homing check on the fixed-timestep clock (no wall-clock race).
  // Field a STATIONARY 1-hit rock in-field, clear of the station, via the public
  // reconfigure()/spawn() path (as the split case does) — removes the old
  // drift-window scan AND the moving-target race. Enable P1 homing and fire an
  // OFF-AXIS rocket whose straight path clears the rock by > its radius (a
  // non-homing shot misses below). Step frames until the hit counter ticks: if it
  // ticks within the step budget, the shot curved in. (Homing is off by default,
  // so the straight cases above are unaffected.)
  const homingBefore = await hits(page);
  await fieldRock(page, { x: 250, y: 300 });
  await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const a = s.asteroids[0];
    s.__debug.setHoming(1, true);
    // Off-axis: dy = +30 (> the 17px radius) so a straight shot misses below; a
    // small explicit armAt starts the turn-rate ramp early on the short runway.
    const r = s.rockets.fire('rocket-p1', 40, 330, 150, 0);
    r.setData('homing', true);
    r.setData('target', a);
    r.setData('speed', 150);
    r.setData('dist', 0);
    r.setData('armAt', 30);
  });

  const ticked = await stepUntil(page, `s.__debug.hits() > ${homingBefore}`, 300);
  await shot(page, 'smoke-homing.png');
  expect(ticked.done).toBe(true); // the shot connects near step ~80; ample headroom
  expect(await hits(page)).toBeGreaterThan(homingBefore);
});

test('charged shot rails through', async ({ page }) => {
  await gotoGame(page);

  // A charged shot is a RAILGUN: it pierces every asteroid in its path instead
  // of recycling on first contact. Field a rock directly, fire a charged rocket
  // head-on, then step until the rocket records a chip in its per-pass hitSet and
  // assert the SAME sprite is STILL active at that moment — proving it railed
  // through rather than recycled. (A normal shot would have been killAndHide'd by
  // handleHit on that first hit.) Fire + step + read all live in ONE evaluate, so
  // `active` is sampled in the same tick as the chip and there's no round-trip
  // race against world-bounds. Stepping one frame at a time catches the chip frame
  // before the rocket rails on to the world edge and recycles (which clears the
  // hitSet).
  await fieldRock(page, { x: 250, y: 300 });
  const pierce = (await page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const r = s.rockets.fire('rocket-p1', 170, 300, 400, 0);
    r.setData('charged', true);
    for (let n = 0; n < 60; n++) {
      const hs = r.getData('hitSet');
      if (hs && hs.size > 0) return { hit: true, active: r.active };
      w.__step();
    }
    const hs = r.getData('hitSet');
    return { hit: !!(hs && hs.size > 0), active: r.active };
  })) as { hit: boolean; active: boolean };
  await shot(page, 'smoke-pierce.png');
  expect(pierce.hit).toBe(true);
  expect(pierce.active).toBe(true);
});

test('a splitter immediately splits into two standard children', async ({ page }) => {
  await gotoGame(page);

  // One splitter hit scatters two standard-size, one-hit children that score 10
  // each. Field it directly through the public reconfigure()/spawn() path
  // (exactly what startWave does) and kill it on the fixed-timestep clock. Lane
  // wrappers are asteroids[0..3]; the child pool is the tail.
  const splitBefore = await splitCount(page);
  const hitsBefore = await hits(page);
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

test('boss co-op locks, shield-web gaps + regen', async ({ page }) => {
  await gotoGame(page);

  // Deterministic B34 boss test: the complete diamond has four physical links.
  // Downing one two-player escort removes its two links for 6s, pauses charge,
  // and lets a charged shot reach the always-vulnerable command ship.
  await startBoss(page);
  await page.evaluate(`${SCENE}.__debug.snapBossIn()`); // finish the entrance tween instantly
  await stepGame(page, 16, 1); // one frame so the encounter observes the entered boss
  const hpStart = await bossHp(page);
  await shot(page, 'smoke-boss-charging.png');
  expect(await bossPhase(page)).toBe('charging');
  expect(await page.evaluate(`${SCENE}.__debug.shieldLinks()`)).toBe(4);
  // A segment across the lower-left side intersects the intact web.
  expect(await page.evaluate(`${SCENE}.__debug.webBlocks(100, 400, 180, 400)`)).toBe(true);

  // Every ship needs BOTH colors. A P1 double-tap consumes both rockets but
  // leaves escort 0 awaiting amber; the reverse order clears escort 2, the
  // left-side node. That opens the incoming horizontal path from the slings.
  await hitEscort(page, 0, 'p1');
  await hitEscort(page, 0, 'p1');
  expect(await escortsAlive(page)).toBe(4);
  expect((await escortLocks(page))[0]).toBe(1);
  await hitEscort(page, 2, 'p2');
  await hitEscort(page, 2, 'p1');
  await stepGame(page, 16, 1);
  expect(await escortsAlive(page)).toBe(3);
  expect(await page.evaluate(`${SCENE}.__debug.shieldLinks()`)).toBe(2);
  expect(await page.evaluate(`${SCENE}.__debug.webBlocks(60, 370, 200, 370)`)).toBe(false);

  // Ordinary gap shots remain harmless; a railgun through the same missing
  // links damages the boss.
  await fire(page, 60, 370, 350, 0);
  await stepGame(page, 16, 30);
  expect(await bossHp(page)).toBe(hpStart);
  await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const r = s.rockets.fire('rocket-p1', 60, 370, 350, 0);
    r.setData('charged', true);
  });
  const dropped = await stepUntil(page, `s.__debug.bossHp() < ${hpStart}`, 80);
  expect(dropped.done).toBe(true);
  expect(await bossHp(page)).toBeLessThan(hpStart);

  // The open gap freezes the charge rather than letting a beam race the team.
  await stepGame(page, 16, 240);
  expect(await page.evaluate(`${SCENE}.__debug.bossCharge()`)).toBe(0);
  expect(await escortsAlive(page)).toBe(3);

  // The downed node regenerates after 6s with both locks reset, restoring all
  // four links; charge then resumes and can still fire at the station.
  const regenerated = await stepUntil(page, 's.__debug.escortsAlive() === 4', 100);
  expect(regenerated.done).toBe(true);
  expect(await escortsAlive(page)).toBe(4);
  // Only the regenerated node resets; surviving escorts retain any real hits.
  expect((await escortLocks(page))[2]).toBe(0);
  expect(await page.evaluate(`${SCENE}.__debug.shieldLinks()`)).toBe(4);
  const shieldBefore = await page.evaluate(`${SCENE}.__debug.stationShield()`);
  const fired = await stepUntil(page, `s.__debug.stationShield() < ${shieldBefore}`, 350);
  expect(fired.done).toBe(true);
});

test('?boss shortcut boots into the fight', async ({ page }) => {
  // A fresh load with ?boss must boot straight into the boss fight (phase
  // 'charging'), skipping the waves.
  await gotoGame(page, '?boss');
  await page.waitForFunction(
    () => (window as any).__game?.scene.keys['Sandbox']?.__debug?.bossPhase?.() === 'charging',
    undefined,
    { timeout: 10_000 }
  );
  expect(await bossPhase(page)).toBe('charging');
});

test('an hp-3 rock survives two hits and pops on the third', async ({ page }) => {
  await gotoGame(page);

  // Asteroid health: a rock fielded with a 3-hp override takes damage from each
  // plain shot (DAMAGE.normal = 1) but only pops — and scores — on the hit that
  // takes it to 0. Each shot is stepped to its hit before the next is fired, so
  // the hit counter isolates them on the fixed-timestep clock.
  await fieldRock(page, { x: 250, y: 300, hp: 3 });
  const hitsBefore = await hits(page);
  const hp = () => page.evaluate(`${SCENE}.__debug.asteroidHp(0)`) as Promise<number>;
  const active = () => page.evaluate(`${SCENE}.asteroids[0].isActive && !${SCENE}.asteroids[0].isPopping`);
  expect(await hp()).toBe(3);

  for (const [n, hpLeft] of [[1, 2], [2, 1]] as const) {
    await fire(page, 170, 300, 400, 0);
    const hit = await stepUntil(page, `s.__debug.hits() >= ${hitsBefore + n}`, 120);
    expect(hit.done).toBe(true);
    expect(await hp()).toBe(hpLeft);
    expect(await score(page)).toBe(0); // a non-lethal hit never scores
    expect(await active()).toBe(true); // ...and the rock stays in play
  }

  await fire(page, 170, 300, 400, 0);
  const popped = await stepUntil(page, `s.__debug.score() >= 10`, 120);
  expect(popped.done).toBe(true);
  expect(await hits(page)).toBe(hitsBefore + 3);
  expect(await score(page)).toBe(10); // a standard's points, awarded once on the kill
});

// ---------------------------------------------------------------------------
// Controls v2 (#7): two-thumb aim + fire buttons, driven by REAL touches.
//
// Touches go through a CDP session (Input.dispatchTouchEvent), so they travel
// the browser's real touch path into Phaser's TouchManager. Does that still work
// with the RAF loop parked by gotoGame()? Yes, and synchronously. Read in
// node_modules/phaser/src/input/: TouchManager's DOM listeners call
// InputManager.onTouchStart/Move/End directly; those call updateInputPlugins()
// → InputPlugin.update(type, pointers) → processDownEvents/processMoveEvents/
// processUpEvents, which emit the scene-level 'pointerdown' / 'pointermove' /
// 'pointerup' (or 'pointerupoutside') inside the DOM event itself. Nothing is
// queued for the next game step: loop.sleep() only stops the TimeStep's RAF,
// and the gates (manager.enabled, InputPlugin.isActive → scene.sys.canInput())
// don't look at the loop. So the seats' handleDown/Move/Up have run by the
// time dispatchTouchEvent resolves (the first case asserts this without
// stepping); __step is only needed to advance GAME time (FIRE's charge).
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
type V2Layout = { anchor: Pt; fire: Pt & { r: number }; home: Pt & { r: number }; pad: Pt & { r: number } };
type LiveShot = { vx: number; vy: number; charged: boolean; homing: boolean; player: string; targetIsRock0: boolean };

/** A multi-touch screen over CDP, in GAME coords (mapped through the canvas
 *  rect). touchStart/touchMove carry every currently-down point with a stable
 *  id (Chromium presses the new ids and moves the rest). Lifting is a touchEnd
 *  carrying ONLY the lifted point: a touchMove that merely omits a finger does
 *  NOT release it (found empirically; the same shape Puppeteer's TouchHandle
 *  uses). */
async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const rect = await page.evaluate(() => {
    const r = document.querySelector('#game canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, sx: r.width / 360, sy: r.height / 740 };
  });
  const down = new Map<number, Pt>();
  const toPage = (id: number, p: Pt) => ({ id, x: rect.left + p.x * rect.sx, y: rect.top + p.y * rect.sy, radiusX: 4, radiusY: 4, force: 1 });
  const points = () => [...down].map(([id, p]) => toPage(id, p));
  const send = (type: string, touchPoints: ReturnType<typeof points>) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints });
  return {
    async down(id: number, x: number, y: number) {
      down.set(id, { x, y });
      await send('touchStart', points());
    },
    async move(id: number, x: number, y: number) {
      down.set(id, { x, y });
      await send('touchMove', points());
    },
    async up(id: number) {
      const p = down.get(id)!;
      down.delete(id);
      await send('touchEnd', [toPage(id, p)]);
    },
  };
}

const v2Layout = (page: Page, player: 1 | 2) =>
  page.evaluate(`${SCENE}.__debug.v2Layout(${player})`) as Promise<V2Layout>;
const aimDeg = (page: Page, player: 1 | 2) => page.evaluate(`${SCENE}.__debug.aimDeg(${player})`) as Promise<number>;
const controlsMode = (page: Page) => page.evaluate(`${SCENE}.__debug.controlsMode()`) as Promise<string>;

/** Every in-flight rocket, read straight off the pool. */
const liveShots = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    return s.rockets.group.getChildren()
      .filter((r: any) => r.active)
      .map((r: any) => ({
        vx: r.body.velocity.x,
        vy: r.body.velocity.y,
        charged: r.getData('charged') === true,
        homing: r.getData('homing') === true,
        player: r.getData('player'),
        targetIsRock0: r.getData('target') === s.asteroids[0],
      }));
  }) as Promise<LiveShot[]>;

/** A point on a seat's aim pad at seat-frame angle `deg` (0 = that player's
 *  right, 90 = across the field). The top seat's frame is rotated 180°. */
function padPoint(pad: V2Layout['pad'], player: 1 | 2, deg: number, frac = 0.8): Pt {
  const a = (deg * Math.PI) / 180;
  const sign = player === 2 ? 1 : -1;
  return { x: pad.x + sign * Math.cos(a) * pad.r * frac, y: pad.y - sign * Math.sin(a) * pad.r * frac };
}

/** Launch direction of a shot in that seat's frame, degrees. */
const shotDeg = (shot: LiveShot, player: 1 | 2) => {
  const sign = player === 2 ? 1 : -1;
  return (Math.atan2(-sign * shot.vy, sign * shot.vx) * 180) / Math.PI;
};

test('v2: hold FIRE + aim with a second finger fires an aimed railgun', async ({ page }) => {
  await gotoGame(page);
  expect(await controlsMode(page)).toBe('v2');
  const L = await v2Layout(page, 2);
  const t = await touchscreen(page);

  await t.down(1, L.fire.x, L.fire.y);
  // No step yet: the scene's pointerdown already ran during the dispatch.
  expect(await page.evaluate(`${SCENE}.controls[1].held`)).toBe('fire');

  const aim = padPoint(L.pad, 2, 60);
  await t.down(2, aim.x, aim.y);
  expect(await aimDeg(page, 2)).toBeCloseTo(60, 0);

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
  expect(L1.fire.x).toBeCloseTo(360 - L2.fire.x, 5);
  expect(L1.fire.y).toBeCloseTo(740 - L2.fire.y, 5);
  expect(L1.pad.x).toBeCloseTo(360 - L2.pad.x, 5);
  const t = await touchscreen(page);
  const aim = padPoint(L1.pad, 1, 130);
  await t.down(1, aim.x, aim.y);
  expect(await aimDeg(page, 1)).toBeCloseTo(130, 0);
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

test('v2: ?aim=drag turns the aim by sideways motion; ?lefty mirrors a seat', async ({ page }) => {
  await gotoGame(page, '?aim=drag&lefty=p2');
  expect(await page.evaluate(`${SCENE}.__debug.aimMode()`)).toBe('drag');
  const L = await v2Layout(page, 2);
  expect(L.fire.x).toBeGreaterThan(L.anchor.x); // lefty: buttons on the player's right
  expect(L.pad.x).toBeLessThan(L.anchor.x);
  const t = await touchscreen(page);
  // Thumb down anywhere in the (mirrored) aim zone: no jump, then drag right.
  await t.down(1, 60, 600);
  expect(await aimDeg(page, 2)).toBe(90);
  await t.move(1, 85, 600); // +25 units to the player's right
  expect(await aimDeg(page, 2)).toBeCloseTo(90 - 25 * 0.8, 3);
  await t.move(1, 300, 600); // way past: clamps
  expect(await aimDeg(page, 2)).toBe(15);
  await t.up(1);
});

test('?controls=sling boots the old controls and is remembered', async ({ page }) => {
  await gotoGame(page, '?controls=sling');
  expect(await controlsMode(page)).toBe('sling');
  expect(await page.evaluate(`${SCENE}.homingToggles.length`)).toBe(2);
  // A real pull-and-release on P2's sling fires a rocket up the field.
  const t = await touchscreen(page);
  await t.down(1, 180, 642);
  await t.move(1, 180, 700);
  await stepGame(page, 16, 1);
  await t.up(1);
  const shots = await liveShots(page);
  expect(shots).toHaveLength(1);
  expect(shots[0].vy).toBeLessThan(0);
  // The choice is saved: a bare reload (like the home-screen PWA) keeps it.
  await gotoGame(page);
  expect(await controlsMode(page)).toBe('sling');
});
