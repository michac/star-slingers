/**
 * ships.spec.ts — act 2's ship waves (#27): waves 4–5 field enemy ships, not
 * rocks; a ship's entry, roam bounds and shot warning; its bolt hitting the
 * fleet (shield, then ship), re-targeting after a loss, a bolt whose ship was
 * lost passing harmlessly, and bolts being unshootable; the wave-5 bubble rule
 * (plain/missile pop it, charged and the detonator's blast kill); missiles and
 * the triple taking ships; the wave's quota flow, the fail card and Try again; solo's slower
 * shot cycle (#6).
 * The boss beam's crosshair and the command-ship drop are in boss.spec.ts.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, debug, gotoGame, stepGame, stepUntil, fire, fleetStates, loseShips, score, failVisible, clearField, tryAgain, countShots, fired, touchscreen, v2Layout, DUO, SOLO_BOTTOM, type Page } from './helpers';
import { BOMB, ENEMY_SHIP, GAME_WIDTH, MISSILE, SCORE, SLING, sublaneCenterY } from '../src/layout';
import { RUN, SOLO } from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Ship = { phase: string; x: number; y: number; shielded: boolean; warning: boolean; target: number };
type Bolt = { x: number; y: number; target: number };
const ships = (page: Page) => debug<Ship[]>(page, 'ships()');
const bolts = (page: Page) => debug<Bolt[]>(page, 'bolts()');
const inPlay = (list: Ship[]) => list.filter((s) => s.phase === 'gliding' || s.phase === 'holding');
const W4 = RUN[3].ships!;
const W5 = RUN[4].ships!;
/** A ship's glide: its move less the hold (solo: the move is fireEveryMs ÷ pace). */
const glideMs = (w: typeof W4, pace = 1) => w.fireEveryMs / pace - ENEMY_SHIP.holdMs;

/** An empty field to place ships on: wave 1 with its rocks taken off (they
 *  don't come back: a vanished rock is parked, not respawned). */
async function emptyField(page: Page): Promise<void> {
  await gotoGame(page);
  await clearField(page);
  await stepGame(page, 16, 1);
}

/** Place pool ship i, held still (it fires only through shipFire). */
const placeShip = (page: Page, i: number, x: number, y: number, shielded = false) =>
  debug(page, `fieldShip(${i}, ${x}, ${y}, ${shielded})`);

test('waves 4 and 5 field enemy ships, not rocks; about half of wave 5 wears a bubble', async ({ page }) => {
  await gotoGame(page, '?wave=4');
  expect(await debug(page, 'waveKind()')).toBe('ship');
  expect(await debug(page, 'state()')).toBe('live');
  expect(await page.evaluate(`${SCENE}.asteroids.some((a) => a.isActive)`)).toBe(false);
  let field = inPlay(await ships(page));
  expect(field).toHaveLength(W4.onScreen);
  expect(field.every((s) => !s.shielded)).toBe(true);
  // They enter from just off the right edge.
  expect(field.every((s) => s.x > GAME_WIDTH)).toBe(true);

  await debug(page, 'jumpToWave(5)');
  field = inPlay(await ships(page));
  expect(field).toHaveLength(W5.onScreen);
  expect(field.map((s) => s.shielded)).toEqual([false, true, false]); // every 2nd ship fielded
  expect(await page.evaluate(`${SCENE}.asteroids.some((a) => a.isActive)`)).toBe(false);
});

