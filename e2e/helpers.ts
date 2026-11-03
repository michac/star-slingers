/**
 * helpers.ts — the shared harness for the e2e specs (one spec per area:
 * combat, waves, boss, solo, controls-v2, haptics). Boots the game in a
 * Pixel-6-sized touch viewport, drives it with real CDP touches + direct
 * `scene.rockets.fire(...)` shots, and reads live state through the
 * `window.__game` hook (src/main.ts) and the scene's DEV `__debug` surface
 * (src/scenes/SandboxScene.ts).
 *
 * Specs import `test` and `expect` from here, not from '@playwright/test':
 * this `test` carries the zero-console-error gate, so every case fails on a
 * console error or an uncaught page error.
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
 * boss slide-in is skipped with the __debug.snapBossIn() hook (enterBoss()).
 *
 * Speed: two headless-swiftshader costs dominated the old runtime. (1) A
 * screenshot forces a ~7s ReadPixels render, so the smoke-*.png eyeball frames
 * are OPT-IN (SMOKE_SHOTS=1) — the stepped frame is stale anyway. (2) Any
 * page.evaluate that runs against a LIVE render loop stalls ~0.8s waiting for
 * the in-flight software frame, so gotoGame() parks the RAF loop right after
 * boot — every interaction is then instant (boss 8s→1.7s). stepUntil() also runs
 * its whole loop inside one evaluate, so a 200-frame window is one round-trip,
 * not one per frame.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { ASTEROID_KIND } from '../src/waves';
import { GAME_HEIGHT, GAME_WIDTH } from '../src/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */

export { expect, type Page };

/** Every case gates on a clean console: console errors and uncaught page errors
 *  collected over the case fail it at teardown. An auto fixture, so a spec gets
 *  it just by importing this `test`. */
export const test = base.extend<{ consoleGate: void }>({
  consoleGate: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export const SCENE = `window.__game.scene.keys['Sandbox']`;

export async function gotoGame(page: Page, query = ''): Promise<void> {
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
export async function shot(page: Page, path: string): Promise<void> {
  if (SMOKE_SHOTS) await page.screenshot({ path });
}

/** Advance `count` frames of exactly `deltaMs` game-time on the parked loop (via
 *  the window.__step stepper gotoGame installs) — physics, overlaps and every
 *  deltaMs timer step in lockstep, no rendering and no wall-clock racing. Each
 *  case runs serial on a fresh page (fresh game), so owning the clock is clean.
 *  NB Phaser's TweenManager is wall-clock driven and does NOT advance here — use
 *  the __debug snap hooks (e.g. snapBossIn) for tween-gated state. */
export async function stepGame(page: Page, deltaMs = 16, count = 1): Promise<void> {
  await page.evaluate(({ d, n }) => (window as any).__step(n, d), { d: deltaMs, n: count });
}

/** Step the game up to `maxSteps` fixed 16ms frames INSIDE the browser — the
 *  whole loop is one page.evaluate, so it costs a single CDP round-trip no matter
 *  how many frames it takes (a ~188-frame boss window is still ~30ms, and it
 *  never pays per-frame round-trip latency). Stops as soon as `cond` — the SOURCE
 *  of a boolean expression over the scene `s` (e.g. `"s.__debug.hits() > 0"`) —
 *  reads truthy. Physics/overlaps/deltaMs timers advance in lockstep, no render,
 *  no wall-clock racing. Returns whether it fired and how many steps it took. */
export async function stepUntil(
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
export async function fieldRock(
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
export const fire = (page: Page, x: number, y: number, vx: number, vy: number) =>
  page.evaluate(`void ${SCENE}.rockets.fire('rocket-p1', ${x}, ${y}, ${vx}, ${vy})`);
export const escortsAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.escortsAlive()`) as Promise<number>;
export const hitEscort = (page: Page, i: number, player: 'p1' | 'p2') =>
  page.evaluate(`${SCENE}.__debug.hitEscort(${i}, '${player}')`);
export const escortLocks = (page: Page) => page.evaluate(`${SCENE}.__debug.escortLocks()`) as Promise<number[]>;
/** How many shield-web links are up (4 = the intact diamond). */
export const shieldLinks = (page: Page) => page.evaluate(`${SCENE}.__debug.shieldLinks()`) as Promise<number>;
/** Raw boss start: the boss is left mid slide-in (the tween never advances under
 *  stepping). Cases want enterBoss(). */
export const startBoss = (page: Page) => page.evaluate(`${SCENE}.__debug.startBoss()`);
/** Start the boss fight ready to play: startBoss, snap the (wall-clock) entrance
 *  tween to its end, then one 16ms frame so the encounter observes the entered boss. */
export async function enterBoss(page: Page): Promise<void> {
  await startBoss(page);
  await page.evaluate(`${SCENE}.__debug.snapBossIn()`);
  await stepGame(page, 16, 1);
}
/** The health bars (#23) drawn on the latest frame: centre + remaining fraction
 *  (HealthBars' DrawnHealthBar; not imported, because that module reads
 *  import.meta.env, which the Node-typed e2e project doesn't declare). */
export const healthBars = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.healthBars()`) as Promise<{ x: number; y: number; frac: number }[]>;

// ---------------------------------------------------------------------------
// Touch helpers for the controls-v2 (#7) seats: two-thumb drag aim + fire
// buttons, driven by REAL touches (controls-v2, haptics and solo specs).
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
// time dispatchTouchEvent resolves (controls-v2.spec.ts's first case asserts
// this without stepping); __step is only needed to advance GAME time (FIRE's charge).
// ---------------------------------------------------------------------------

export type Pt = { x: number; y: number };
/** P1's spot for a P2 point: the top seat is P2's layout rotated 180° about the centre. */
export const mirrored = (p: Pt): Pt => ({ x: GAME_WIDTH - p.x, y: GAME_HEIGHT - p.y });
type V2Layout = { anchor: Pt; fire: Pt & { r: number }; home: Pt & { r: number }; pad: Pt & { r: number } };
export type LiveShot = { vx: number; vy: number; charged: boolean; homing: boolean; player: string; targetIsRock0: boolean };

/** A multi-touch screen over CDP, in GAME coords (mapped through the canvas
 *  rect). touchStart/touchMove carry every currently-down point with a stable
 *  id (Chromium presses the new ids and moves the rest). Lifting is a touchEnd
 *  carrying ONLY the lifted point: a touchMove that merely omits a finger does
 *  NOT release it (found empirically; the same shape Puppeteer's TouchHandle
 *  uses). */
export async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const rect = await page.evaluate(({ w, h }) => {
    const r = document.querySelector('#game canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, sx: r.width / w, sy: r.height / h };
  }, { w: GAME_WIDTH, h: GAME_HEIGHT });
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

export const v2Layout = (page: Page, player: 1 | 2) =>
  page.evaluate(`${SCENE}.__debug.v2Layout(${player})`) as Promise<V2Layout>;

/** Every in-flight rocket, read straight off the pool. */
export const liveShots = (page: Page) =>
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
