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
 * left open — its semantic checks printed FAIL but still exited 0). The
 * smoke-*.png screenshots are preserved purely as eyeball aids.
 *
 * Headless caveat (load-bearing): software-WebGL ReadPixels stalls clamp
 * Phaser's per-frame delta, so headless game-time runs ~10× slower than
 * wall-clock. A Sonnet review confirmed this is a rendering artifact, not a
 * game bug. It's why the split case fields a 2-hit rock directly through the
 * public reconfigure()/spawn() path rather than waiting out the breather timer.
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
  await page.waitForTimeout(1_000); // let a few frames render
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
  await page.screenshot({ path: 'smoke-boot.png' });
  // Scoring seam (B6): the shared score starts at 0 and must climb once a pop
  // lands. (The one check the old smoke already threw on.)
  expect(await score(page)).toBe(0);
});

test('head-on rocket ticks the hit counter', async ({ page }) => {
  await gotoGame(page);

  // The difficulty solver decides toughness per wave, so there's no fixed
  // 3-hit rock to aim at. Instead: pick the toughest ACTIVE asteroid that has
  // entered the field, fire a head-on rocket, and assert the cumulative hit
  // counter ticks up. Toughness-agnostic and tuning-proof.
  const hitsBefore = await hits(page);

  // Wait for some asteroid on-screen and pick the toughest such one. Return
  // {i} only when found — a bare index 0 is falsy and -1 is truthy, so neither
  // survives waitForFunction's truthiness check on its own.
  const ti = (await page
    .waitForFunction(
      () => {
        const s = (window as any).__game.scene.keys['Sandbox'];
        let best = -1;
        let bestHits = -1;
        s.asteroids.forEach((a: any, i: number) => {
          // !isFragment: never let a fast split fragment (B30) be the target.
          if (a.active && !a.popping && !a.isFragment && a.sprite.x <= 320 && a.spec.hits > bestHits) {
            bestHits = a.spec.hits;
            best = i;
          }
        });
        return best >= 0 ? { i: best } : false;
      },
      undefined,
      { timeout: 30_000 }
    )
    .then((h) => h.jsonValue())) as { i: number };

  await page.evaluate((i) => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const t = s.asteroids[i].sprite;
    s.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
  }, ti.i);

  await page.waitForFunction(
    (n) => (window as any).__game.scene.keys['Sandbox'].__debug.hits() > n,
    hitsBefore,
    { timeout: 5_000 }
  );
  const hitsAfter = await hits(page);
  await page.screenshot({ path: 'smoke-hit.png' });
  expect(hitsAfter).toBeGreaterThan(hitsBefore);
});

test('a full pop scores', async ({ page }) => {
  await gotoGame(page);

  // Only the final pop scores, so a single hit on a multi-hit rock leaves the
  // score at 0. Pick an active rock and fire spec.hits head-on rockets at it
  // (spaced so each lands separately); the pop must drive the score > 0.
  const si = (await page
    .waitForFunction(
      () => {
        const s = (window as any).__game.scene.keys['Sandbox'];
        const i = s.asteroids.findIndex(
          (a: any) => a.active && !a.popping && !a.isFragment && a.sprite.x <= 320
        );
        return i >= 0 ? { i } : false;
      },
      undefined,
      { timeout: 30_000 }
    )
    .then((h) => h.jsonValue())) as { i: number };

  const hp = (await page.evaluate(
    (i) => (window as any).__game.scene.keys['Sandbox'].asteroids[i].spec.hits,
    si.i
  )) as number;

  for (let k = 0; k < hp; k++) {
    await page.evaluate((i) => {
      const s = (window as any).__game.scene.keys['Sandbox'];
      const t = s.asteroids[i].sprite;
      s.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
    }, si.i);
    await page.waitForTimeout(250); // let the rocket reach the rock before the next
  }

  await page.waitForFunction(
    () => (window as any).__game.scene.keys['Sandbox'].__debug.score() > 0,
    undefined,
    { timeout: 5_000 }
  );
  expect(await score(page)).toBeGreaterThan(0);
});