test('unattended, wave 4 roams inside its bounds, warns before each shot, and the fleet lasts 30 s', async ({ page }) => {
  await gotoGame(page, '?wave=4');
  // 30 s of stepped play with nobody shooting, in one evaluate. Every frame:
  // each ship on screen stays inside the roam box; every shot comes after at
  // least telegraphMs of warning from a ship that was holding still; the
  // fleet keeps a ship.
  const r = await page.evaluate(
    ({ roam, frames }) => {
      const w = window as any;
      const s = w.__game.scene.keys['Sandbox'];
      const sq = s.squadron;
      const shots: { ms: number; warnedMs: number }[] = [];
      const warnMs = sq.ships.map(() => 0);
      const fire = sq.fire.bind(sq);
      let ms = 0;
      sq.fire = (x: number, y: number, i: number) => {
        // The shooter: the ship whose nose (r from its centre) is at (x, y).
        const k = sq.ships.findIndex((sh: any) => Math.hypot(sh.sprite.x - x, sh.sprite.y - y) <= sh.radius + 0.5);
        shots.push({ ms, warnedMs: warnMs[k] ?? -1 });
        fire(x, y, i);
      };
      // A ship is checked once its entry glide has brought it inside the box.
      const inside = sq.ships.map(() => false);
      let outside = 0;
      let checked = 0;
      for (let n = 0; n < frames; n++) {
        w.__step();
        ms += 16;
        sq.ships.forEach((sh: any, k: number) => {
          warnMs[k] = sh.warning ? warnMs[k] + 16 : sh.phase === 'holding' ? warnMs[k] : 0;
          if (!sh.isActive) return void (inside[k] = false);
          const { x, y } = sh.sprite;
          if (!inside[k] && x <= roam.maxX) inside[k] = true;
          if (!inside[k]) return;
          checked++;
          if (x < roam.minX - 0.01 || x > roam.maxX + 0.01 || y < roam.minY - 0.01 || y > roam.maxY + 0.01) outside++;
        });
      }
      return { shots, outside, checked, fail: s.failOverlay.visible, fleet: s.__debug.fleet() };
    },
    { roam: ENEMY_SHIP.roam, frames: Math.round(30_000 / 16) }
  );
  expect(r.checked).toBeGreaterThan(0);
  expect(r.outside).toBe(0);
  expect(r.fail).toBe(false);
  expect(r.fleet.some((st: string) => st !== 'lost')).toBe(true);
  expect(r.shots.length).toBeGreaterThan(0);
  // The first shot comes only after the entry glide and a full warning (the
  // wave started on gotoGame's boot step, one frame before this clock).
  expect(r.shots[0].ms).toBeGreaterThanOrEqual(glideMs(W4) + ENEMY_SHIP.telegraphMs - 16);
  for (const shot of r.shots) expect(shot.warnedMs).toBeGreaterThanOrEqual(ENEMY_SHIP.telegraphMs);
});

