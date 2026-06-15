// Throwaway smoke test: boot the game headless, capture console errors,
// simulate a P2 sling drag, screenshot before/after.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Resolve a chromium binary cross-platform: on Michael's Windows box browsers
// live under %LOCALAPPDATA%\ms-playwright (chrome.exe); on a Linux dev/CI box
// under ~/.cache/ms-playwright (chrome). Try Windows first (unchanged), then
// fall back to the Linux cache, then to playwright's own resolver.
function findExecutable() {
  const win = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright');
  if (win && existsSync(win)) {
    const dir = readdirSync(win).filter((d) => d.startsWith('chromium-')).sort().pop();
    // Playwright renamed the win folder chrome-win -> chrome-win64; try both.
    const found = ['chrome-win64', 'chrome-win']
      .map((sub) => join(win, dir, sub, 'chrome.exe'))
      .find(existsSync);
    if (found) return found;
  }
  const nix = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(nix)) {
    const dirs = readdirSync(nix).filter((d) => d.startsWith('chromium-')).sort().reverse();
    const found = dirs.map((d) => join(nix, d, 'chrome-linux64', 'chrome')).find(existsSync);
    if (found) return found;
  }
  return chromium.executablePath();
}
const exe = findExecutable();

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, hasTouch: true });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(process.env.SMOKE_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('#game canvas', { timeout: 15000 });
await page.waitForTimeout(1500); // let a few frames render
await page.screenshot({ path: 'smoke-boot.png' });

// Drag P2's sling: canvas fills 360x740 viewport 1:1 (FIT), so game coords == page coords.
// Press the P2 anchor (180,640), pull down-right to (230,700), hold for a frame.
const canvas = await page.$('#game canvas');
const box = await canvas.boundingBox();
const sx = box.width / 360, sy = box.height / 740;
const gx = (x) => box.x + x * sx, gy = (y) => box.y + y * sy;

await page.mouse.move(gx(180), gy(640));
await page.mouse.down();
await page.mouse.move(gx(230), gy(700), { steps: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'smoke-pull.png' });
await page.mouse.up(); // release -> fire
await page.waitForTimeout(350); // rocket mid-flight
await page.screenshot({ path: 'smoke-fired.png' });

await page.waitForTimeout(2000); // let asteroids drift on screen
await page.screenshot({ path: 'smoke-drift.png' });

// ---- deterministic hit test ----
// The difficulty solver decides toughness per wave, so there's no fixed
// 3-hit rock to aim at. Instead: pick the toughest ACTIVE asteroid that has
// entered the field, fire a head-on rocket, and assert the scene's
// cumulative hit counter ticks up. Toughness-agnostic and tuning-proof.
const hitsBefore = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.hits());
// Scoring seam (B6): the shared score starts at 0 and must climb once a pop lands.
const scoreBefore = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.score());
if (scoreBefore !== 0) throw new Error(`score test: expected 0 at boot, got ${scoreBefore}`);

// Wait for some asteroid to be on-screen and pick the toughest such one.
// Return {i} only when found — a bare index 0 is falsy and -1 is truthy, so
// neither survives waitForFunction's truthiness check on its own.
const ti = await page.waitForFunction(
  () => {
    const scene = window.__game.scene.keys['Sandbox'];
    let best = -1;
    let bestHits = -1;
    scene.asteroids.forEach((a, i) => {
      if (a.active && !a.popping && a.sprite.x <= 320 && a.spec.hits > bestHits) {
        bestHits = a.spec.hits;
        best = i;
      }
    });
    return best >= 0 ? { i: best } : false;
  },
  undefined,
  { timeout: 30000 }
).then((h) => h.jsonValue()).then((v) => v.i);

await page.evaluate((i) => {
  const scene = window.__game.scene.keys['Sandbox'];
  const t = scene.asteroids[i].sprite;
  scene.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
}, ti);
await page.waitForFunction(
  (n) => window.__game.scene.keys['Sandbox'].__debug.hits() > n,
  hitsBefore,
  { timeout: 5000 }
);
const hitsAfter = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.hits());
console.log(`hit test: hit counter ${hitsBefore} -> ${hitsAfter}`);
await page.screenshot({ path: 'smoke-hit.png' });

// ---- scoring test (B6) ----
// Only the final pop scores, so a single hit on a multi-hit rock leaves the
// score at 0. Pick an active rock and fire spec.hits head-on rockets at it
// (spaced so each lands separately); the pop must drive the shared score > 0.
const si = await page.waitForFunction(
  () => {
    const scene = window.__game.scene.keys['Sandbox'];
    const i = scene.asteroids.findIndex((a) => a.active && !a.popping && a.sprite.x <= 320);
    return i >= 0 ? { i } : false;
  },
  undefined,
  { timeout: 30000 }
).then((h) => h.jsonValue()).then((v) => v.i);
const hp = await page.evaluate((i) => window.__game.scene.keys['Sandbox'].asteroids[i].spec.hits, si);
for (let k = 0; k < hp; k++) {
  await page.evaluate((i) => {
    const scene = window.__game.scene.keys['Sandbox'];
    const t = scene.asteroids[i].sprite;
    scene.rockets.fire('rocket-p1', t.x - 80, t.y, 400, 0);
  }, si);
  await page.waitForTimeout(250); // let the rocket reach the rock before the next
}
await page.waitForFunction(
  () => window.__game.scene.keys['Sandbox'].__debug.score() > 0,
  undefined,
  { timeout: 5000 }
);
const scoreAfter = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.score());
console.log(`score test: score ${scoreBefore} -> ${scoreAfter} (a ${hp}-hit pop is worth ${hp * 10}) => ${scoreAfter > 0 ? 'OK' : 'FAIL'}`);