test('off-axis homing shot curves in', async ({ page }) => {
  await gotoGame(page);

  // Enable P1 homing, lock an active rock, and fire an OFF-AXIS rocket whose
  // straight path clears the rock by ~15px (> its radius, so a non-homing shot
  // misses). The gentle-assist turn-rate gets a long runway here, so the test
  // stays green across reasonable HOMING.turnRateDeg tunes; if the hit counter
  // ticks, the shot curved in. (Homing is off by default, so the straight
  // tests above are unaffected.)
  const homingBefore = await hits(page);
  const hti = (await page
    .waitForFunction(
      () => {
        const s = (window as any).__game.scene.keys['Sandbox'];
        const i = s.asteroids.findIndex(
          (a: any) =>
            a.active && !a.popping && !a.isFragment && a.sprite.x <= 340 && a.sprite.x >= 270
        );
        return i >= 0 ? { i } : false;
      },
      undefined,
      { timeout: 30_000 }
    )
    .then((h) => h.jsonValue())) as { i: number };

  await page.evaluate((i) => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    s.__debug.setHoming(1, true);
    const t = s.asteroids[i].sprite;
    // Slow shot from far back with a small (~15px > radius) offset: a straight
    // shot misses below, but there's ample runway past the (now longer) arming
    // run for the ramped curve to climb in.
    const r = s.rockets.fire('rocket-p1', t.x - 250, t.y + 15, 150, 0);
    r.setData('homing', true);
    r.setData('target', s.asteroids[i]);
    r.setData('speed', 150);
    r.setData('dist', 0);
  }, hti.i);

  await page.waitForFunction(
    (n) => (window as any).__game.scene.keys['Sandbox'].__debug.hits() > n,
    homingBefore,
    { timeout: 8_000 }
  );
  await page.screenshot({ path: 'smoke-homing.png' });
  expect(await hits(page)).toBeGreaterThan(homingBefore);
});

test('charged shot rails through', async ({ page }) => {
  await gotoGame(page);

  // A charged shot is a RAILGUN: it pierces every asteroid in its path instead
  // of recycling on first contact. Pick an active on-screen rock, fire a
  // charged rocket head-on, then assert the SAME rocket sprite is STILL active
  // at the moment it chips a rock — proving it railed through rather than
  // recycled. (A normal shot would have been killAndHide'd by handleHit on that
  // first hit.) The chip is read off the rocket's own per-pass hitSet, so
  // `active` is sampled in the SAME evaluation as the hit — no round-trip race
  // against world-bounds.
  const pgi = (await page
    .waitForFunction(
      () => {
        const s = (window as any).__game.scene.keys['Sandbox'];
        const i = s.asteroids.findIndex(
          (a: any) =>
            a.active && !a.popping && !a.isFragment && a.sprite.x <= 280 && a.sprite.x >= 120
        );
        return i >= 0 ? { i } : false;
      },
      undefined,
      { timeout: 30_000 }
    )
    .then((h) => h.jsonValue())) as { i: number };

  await page.evaluate((i) => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const t = s.asteroids[i].sprite;
    const r = s.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
    r.setData('charged', true);
    (window as any).__pierceRocket = r; // stash so we can watch it chip + survive
  }, pgi.i);

  const pierceActive = (await page
    .waitForFunction(
      () => {
        const r = (window as any).__pierceRocket;
        const hs = r && r.getData('hitSet');
        return hs && hs.size > 0 ? { active: r.active } : false;
      },
      undefined,
      { timeout: 5_000 }
    )
    .then((h) => h.jsonValue())) as { active: boolean };
  await page.screenshot({ path: 'smoke-pierce.png' });
  expect(pierceActive.active).toBe(true);
});

