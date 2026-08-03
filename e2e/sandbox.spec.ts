/**
 * sandbox.spec.ts — Playwright Test port of the old smoke.mjs. Boots the game in
 * a Pixel-6-sized touch viewport, drives it with coordinate taps + direct
 * `scene.rockets.fire(...)` shots, and reads live state through the
 * `window.__game` hook (src/main.ts) and the scene's DEV `__debug` surface
 * (src/scenes/SandboxScene.ts) to assert the seams in CLAUDE.md: hit-counter,
 * scoring, homing, charged-pierce, asteroid split, the boss charge/expose/
 * recharge cycle, and the ?boss shortcut — plus zero console errors per case.
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
  // live loop; this makes every subsequent evaluate cheap. (loop.sleep is
  // idempotent — stepGame calls it again harmlessly.)
  await page.evaluate(() => (window as any).__game.loop.sleep());
}

/** Eyeball-aid screenshot — OFF by default (a headless swiftshader ReadPixels
 *  render costs ~7s/frame, and since the interaction cases step WITHOUT rendering
 *  the frame is stale anyway). Set SMOKE_SHOTS=1 to write the smoke-*.png frames. */
const SMOKE_SHOTS = !!process.env.SMOKE_SHOTS;
async function shot(page: Page, path: string): Promise<void> {
  if (SMOKE_SHOTS) await page.screenshot({ path });
}

/** Tap a screen coordinate. The canvas FIT-fills the viewport (360×740), so
 *  game coords map onto the canvas box — robust to any centering. */
async function tap(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('game canvas has no bounding box');
  const sx = box.width / 360;
  const sy = box.height / 740;
  await page.mouse.click(box.x + x * sx, box.y + y * sy);
}

/** Take deterministic control of the game clock: park the RAF loop and advance
 *  `count` frames of exactly `deltaMs` game-time via game.scene.update — physics,
 *  overlaps and every deltaMs timer step in lockstep, no rendering and no
 *  wall-clock racing. The manual clock persists on window across calls; each case
 *  runs serial on a fresh page (fresh game), so owning the loop per test is clean.
 *  NB Phaser's TweenManager is wall-clock driven and does NOT advance here — use
 *  the __debug snap hooks (e.g. snapBossIn) for tween-gated state. */