// ---- homing test (B14) ----
// Enable P1 homing, lock an active rock, and fire an OFF-AXIS rocket whose
// straight path clears the rock by ~22px (> its radius, so a non-homing shot
// misses). The gentle-assist turn-rate gets a long runway here so the test
// stays green across reasonable HOMING.turnRateDeg tunes; if the hit counter
// ticks, the shot curved in. (Homing is off by default, so the straight test
// above is unaffected.)
const homingBefore = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.hits());
const hti = await page.waitForFunction(
  () => {
    const scene = window.__game.scene.keys['Sandbox'];
    const i = scene.asteroids.findIndex((a) => a.active && !a.popping && a.sprite.x <= 340 && a.sprite.x >= 270);
    return i >= 0 ? { i } : false;
  },
  undefined,
  { timeout: 30000 }
).then((h) => h.jsonValue()).then((v) => v.i);

await page.evaluate((i) => {
  const scene = window.__game.scene.keys['Sandbox'];
  scene.__debug.setHoming(1, true);
  const t = scene.asteroids[i].sprite;
  // Slow shot from far back with a small (~15px > radius) offset: a straight
  // shot misses below, but there's ample runway past the (now longer) arming
  // run for the ramped curve to climb in.
  const r = scene.rockets.fire('rocket-p1', t.x - 250, t.y + 15, 150, 0);
  r.setData('homing', true);
  r.setData('target', scene.asteroids[i]);
  r.setData('speed', 150);
  r.setData('dist', 0);
}, hti);
await page.waitForFunction(
  (n) => window.__game.scene.keys['Sandbox'].__debug.hits() > n,
  homingBefore,
  { timeout: 8000 }
);
const homingAfter = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.hits());
console.log(`homing test: hit counter ${homingBefore} -> ${homingAfter}`);
await page.screenshot({ path: 'smoke-homing.png' });

// ---- final boss test (B5, cycling fight) ----
// Skip straight to the boss and confirm the gate: while CHARGING (escorts up)
// the boss is invulnerable — a hit must NOT drop its HP. Clear all 4 escorts ->
// EXPOSED window -> a hit DOES drop its HP.
await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.startBoss());
await page.waitForTimeout(2200); // let the (slower) boss slide in and park
const phase1 = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossPhase());
const hpStart = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossHp());
await page.screenshot({ path: 'smoke-boss-charging.png' });

// Invulnerable while charging: a rocket through the boss center leaves HP alone.
await page.evaluate(() => window.__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0));
await page.waitForTimeout(400);
const hpAfterInvuln = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossHp());

// Pop all 4 escorts -> EXPOSED window.
await page.evaluate(() => {
  const d = window.__game.scene.keys['Sandbox'].__debug;
  for (let i = 0; i < 4; i++) d.killEscort(i);
});
await page.waitForFunction(
  () => window.__game.scene.keys['Sandbox'].__debug.bossPhase() === 'exposed',
  undefined,
  { timeout: 3000 }
);
const phase2 = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossPhase());
await page.screenshot({ path: 'smoke-boss-exposed.png' });

// Exposed: a rocket through the boss center now drops its HP.
await page.evaluate(() => window.__game.scene.keys['Sandbox'].rockets.fire('rocket-p1', 60, 370, 350, 0));
await page.waitForFunction(
  (n) => window.__game.scene.keys['Sandbox'].__debug.bossHp() < n,
  hpStart,
  { timeout: 5000 }
);
const hpAfterVuln = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossHp());
const bossOk = phase1 === 'charging' && hpAfterInvuln === hpStart && phase2 === 'exposed' && hpAfterVuln < hpStart;
console.log(
  `boss test: phase1=${phase1} hp ${hpStart}->${hpAfterInvuln} (charging/invuln); phase2=${phase2} hp->${hpAfterVuln} (exposed) => ${bossOk ? 'OK' : 'FAIL'}`
);

// Cycle closes: after the exposed window ends, it re-shields back to charging
// and all 4 escorts respawn.
await page.waitForFunction(
  () => window.__game.scene.keys['Sandbox'].__debug.bossPhase() === 'charging',
  undefined,
  { timeout: 6000 }
);
const escortsBack = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.escortsAlive());
console.log(`boss cycle: re-charged with ${escortsBack}/4 escorts respawned => ${escortsBack === 4 ? 'OK' : 'FAIL'}`);

// ---- ?boss shortcut test (B5 testing aid) ----
// A fresh load with ?boss must boot straight into the boss fight (phase
// 'escorts'), skipping the waves.
const bossUrl = (process.env.SMOKE_URL ?? 'http://localhost:5173') + '?boss';
await page.goto(bossUrl, { waitUntil: 'networkidle' });
await page.waitForSelector('#game canvas', { timeout: 15000 });
await page.waitForFunction(
  () => window.__game?.scene.keys['Sandbox']?.__debug?.bossPhase?.() === 'charging',
  undefined,
  { timeout: 10000 }
);
const skipPhase = await page.evaluate(() => window.__game.scene.keys['Sandbox'].__debug.bossPhase());
console.log(`?boss shortcut: boots into phase '${skipPhase}' => ${skipPhase === 'charging' ? 'OK' : 'FAIL'}`);

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
