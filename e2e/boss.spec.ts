/**
 * boss.spec.ts — the boss fight: co-op escort locks, shield-web gaps + regen, the web's drawn edge, ?boss.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, gotoGame, shot, stepGame, stepUntil, fire, escortsAlive, hitEscort, escortLocks, enterBoss, shieldLinks, healthBars, type Page } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bossPhase = (page: Page) => page.evaluate(`${SCENE}.__debug.bossPhase()`) as Promise<string>;
const bossHp = (page: Page) => page.evaluate(`${SCENE}.__debug.bossHp()`) as Promise<number>;

test('boss co-op locks, shield-web gaps + regen', async ({ page }) => {
  await gotoGame(page);

  // Deterministic B34 boss test: the complete diamond has four physical links.
  // Downing one two-player escort removes its two links for 6s, pauses charge,
  // and lets a charged shot reach the always-vulnerable command ship.
  await enterBoss(page);
  const hpStart = await bossHp(page);
  await shot(page, 'smoke-boss-charging.png');
  expect(await bossPhase(page)).toBe('charging');
  expect(await shieldLinks(page)).toBe(4);
  // A segment across the lower-left side intersects the intact web.
  expect(await page.evaluate(`${SCENE}.__debug.webBlocks(100, 400, 180, 400)`)).toBe(true);

  // Every ship needs BOTH colors. A P1 double-tap consumes both rockets but
  // leaves escort 0 awaiting amber; the reverse order clears escort 2, the
  // left-side node. That opens the incoming horizontal path from the launchers.
  await hitEscort(page, 0, 'p1');
  await hitEscort(page, 0, 'p1');
  expect(await escortsAlive(page)).toBe(4);
  expect((await escortLocks(page))[0]).toBe(1);
  await stepGame(page, 16, 1);
  expect(await healthBars(page)).toEqual([]); // locks and the web aren't hp (#23)
  await hitEscort(page, 2, 'p2');
  await hitEscort(page, 2, 'p1');
  await stepGame(page, 16, 1);
  expect(await escortsAlive(page)).toBe(3);
  expect(await shieldLinks(page)).toBe(2);
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
  expect(await shieldLinks(page)).toBe(4);
  const shieldBefore = await page.evaluate(`${SCENE}.__debug.stationShield()`);
  const fired = await stepUntil(page, `s.__debug.stationShield() < ${shieldBefore}`, 350);
  expect(fired.done).toBe(true);
});

test('boss shield web blocks rockets at the drawn edge', async ({ page }) => {
  await gotoGame(page);

  // A link stops a rocket exactly when the drawn rocket touches the drawn
  // stroke (#8): centre distance <= reach = the rocket's half-extent across the
  // link + web width / 2. The 8x14 rocket reaches 7 nose-on (long axis along
  // the link normal) but only 4 side-on (long axis along the link). Each group
  // fields real rockets on BOTH sides of all four links, rotated nose-on or
  // side-on to that link, and runs ONE real frame; the scene's own global web
  // check (recycleWhere -> BossEncounter.blocksRocket -> ShieldWeb.blocks) must
  // spend exactly the probes marked blocked:
  //  - clear / touch: stationary nose-on, 0.5 outside / inside reach. Both
  //    sides of every diagonal link means some probe sits where a mis-anchored
  //    sweep would point into the link.
  //  - side-clear / side-touch: the same, side-on.
  //  - cross: nose-on, starts 5 outside reach and flies straight through the
  //    link in one 16ms step (30 units), ending outside reach on the far side,
  //    so only a sweep over this frame's motion can catch it.
  //  - graze: side-on, flies 20 units parallel to the link 0.5 outside reach;
  //    the sweep must not widen the reach.
  // Links are re-read before each group's frame; one frame turns the web ~0.3
  // deg, moving a probe's distance to its link by <= ~0.11 (graze, 10 units
  // off-midpoint): under the 0.5 margins.
  await enterBoss(page);
  expect(await bossPhase(page)).toBe('charging');

  const probe = await page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const activeBefore = s.rockets.group.countActive(true);
    const wrong: string[] = [];
    let linkCount = 0;
    // off: centre offset beyond reach; along: offset along the link; vn: speed
    // toward the link, vt: speed along it (px/s).
    const groups = [
      { label: 'clear', facing: 'nose', blocked: false, off: 0.5, along: 0, vn: 0, vt: 0 },
      { label: 'touch', facing: 'nose', blocked: true, off: -0.5, along: 0, vn: 0, vt: 0 },
      { label: 'side-clear', facing: 'side', blocked: false, off: 0.5, along: 0, vn: 0, vt: 0 },
      { label: 'side-touch', facing: 'side', blocked: true, off: -0.5, along: 0, vn: 0, vt: 0 },
      { label: 'cross', facing: 'nose', blocked: true, off: 5, along: 0, vn: 1875, vt: 0 },
      { label: 'graze', facing: 'side', blocked: false, off: 0.5, along: -10, vn: 0, vt: 1250 },
    ];
    for (const g of groups) {
      // Re-read every group: each group's frame turns the web a little more.
      const { width, links } = s.__debug.webLinks();
      linkCount = links.length;
      const probes: { name: string; r: any }[] = [];
      for (const [i, l] of links.entries()) {
        const len = Math.hypot(l.bx - l.ax, l.by - l.ay);
        const tx = (l.bx - l.ax) / len, ty = (l.by - l.ay) / len;
        const nx = -ty, ny = tx;
        const mx = (l.ax + l.bx) / 2, my = (l.ay + l.by) / 2;
        for (const side of [1, -1]) {
          const r = s.rockets.fire('rocket-p1', mx, my, 0, 0);
          // The texture's long axis is local +y, which a rotation θ points
          // along (-sin θ, cos θ): aim it along the normal (nose) or link (side).
          const [ax, ay] = g.facing === 'nose' ? [nx, ny] : [tx, ty];
          r.setRotation(Math.atan2(-ax, ay));
          const half = (g.facing === 'nose' ? r.displayHeight : r.displayWidth) / 2;
          const d = half + width / 2 + g.off;
          r.body.reset(mx + side * nx * d + tx * g.along, my + side * ny * d + ty * g.along);
          r.body.setVelocity(-side * nx * g.vn + tx * g.vt, -side * ny * g.vn + ty * g.vt);
          probes.push({ name: `link ${i} side ${side > 0 ? '+' : '-'} ${g.label}`, r });
        }
      }
      w.__step(1, 16);
      for (const { name, r } of probes) {
        const blocked = !r.active;
        if (blocked !== g.blocked) wrong.push(`${name}: blocked=${blocked}`);
        if (r.active) s.rockets.recycle(r);
      }
    }
    return { links: linkCount, wrong, activeBefore, activeAfter: s.rockets.group.countActive(true) };
  });
  expect(probe.links).toBe(4);
  expect(probe.wrong).toEqual([]);
  expect(probe.activeAfter).toBe(probe.activeBefore); // probes never leak into later play
});

test('?boss shortcut boots into the fight', async ({ page }) => {
  // A fresh load with ?boss must boot straight into the boss fight (phase
  // 'charging'), skipping waves 1-5: the command ship is wave 6.
  await gotoGame(page, '?boss');
  await page.waitForFunction(
    () => (window as any).__game?.scene.keys['Sandbox']?.__debug?.bossPhase?.() === 'charging',
    undefined,
    { timeout: 10_000 }
  );
  expect(await bossPhase(page)).toBe('charging');
  expect(await page.evaluate(`${SCENE}.__debug.wave()`)).toBe(6);
});