test('a bolt takes about 4 s to cross, pops its ship’s shield, then a second loses the ship; neither scores', async ({ page }) => {
  await emptyField(page);
  const y = sublaneCenterY(1);
  await placeShip(page, 0, ENEMY_SHIP.roam.maxX, y);
  await debug(page, 'shipFire(0)');
  const [bolt] = await bolts(page);
  expect(bolt.target).toBe(1); // the nearest live fleet ship
  expect(bolt.x).toBeCloseTo(ENEMY_SHIP.roam.maxX - ENEMY_SHIP.radius, 0); // from its nose
  const hit = await stepUntil(page, `s.__debug.fleet()[1] !== 'shielded'`, 400);
  expect(hit.done).toBe(true);
  expect(hit.steps * 16).toBeGreaterThan(4000 * 0.8);
  expect(hit.steps * 16).toBeLessThan(4000 * 1.2);
  expect(await fleetStates(page)).toEqual(['shielded', 'exposed', 'shielded', 'shielded']);
  expect(await bolts(page)).toEqual([]);

  await debug(page, 'shipFire(0)');
  expect((await stepUntil(page, `s.__debug.fleet()[1] === 'lost'`, 400)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['shielded', 'lost', 'shielded', 'shielded']);
  expect(await score(page)).toBe(0);
  expect(await failVisible(page)).toBe(false);
});

test('nothing can shoot a bolt down: a rocket flies through it', async ({ page }) => {
  await emptyField(page);
  await placeShip(page, 0, 300, sublaneCenterY(1));
  await debug(page, 'shipFire(0)');
  await stepGame(page, 16, 30);
  const [bolt] = await bolts(page);
  // A rocket fired straight up through the bolt's position.
  await fire(page, bolt.x, bolt.y + 60, 0, -SLING.maxSpeed);
  await stepGame(page, 16, 10);
  expect(await bolts(page)).toHaveLength(1);
  // The rocket wasn't spent on it: it's still flying, above the bolt now.
  const rocketY = (await page.evaluate(`${SCENE}.rockets.group.getChildren().filter((r) => r.active).map((r) => r.y)`)) as number[];
  expect(rocketY).toHaveLength(1);
  expect(rocketY[0]).toBeLessThan(bolt.y);
});

test('a ship re-targets when the fleet ship it is warning at is lost', async ({ page }) => {
  await gotoGame(page, '?wave=4');
  expect((await stepUntil(page, 's.__debug.ships().some((sh) => sh.warning)', 800)).done).toBe(true);
  const field = await ships(page);
  const k = field.findIndex((sh) => sh.warning);
  const before = field[k].target;
  expect(before).toBeGreaterThanOrEqual(0);
  await loseShips(page, before);
  await stepGame(page, 16, 1);
  const after = (await ships(page))[k].target;
  expect(after).not.toBe(before);
  expect((await fleetStates(page))[after]).not.toBe('lost');
  // Its shot goes at the new target.
  expect((await stepUntil(page, `s.__debug.bolts().length > 0`, 100)).done).toBe(true);
  expect((await bolts(page)).map((b) => b.target)).toContain(after);
});

test('a bolt whose fleet ship was lost in flight passes harmlessly off the left edge', async ({ page }) => {
  await emptyField(page);
  await placeShip(page, 0, 300, sublaneCenterY(1));
  await debug(page, 'shipFire(0)');
  await stepGame(page, 16, 20);
  await loseShips(page, 1);
  expect((await stepUntil(page, 's.__debug.bolts().length === 0', 600)).done).toBe(true);
  // Nothing else was touched on its way through the fleet.
  expect(await fleetStates(page)).toEqual(['shielded', 'lost', 'shielded', 'shielded']);
});

test('the bubble: a plain round or a missile pops it, a charged round or a bomb’s blast kills the ship', async ({ page }) => {
  await emptyField(page);
  const at = { x: 180, y: 380 };
  const up = (opts = '{}') => fire(page, at.x, 600, 0, -SLING.maxSpeed, opts, 'p2');
  const ship0 = () => ships(page).then((l) => l[0]);

  // A plain round pops the bubble; the ship flies on, and nothing scores.
  await placeShip(page, 0, at.x, at.y, true);
  await up();
  expect((await stepUntil(page, `!s.__debug.ships()[0].shielded`, 60)).done).toBe(true);
  expect(await ship0()).toMatchObject({ phase: 'holding', shielded: false });
  expect(await score(page)).toBe(0);
  // The next plain round kills it, for the shielded ship's score.
  await stepGame(page, 16, 10);
  await up();
  expect((await stepUntil(page, `s.__debug.ships()[0].phase !== 'holding'`, 60)).done).toBe(true);
  expect(await score(page)).toBe(SCORE.shieldedShip);

  // A missile also only pops it.
  await placeShip(page, 0, at.x, at.y, true);
  await fire(page, at.x, 600, 0, -MISSILE.speed, `{ missile: true, target: ${SCENE}.squadron.ships[0] }`, 'p2');
  expect((await stepUntil(page, `!s.__debug.ships()[0].shielded`, 120)).done).toBe(true);
  expect((await ship0()).phase).toBe('holding');

  // A charged round pops it AND kills the ship, then carries on through the
  // unshielded ship behind it.
  await placeShip(page, 0, at.x, at.y, true);
  await placeShip(page, 1, at.x, at.y - 80);
  const before = await score(page);
  await up('{ charged: true }');
  expect((await stepUntil(page, `s.__debug.ships()[1].phase !== 'holding'`, 60)).done).toBe(true);
  expect((await ships(page)).slice(0, 2).map((s) => s.phase)).not.toContain('holding');
  expect(await score(page)).toBe(before + SCORE.shieldedShip + SCORE.ship);

  // A bomb touching a shielded ship blows up there, and its blast (2) kills it.
  await stepGame(page, 16, 20);
  await placeShip(page, 0, at.x, at.y, true);
  await up(`{ bomb: true }`);
  expect((await stepUntil(page, `s.__debug.ships()[0].phase !== 'holding'`, 60)).done).toBe(true);
  expect(await score(page)).toBe(before + 2 * SCORE.shieldedShip + SCORE.ship);
  expect(BOMB.blastRadius).toBeGreaterThan(ENEMY_SHIP.shield.r);
});

test('the bubble is the hit circle: a round crossing the ring outside the hull still pops it', async ({ page }) => {
  await emptyField(page);
  const at = { x: 180, y: 380 };
  await placeShip(page, 0, at.x, at.y, true);
  // A slow round straight up, its body's near edge between the hull (12) and the ring.
  await fire(page, 0, 600, 0, -300, '{}', 'p2');
  const hw = (await page.evaluate(`${SCENE}.rockets.group.getChildren().find((r) => r.active).body.halfWidth`)) as number;
  const gap = (ENEMY_SHIP.radius + ENEMY_SHIP.shield.r) / 2; // 15: outside the hull, inside the ring
  await page.evaluate(`(() => { const r = ${SCENE}.rockets.group.getChildren().find((r) => r.active); r.body.reset(${at.x + gap} + ${hw}, 600); r.body.setVelocity(0, -300); })()`);
  expect((await stepUntil(page, `!s.__debug.ships()[0].shielded`, 120)).done).toBe(true);
  expect((await ships(page))[0].phase).toBe('holding'); // popped, not killed
  // With the bubble gone, the same line now misses the bare hull.
  await fire(page, 0, 600, 0, -300, '{}', 'p2');
  await page.evaluate(`(() => { const r = ${SCENE}.rockets.group.getChildren().find((r) => r.active); r.body.reset(${at.x + gap} + ${hw}, 600); r.body.setVelocity(0, -300); })()`);
  await stepGame(page, 16, 80);
  expect((await ships(page))[0].phase).toBe('holding');
  expect(await score(page)).toBe(0);
});

test('every glide is a real hop inside the roam box, from the entry point and from a corner', async ({ page }) => {
  await emptyField(page);
  // Many draws of a ship's next spot, straight through its own glide code.
  const r = await page.evaluate((roam) => {
    const sh = (window as any).__game.scene.keys['Sandbox'].squadron.ships[0];
    const hops: { from: string; d: number; inBox: boolean }[] = [];
    const draw = (from: string) => {
      const d = Math.hypot(sh.toX - sh.fromX, sh.toY - sh.fromY);
      const inBox = sh.toX >= roam.minX && sh.toX <= roam.maxX && sh.toY >= roam.minY && sh.toY <= roam.maxY;
      hops.push({ from, d, inBox });
    };
    for (let n = 0; n < 200; n++) {
      sh.field(false, 6500); // the entry glide, from just off the right edge
      draw('entry');
      for (const [x, y] of [[roam.maxX, roam.minY], [roam.maxX, roam.maxY], [roam.minX, roam.minY], [roam.minX, roam.maxY]]) {
        sh.sprite.setPosition(x, y);
        sh.startGlide();
        draw('corner');
      }
    }
    sh.vanish();
    return hops;
  }, ENEMY_SHIP.roam);
  for (const hop of r) {
    expect(hop.inBox, hop.from).toBe(true);
    expect(hop.d, hop.from).toBeGreaterThanOrEqual(ENEMY_SHIP.hopMin);
    expect(hop.d, hop.from).toBeLessThanOrEqual(ENEMY_SHIP.hopMax);
  }
});

test('a ship faces where it glides and turns the short way: its heading stays in ±π and its nose is on target when it fires', async ({ page }) => {
  await gotoGame(page, '?wave=5');
  // 60 s unattended (shields regrow often enough at this pace that some fleet
  // ship is always left to aim at). Every frame, every ship's heading stays
  // in −π..π; at each glide's end the nose is along the glide; at each shot
  // it points at the fleet ship it fires at.
  const r = await page.evaluate((frames) => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const sq = s.squadron;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let outOfRange = 0;
    const glideErr: number[] = [];
    const aimErr: number[] = [];
    const fire = sq.fire.bind(sq);
    sq.fire = (x: number, y: number, i: number) => {
      const sh = sq.ships.find((k: any) => Math.hypot(k.sprite.x - x, k.sprite.y - y) <= 12.5);
      const p = s.fleet.shipPoint(i);
      if (sh) aimErr.push(Math.abs(wrap(sh.heading - Math.atan2(p.y - sh.sprite.y, p.x - sh.sprite.x))));
      fire(x, y, i);
    };
    const prev = sq.ships.map((k: any) => k.phase);
    for (let n = 0; n < frames && !s.failOverlay.visible; n++) {
      w.__step();
      sq.ships.forEach((k: any, j: number) => {
        if (k.isActive && Math.abs(k.heading) > Math.PI + 1e-9) outOfRange++;
        if (prev[j] === 'gliding' && k.phase === 'holding') glideErr.push(Math.abs(wrap(k.heading - k.glideHeading)));
        prev[j] = k.phase;
      });
    }
    return { outOfRange, glideErr, aimErr };
  }, Math.round(60_000 / 16));
  expect(r.outOfRange).toBe(0);
  expect(r.glideErr.length).toBeGreaterThan(5);
  expect(r.aimErr.length).toBeGreaterThan(5);
  for (const e of r.glideErr) expect(e).toBeLessThan(0.05);
  for (const e of r.aimErr) expect(e).toBeLessThan(0.05);
});