test('a rocket-killed tough rock splits', async ({ page }) => {
  await gotoGame(page);

  // A tough rock (2+ hits) killed by a rocket scatters 2 small 1-hit fragments
  // that score 10 each (their own 1-hit pops). Wave 1 fields only 1-hit rocks,
  // and headless game-time runs ~10× slower than wall-clock (software-WebGL
  // ReadPixels stalls clamp Phaser's per-frame delta), so advancing to a wave
  // with 2-hit rocks via the breather timer is impractical here. Instead field
  // a 2-hit rock directly through the public reconfigure()/spawn() path
  // (exactly what startWave does for lane rocks) and place it in-field for a
  // deterministic kill. Lane wrappers are asteroids[0..3]; the B30 fragment
  // pool is the tail.
  const splitBefore = (await page.evaluate(() => {
    const s = (window as any).__game.scene.keys['Sandbox'];
    const a = s.asteroids[0]; // a lane wrapper (NOT a fragment)
    a.reconfigure({ radius: 17, hits: 2, y: 300, speed: 30 }, 0);
    a.spawn(); // field it (off the right edge)...
    // ...then teleport into the field for a fast, deterministic kill.
    a.sprite.setPosition(260, 300);
    a.sprite.body.reset(260, 300);
    a.sprite.body.setVelocityX(-30);
    return s.__debug.splitCount();
  })) as number;

  // Kill it: 2 head-on rockets (first chips 2->1, second pops 1->0 and splits).
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => {
      const s = (window as any).__game.scene.keys['Sandbox'];
      const t = s.asteroids[0].sprite;
      s.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
    });
    await page.waitForTimeout(300);
  }

  // The final pop must split: splitCount rises and >=2 fragments go live.
  await page.waitForFunction(
    (prev) => (window as any).__game.scene.keys['Sandbox'].__debug.splitCount() > prev,
    splitBefore,
    { timeout: 8_000 }
  );
  const fragsAlive = await fragmentsAlive(page);
  const scoreAfterKill = await score(page);
  await page.screenshot({ path: 'smoke-split.png' });

  expect(await splitCount(page)).toBeGreaterThan(splitBefore);
  expect(fragsAlive).toBeGreaterThanOrEqual(2);

  // Pop the scattered fragments: re-aim a rocket at each active fragment every
  // frame-ish until the score climbs by the two 1-hit pops (>=20). Fragments
  // are 1-hit, so each connect pops + scores 10.
  let scoreDelta = 0;
  for (let attempt = 0; attempt < 40 && scoreDelta < 20; attempt++) {
    await page.evaluate(() => {
      const s = (window as any).__game.scene.keys['Sandbox'];
      s.asteroids.forEach((a: any) => {
        if (a.isFragment && a.active && !a.popping) {
          const t = a.sprite;
          s.rockets.fire('rocket-p1', t.x + 40, t.y, -500, 0); // chase + intercept
        }
      });
    });
    await page.waitForTimeout(150);
    scoreDelta = (await score(page)) - scoreAfterKill;
  }
  expect(scoreDelta).toBeGreaterThanOrEqual(20);
});

test('boss gate + cycle', async ({ page }) => {
  await gotoGame(page);

  // Skip straight to the boss and confirm the gate: while CHARGING (escorts up)
  // the boss is invulnerable — a hit must NOT drop its HP. Clear all 4 escorts
  // -> EXPOSED window -> a hit DOES drop its HP.
  await startBoss(page);
  await page.waitForTimeout(2_200); // let the (slower) boss slide in and park
  const phase1 = await bossPhase(page);
  const hpStart = await bossHp(page);
  await page.screenshot({ path: 'smoke-boss-charging.png' });
  expect(phase1).toBe('charging');

  // Invulnerable while charging: a rocket through the boss center leaves HP alone.
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0)
  );
  await page.waitForTimeout(400);
  expect(await bossHp(page)).toBe(hpStart);

  // Pop all 4 escorts -> EXPOSED window.
  for (let i = 0; i < 4; i++) await killEscort(page, i);
  await page.waitForFunction(
    () => (window as any).__game.scene.keys['Sandbox'].__debug.bossPhase() === 'exposed',
    undefined,
    { timeout: 3_000 }
  );
  expect(await bossPhase(page)).toBe('exposed');
  await page.screenshot({ path: 'smoke-boss-exposed.png' });

  // Exposed: a rocket through the boss center now drops its HP.
  await page.evaluate(() =>
    (window as any).__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0)
  );
  await page.waitForFunction(
    (n) => (window as any).__game.scene.keys['Sandbox'].__debug.bossHp() < n,
    hpStart,
    { timeout: 5_000 }
  );
  expect(await bossHp(page)).toBeLessThan(hpStart);

  // Cycle closes: after the exposed window ends, it re-shields back to charging
  // and all 4 escorts respawn.
  await page.waitForFunction(
    () => (window as any).__game.scene.keys['Sandbox'].__debug.bossPhase() === 'charging',
    undefined,
    { timeout: 6_000 }
  );
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