async function stepGame(page: Page, deltaMs = 16, count = 1): Promise<void> {
  await page.evaluate(
    ({ d, n }) => {
      const g = (window as any).__game;
      g.loop.sleep(); // park the RAF loop (idempotent) so only manual steps advance time
      const w = window as any;
      if (w.__stepTime === undefined) w.__stepTime = g.loop.time;
      for (let i = 0; i < n; i++) {
        w.__stepTime += d;
        g.scene.update(w.__stepTime, d);
      }
    },
    { d: deltaMs, n: count }
  );
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
      const g = (window as any).__game;
      g.loop.sleep(); // park the RAF loop so only manual steps advance time
      const w = window as any;
      if (w.__stepTime === undefined) w.__stepTime = g.loop.time;
      const s = g.scene.keys['Sandbox'];
      // eslint-disable-next-line no-new-func
      const test = new Function('s', `return (${cond});`) as (scene: unknown) => boolean;
      let steps = 0;
      while (steps < maxSteps && !test(s)) {
        w.__stepTime += 16;
        g.scene.update(w.__stepTime, 16);
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
 *  0..3; the B30 fragment pool is the tail). */
async function fieldRock(
  page: Page,
  {
    x,
    y,
    hits = 1,
    radius = 17,
    slot = 0,
  }: { x: number; y: number; hits?: number; radius?: number; slot?: number }
): Promise<void> {
  await page.evaluate(
    ({ x, y, hits, radius, slot }) => {
      const s = (window as any).__game.scene.keys['Sandbox'];
      const a = s.asteroids[slot]; // a lane wrapper (NOT a fragment)
      a.reconfigure({ radius, hits, y, speed: 0 }, 0);
      a.spawn(); // field it (off the right edge)...
      a.sprite.setPosition(x, y); // ...then place it in-field, clear of the station
      a.sprite.body.reset(x, y);
      a.sprite.body.setVelocity(0, 0);
    },
    { x, y, hits, radius, slot }
  );
}

// --- thin wrappers over the scene's DEV __debug surface + public fields ---
const hits = (page: Page) => page.evaluate(`${SCENE}.__debug.hits()`) as Promise<number>;
const score = (page: Page) => page.evaluate(`${SCENE}.__debug.score()`) as Promise<number>;
const splitCount = (page: Page) => page.evaluate(`${SCENE}.__debug.splitCount()`) as Promise<number>;
const fragmentsAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.fragmentsAlive()`) as Promise<number>;
const bossPhase = (page: Page) => page.evaluate(`${SCENE}.__debug.bossPhase()`) as Promise<string>;
const bossHp = (page: Page) => page.evaluate(`${SCENE}.__debug.bossHp()`) as Promise<number>;
const escortsAlive = (page: Page) =>
  page.evaluate(`${SCENE}.__debug.escortsAlive()`) as Promise<number>;
const killEscort = (page: Page, i: number) =>
  page.evaluate(`${SCENE}.__debug.killEscort(${i})`);
const startBoss = (page: Page) => page.evaluate(`${SCENE}.__debug.startBoss()`);
const setHoming = (page: Page, player: number, on: boolean) =>
  page.evaluate(`${SCENE}.__debug.setHoming(${player}, ${on})`);

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
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 170, 300, 400, 0)
  );

  const ticked = await stepUntil(page, `s.__debug.hits() > ${hitsBefore}`, 120);
  await shot(page, 'smoke-hit.png');
  expect(ticked.done).toBe(true); // the shot reaches the rock near step ~13
  expect(await hits(page)).toBeGreaterThan(hitsBefore);
});

test('a full pop scores', async ({ page }) => {
  await gotoGame(page);

  // Only the FINAL pop scores: a chip on a multi-hit rock leaves the score at 0.
  // Field a 2-hit rock directly and fire two head-on rockets, stepping each into
  // the (stationary) rock — the first chip (2->1) scores nothing, the pop (1->0)
  // drives the score > 0. Deterministic on the fixed-timestep clock.
  await fieldRock(page, { x: 250, y: 300, hits: 2 });

  const hitsBefore = await hits(page);
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 170, 300, 400, 0)
  );
  const chipped = await stepUntil(page, `s.__debug.hits() > ${hitsBefore}`, 120);
  expect(chipped.done).toBe(true);
  expect(await score(page)).toBe(0); // the chip must NOT score

  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 170, 300, 400, 0)
  );
  const scored = await stepUntil(page, 's.__debug.score() > 0', 120);
  expect(scored.done).toBe(true);
  expect(await score(page)).toBeGreaterThan(0);
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
    const g = (window as any).__game;
    g.loop.sleep();
    const w = window as any;
    if (w.__stepTime === undefined) w.__stepTime = g.loop.time;
    const s = g.scene.keys['Sandbox'];
    const r = s.rockets.fire('rocket-p1', 170, 300, 400, 0);
    r.setData('charged', true);
    for (let n = 0; n < 60; n++) {
      const hs = r.getData('hitSet');
      if (hs && hs.size > 0) return { hit: true, active: r.active };
      w.__stepTime += 16;
      g.scene.update(w.__stepTime, 16);
    }
    const hs = r.getData('hitSet');
    return { hit: !!(hs && hs.size > 0), active: r.active };
  })) as { hit: boolean; active: boolean };
  await shot(page, 'smoke-pierce.png');
  expect(pierce.hit).toBe(true);
  expect(pierce.active).toBe(true);
});

test('a rocket-killed tough rock splits', async ({ page }) => {
  await gotoGame(page);

  // A tough rock (2+ hits) killed by a rocket scatters 2 small 1-hit fragments
  // that score 10 each (their own 1-hit pops). Wave 1 fields only 1-hit rocks, so
  // field a 2-hit rock directly through the public reconfigure()/spawn() path
  // (exactly what startWave does) and kill it on the fixed-timestep clock. Lane
  // wrappers are asteroids[0..3]; the B30 fragment pool is the tail.
  const splitBefore = await splitCount(page);
  const hitsBefore = await hits(page);
  await fieldRock(page, { x: 260, y: 300, hits: 2 });

  // Kill it: 2 head-on rockets (first chips 2->1, second pops 1->0 and splits),
  // stepping each into the stationary rock.
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 180, 300, 400, 0)
  );
  const chip = await stepUntil(page, `s.__debug.hits() > ${hitsBefore}`, 120);
  expect(chip.done).toBe(true);
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 180, 300, 400, 0)
  );
  const split = await stepUntil(page, `s.__debug.splitCount() > ${splitBefore}`, 120);
  expect(split.done).toBe(true); // the final pop split: splitCount rose

  const fragsAlive = await fragmentsAlive(page);
  const scoreAfterKill = await score(page);
  await shot(page, 'smoke-split.png');
  expect(fragsAlive).toBeGreaterThanOrEqual(2); // >=2 fragments went live

  // Pop the scattered fragments: in ONE in-browser loop, re-aim a rocket at each
  // live fragment (every few frames) and step until the score climbs by the two
  // 1-hit pops (>=20). Fragments are 1-hit, so each connect pops + scores 10.
  const scoreDelta = (await page.evaluate((scoreAfterKill) => {
    const g = (window as any).__game;
    g.loop.sleep();
    const w = window as any;
    if (w.__stepTime === undefined) w.__stepTime = g.loop.time;
    const s = g.scene.keys['Sandbox'];
    let delta = 0;
    for (let n = 0; n < 400 && delta < 20; n++) {
      if (n % 3 === 0) {
        s.asteroids.forEach((a: any) => {
          if (a.isFragment && a.active && !a.popping) {
            const t = a.sprite;
            s.rockets.fire('rocket-p1', t.x + 40, t.y, -500, 0); // chase + intercept
          }
        });
      }
      w.__stepTime += 16;
      g.scene.update(w.__stepTime, 16);
      delta = s.__debug.score() - scoreAfterKill;
    }
    return delta;
  }, scoreAfterKill)) as number;
  expect(scoreDelta).toBeGreaterThanOrEqual(20);
});

test('boss gate + cycle', async ({ page }) => {
  await gotoGame(page);

  // Deterministic boss cycle on the fixed-timestep clock. Skip straight to the
  // boss, snap past the (wall-clock) entrance tween, then drive the gate by
  // stepping: while CHARGING (escorts up) the boss is invulnerable — a hit must
  // NOT drop its HP. Clear all 4 escorts -> EXPOSED window -> a hit DOES drop its
  // HP -> the window ends -> re-shield to CHARGING with all 4 escorts respawned.
  await startBoss(page);
  await page.evaluate(`${SCENE}.__debug.snapBossIn()`); // finish the entrance tween instantly
  await stepGame(page, 16, 1); // one frame so the encounter observes the entered boss
  const hpStart = await bossHp(page);
  await shot(page, 'smoke-boss-charging.png');
  expect(await bossPhase(page)).toBe('charging');

  // Invulnerable while charging: a rocket fully crosses the boss center (~40
  // frames from x=60 at 350px/s past the boss at x=180) yet HP stays put.
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0)
  );
  await stepGame(page, 16, 40);
  expect(await bossHp(page)).toBe(hpStart);

  // Pop all 4 escorts -> EXPOSED window (one frame to observe the open gate).
  for (let i = 0; i < 4; i++) await killEscort(page, i);
  await stepGame(page, 16, 1);
  expect(await bossPhase(page)).toBe('exposed');
  await shot(page, 'smoke-boss-exposed.png');

  // Exposed: a rocket through the boss center now drops its HP (bounded steps).
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0)
  );
  const dropped = await stepUntil(page, `s.__debug.bossHp() < ${hpStart}`, 100);
  expect(dropped.done).toBe(true); // the shot reaches the boss near step ~16
  expect(await bossHp(page)).toBeLessThan(hpStart);

  // Cycle closes: after the exposed window (exposedMs 3000 / 16 ≈ 188 frames) it
  // re-shields back to charging and all 4 escorts respawn.
  const recharged = await stepUntil(page, "s.__debug.bossPhase() === 'charging'", 300);
  expect(recharged.done).toBe(true);
  expect(await escortsAlive(page)).toBe(4);
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