test('the triple missile takes three different ships', async ({ page }) => {
  await emptyField(page);
  // Three ships across P2's boot aim (straight up from its launcher at x=180).
  const at = [{ x: 120, y: 380 }, { x: 180, y: 380 }, { x: 240, y: 380 }];
  for (const [i, p] of at.entries()) await placeShip(page, i, p.x, p.y);
  await debug(page, "setSpecial(2, 'triple')");
  await countShots(page);
  const t = await touchscreen(page);
  const L = await v2Layout(page, 2);
  await t.down(1, L.special.x, L.special.y);
  await stepGame(page, 16, 2);
  await t.up(1);
  await stepGame(page, 16, 1);
  expect(await fired(page)).toBe(3);
  const targets = (await page.evaluate(
    `${SCENE}.rockets.group.getChildren().filter((r) => r.active && r.getData('missile')).map((r) => ${SCENE}.squadron.ships.indexOf(r.getData('target')))`
  )) as number[];
  expect(targets.sort()).toEqual([0, 1, 2]);
  expect((await stepUntil(page, `s.__debug.ships().slice(0, 3).every((sh) => sh.phase !== 'holding')`, 150)).done).toBe(true);
  expect(await score(page)).toBe(3 * SCORE.ship);
});

test('a ship wave refills from its quota, clears when the last ship is down, and leftover bolts fizzle', async ({ page }) => {
  await gotoGame(page, '?wave=4');
  // Kill every ship as soon as it's on screen (through its own takeHit, as a
  // hit would), counting kills and the most in play at once, until the wave
  // leaves 'live'. Once the quota is spent, one ship fires before it dies,
  // to leave a bolt flying.
  const r = await page.evaluate((width) => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const sq = s.squadron;
    let kills = 0;
    let most = 0;
    let boltsAtClear = -1;
    let leftOne = false;
    for (let n = 0; n < 6000 && s.__debug.state() === 'live'; n++) {
      w.__step();
      const live = sq.ships.filter((sh: any) => sh.isActive);
      most = Math.max(most, live.length);
      for (const sh of live) {
        if (sh.sprite.x >= width) continue;
        if (sq.quotaRemaining === 0 && !leftOne) {
          sh.debugFire();
          leftOne = true;
        }
        if (sh.takeHit(1) > 0) kills++;
      }
      if (sq.isClear && boltsAtClear < 0) boltsAtClear = s.__debug.bolts().length;
    }
    return { kills, most, boltsAtClear, state: s.__debug.state(), wave: s.__debug.wave() };
  }, GAME_WIDTH);
  expect(r.kills).toBe(W4.quota);
  expect(r.most).toBe(W4.onScreen);
  expect(r.state).toBe('between');
  expect(r.wave).toBe(4);
  // The bolt still flying when the last ship died fades out, harmlessly.
  expect(r.boltsAtClear).toBeGreaterThanOrEqual(1);
  expect((await stepUntil(page, 's.__debug.bolts().length === 0', 30)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['shielded', 'shielded', 'shielded', 'shielded']);
  expect((await stepUntil(page, `s.__debug.wave() === 5 && s.__debug.state() === 'live'`, 1500)).done).toBe(true);
});

test("a bolt that takes the fleet's last ship shows the fail card, and Try again restarts act 2 at wave 4", async ({ page }) => {
  await gotoGame(page);
  await debug(page, 'jumpToWave(5)');
  await loseShips(page, 1, 2, 3);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(0)`); // ship 0's shield is down
  await placeShip(page, 0, 200, sublaneCenterY(0));
  await debug(page, 'shipFire(0)');
  expect((await stepUntil(page, `s.failOverlay.visible`, 300)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['lost', 'lost', 'lost', 'lost']);
  await tryAgain(page);
  expect(await failVisible(page)).toBe(false);
  expect(await debug(page, 'wave()')).toBe(4); // act 2's first wave
  expect(await debug(page, 'waveKind()')).toBe('ship');
  expect(inPlay(await ships(page))).toHaveLength(W4.onScreen);
});

test('solo: each ship fires once per fireEveryMs ÷ SOLO.pace; two players keep fireEveryMs (#6)', async ({ page }) => {
  /** Wave 4 unattended for `frames` steps: the ms of each ship's first two shots (both ships). */
  const shotTimes = (frames: number) =>
    page.evaluate((frames) => {
      const w = window as any;
      const sq = w.__game.scene.keys['Sandbox'].squadron;
      const byShip: number[][] = sq.ships.map(() => []);
      const fire = sq.fire.bind(sq);
      let ms = 0;
      sq.fire = (x: number, y: number, i: number) => {
        const k = sq.ships.findIndex((sh: any) => Math.hypot(sh.sprite.x - x, sh.sprite.y - y) <= sh.radius + 0.5);
        byShip[k]?.push(ms);
        fire(x, y, i);
      };
      for (let n = 0; n < frames; n++) {
        w.__step();
        ms += 16;
      }
      return byShip.filter((t) => t.length >= 2);
    }, frames);
  for (const [lineup, players, pace] of [[DUO, 2, 1], [SOLO_BOTTOM, 1, SOLO.pace]] as const) {
    await gotoGame(page, '?wave=4', lineup);
    const cycle = W4.fireEveryMs / pace;
    const ships = await shotTimes(Math.ceil((2 * cycle + 500) / 16));
    expect(ships.length, `${players}p`).toBe(W4.onScreen);
    for (const [first, second] of ships) {
      // The entry glide is a full glide, so the first shot comes a cycle less the beat after the shot.
      expect(Math.abs(first - (glideMs(W4, pace) + ENEMY_SHIP.telegraphMs)), `${players}p first`).toBeLessThanOrEqual(32);
      expect(Math.abs(second - first - cycle), `${players}p cycle`).toBeLessThanOrEqual(32);
    }
  }
});
