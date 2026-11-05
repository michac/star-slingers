/**
 * monster.spec.ts — act 3 (#28): waves 7–8 field space jellies, not rocks;
 * a jelly steering at the nearest live fleet ship, crossing sublanes and
 * re-targeting on a loss; its fleet contact (shield, then ship, then the fail
 * card); its damage and heal rule (finished before the heal, it dies; left
 * alone, it heals back to full; wave 8 heals faster); missiles and the
 * detonator taking jellies; the quota flow; the wave-9 mother jelly entering,
 * bobbing, releasing babies, taking every weapon's damage and healing from 0
 * to full; her pop taking her babies with her, then the pod drop; and the
 * MOTHER dials outlasting an ignored brood.
 * Shared harness and the console gate: ./helpers.ts.
 */
import { test, expect, SCENE, debug, gotoGame, stepGame, stepUntil, fire, fleetStates, loseShips, score, failVisible, clearField, healthBars, type Page } from './helpers';
import { AMMO_REGEN_MS, BOMB, GAME_WIDTH, JELLY_LAYOUT, LANE, MOTHER_LAYOUT, SCORE, SLING, SUBLANE_H, sublaneCenterY } from '../src/layout';
import { BOSS_DROPS, JELLY, MOTHER, RUN, babyWipeMs, motherFocusKillMs } from '../src/waves';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Jelly = { phase: string; x: number; y: number; r: number; hp: number; maxHp: number; healing: boolean; baby: boolean; target: number };
type Mother = { phase: string; x: number; y: number; r: number; hp: number; maxHp: number; healing: boolean; released: number };
const jellies = (page: Page) => debug<Jelly[]>(page, 'jellies()');
const jelly = async (page: Page, i: number) => (await jellies(page))[i];
const mother = (page: Page) => debug<Mother>(page, 'mother()');
const swimming = (list: Jelly[]) => list.filter((j) => j.phase === 'swimming');
const W7 = RUN[6].monsters!;
const W8 = RUN[7].monsters!;
const FRAME = 16;

/** An empty field to place jellies on: wave 1 with its rocks taken off (they
 *  don't come back: a vanished rock is parked, not respawned). */
async function emptyField(page: Page): Promise<void> {
  await gotoGame(page);
  await clearField(page);
  await stepGame(page, FRAME, 1);
}

/** Place pool jelly i as wave N's jelly: held still (it still heals), or swimming. */
const placeJelly = (page: Page, i: number, x: number, y: number, { wave = 7, held = true } = {}) =>
  debug(page, `fieldJelly(${i}, ${x}, ${y}, ${wave}, ${held})`);

/** A bomb blown up right at (x, y), through the scene's real detonate path. */
const blastAt = (page: Page, x: number, y: number) =>
  page.evaluate(`${SCENE}.detonate(${SCENE}.rockets.fire('rocket-p2', ${x}, ${y}, 0, 0, 'p2', { bomb: true }))`);

/** Frames from a hit until a held jelly's hp is back to full. */
async function framesToFull(page: Page, i: number): Promise<number> {
  const r = await stepUntil(page, `s.__debug.jellies()[${i}].hp >= s.__debug.jellies()[${i}].maxHp`, 400);
  expect(r.done).toBe(true);
  return r.steps;
}

test('waves 7 and 8 field only jellies, entering off the right edge; wave 8 fields more', async ({ page }) => {
  await gotoGame(page, '?wave=7');
  expect(await debug(page, 'waveKind()')).toBe('monster');
  expect(await debug(page, 'state()')).toBe('live');
  expect(await page.evaluate(`${SCENE}.asteroids.some((a) => a.isActive)`)).toBe(false);
  let field = swimming(await jellies(page));
  expect(field).toHaveLength(W7.onScreen);
  expect(field.every((j) => j.x > GAME_WIDTH && !j.baby && j.hp === JELLY.hp && j.maxHp === JELLY.hp)).toBe(true);
  expect(field.every((j) => j.y >= LANE.top + j.r && j.y <= LANE.bottom - j.r)).toBe(true);

  await debug(page, 'jumpToWave(8)');
  field = swimming(await jellies(page));
  expect(field).toHaveLength(W8.onScreen);
  expect(W8.onScreen).toBeGreaterThan(W7.onScreen);
  expect(W8.quota).toBeGreaterThan(W7.quota);
  expect(W8.healFullMs).toBeLessThan(W7.healFullMs); // AC4: heals faster
  expect(await page.evaluate(`${SCENE}.asteroids.some((a) => a.isActive)`)).toBe(false);
});

test('a monster wave refills from its quota and ends once the quota is spent', async ({ page }) => {
  await gotoGame(page, '?wave=7');
  // Kill every jelly in play each frame, counting the kills, until the wave ends.
  const r = await page.evaluate(() => {
    const w = window as any;
    const s = w.__game.scene.keys['Sandbox'];
    const d = s.__debug;
    let kills = 0;
    let maxInPlay = 0;
    for (let n = 0; n < 600 && d.state() === 'live'; n++) {
      const list = d.jellies();
      maxInPlay = Math.max(maxInPlay, list.filter((j: any) => j.phase === 'swimming' || j.phase === 'popping').length);
      list.forEach((j: any, i: number) => {
        if (j.phase === 'swimming' && d.hitJelly(i, 3) > 0) kills++;
      });
      w.__step();
    }
    return { kills, maxInPlay, state: d.state(), wave: d.wave() };
  });
  expect(r.kills).toBe(W7.quota);
  expect(r.maxInPlay).toBeLessThanOrEqual(W7.onScreen);
  expect(r.state).not.toBe('live');
});

test('a jelly steers at the nearest live ship, crosses sublanes when that ship is lost, and hits it like a rock', async ({ page }) => {
  await emptyField(page);
  // Level with ship 3, nearest to it.
  await placeJelly(page, 0, 240, sublaneCenterY(3), { held: false });
  await stepGame(page, FRAME, 1);
  expect((await jelly(page, 0)).target).toBe(3);
  // Ships 3 and 2 lost: it turns for ship 1 (the nearest live one now).
  await loseShips(page, 3, 2);
  await stepGame(page, FRAME, 1);
  expect((await jelly(page, 0)).target).toBe(1);
  // Swim it in, checking it stays in the lane every frame.
  const r = await page.evaluate(
    ({ top, bottom }) => {
      const w = window as any;
      const d = w.__game.scene.keys['Sandbox'].__debug;
      let outside = 0;
      let last: any = null;
      for (let n = 0; n < 900; n++) {
        const j = d.jellies()[0];
        if (j.phase !== 'swimming') break;
        if (j.y - j.r < top - 0.5 || j.y + j.r > bottom + 0.5) outside++;
        last = j;
        w.__step();
      }
      return { outside, last, phase: d.jellies()[0].phase };
    },
    { top: LANE.top, bottom: LANE.bottom }
  );
  expect(r.outside).toBe(0);
  expect(r.phase).toBe('popping');
  // It arrived in ship 1's sublane and popped its shield; ship 0 is untouched.
  expect(Math.abs(r.last.y - sublaneCenterY(1))).toBeLessThan(SUBLANE_H / 2);
  expect(await fleetStates(page)).toEqual(['shielded', 'exposed', 'lost', 'lost']);
  expect(await score(page)).toBe(0); // reaching the fleet never scores
});

test("a jelly reaching the fleet's last ship shows the fail card", async ({ page }) => {
  await emptyField(page);
  await loseShips(page, 1, 2, 3);
  await page.evaluate(`${SCENE}.fleet.onEnemyReached(0)`); // ship 0's shield down
  await placeJelly(page, 0, 120, sublaneCenterY(0), { held: false });
  expect((await stepUntil(page, `s.failOverlay.visible`, 300)).done).toBe(true);
  expect(await fleetStates(page)).toEqual(['lost', 'lost', 'lost', 'lost']);
});

test('a jelly finished before its heal dies; left alone it heals back to full, its bar showing; every hit restarts the wait', async ({ page }) => {
  await emptyField(page);
  const y = sublaneCenterY(1);
  await placeJelly(page, 0, 200, y);
  await placeJelly(page, 1, 280, y);
  // Jelly 0: two hits, then the third inside the heal's wait kills it.
  await debug(page, 'hitJelly(0, 2)');
  await stepGame(page, FRAME, Math.floor((W7.healPauseMs - 100) / FRAME));
  expect(await jelly(page, 0)).toMatchObject({ hp: 1, healing: false });
  expect(await debug(page, 'hitJelly(0, 1)')).toBe(SCORE.jelly);
  expect((await jelly(page, 0)).phase).toBe('popping');
  expect(await score(page)).toBe(SCORE.jelly);

  // Jelly 1: one hit, then another just before the wait ends restarts it.
  await debug(page, 'hitJelly(1, 1)');
  await stepGame(page, FRAME, Math.floor((W7.healPauseMs - 100) / FRAME));
  await debug(page, 'hitJelly(1, 1)');
  await stepGame(page, FRAME, Math.floor((W7.healPauseMs - 100) / FRAME));
  expect(await jelly(page, 1)).toMatchObject({ hp: 1, healing: false }); // still waiting
  // Left alone, it starts healing once the wait ends, its bar refilling.
  expect((await stepUntil(page, 's.__debug.jellies()[1].healing', 20)).done).toBe(true);
  await stepGame(page, FRAME, 20);
  const mid = await jelly(page, 1);
  expect(mid.hp).toBeGreaterThan(1);
  expect(mid.hp).toBeLessThan(JELLY.hp);
  const bar = (await healthBars(page)).find((b) => Math.abs(b.y - mid.y) < 1); // drawn beside it
  expect(bar?.frac).toBeCloseTo(mid.hp / JELLY.hp, 1);
  expect((await stepUntil(page, `s.__debug.jellies()[1].hp >= ${JELLY.hp}`, 300)).done).toBe(true);
  expect(await jelly(page, 1)).toMatchObject({ phase: 'swimming', hp: JELLY.hp, healing: false });
});

test("wave 7's jelly heals empty → full in ~3 s after the wait, wave 8's in ~2 s", async ({ page }) => {
  await emptyField(page);
  for (const [i, wave, w] of [[0, 7, W7], [1, 8, W8]] as const) {
    await placeJelly(page, i, 200 + 60 * i, sublaneCenterY(i), { wave });
    await debug(page, `hitJelly(${i}, 2)`); // 1 of 3 hp left: two thirds to heal
    const expected = (w.healPauseMs + (w.healFullMs * 2) / 3) / FRAME;
    expect(Math.abs((await framesToFull(page, i)) - expected), `wave ${wave}`).toBeLessThanOrEqual(2);
  }
  expect([W7.healPauseMs, W7.healFullMs, W8.healFullMs]).toEqual([500, 3000, 2000]);
});

test('real shots count as usual on a jelly: plain 1, charged 2 (passing through a kill), blast 2; missiles take jellies', async ({ page }) => {
  await emptyField(page);
  const x = 180;
  const y = 380;
  await placeJelly(page, 0, x, y);
  await fire(page, x, y + 90, 0, -SLING.maxSpeed);
  expect((await stepUntil(page, 's.__debug.jellies()[0].hp < 3', 30)).done).toBe(true);
  expect((await jelly(page, 0)).hp).toBe(2);
  await fire(page, x, y + 90, 0, -SLING.maxSpeed, '{ charged: true }');
  expect((await stepUntil(page, `s.__debug.jellies()[0].phase !== 'swimming'`, 30)).done).toBe(true);
  expect(await score(page)).toBe(SCORE.jelly);
  // The charged round that killed it carries on (#22).
  expect(await page.evaluate(`${SCENE}.rockets.group.getChildren().some((r) => r.active && r.getData('charged'))`)).toBe(true);

  // The detonator's blast: 2 off each jelly inside it (off the charged round's line).
  await placeJelly(page, 1, x + 80, y);
  await stepGame(page, FRAME, 1);
  await blastAt(page, x + 80, y + JELLY_LAYOUT.radius);
  expect((await jelly(page, 1)).hp).toBe(JELLY.hp - 2);
  expect(BOMB.blastRadius).toBeGreaterThan(JELLY_LAYOUT.radius);

  // A missile's picker takes a jelly ahead of it.
  expect(await page.evaluate(`${SCENE}.pickMissileTarget(${x + 80}, 650, 0, -1) === ${SCENE}.swarm.jellies[1]`)).toBe(true);
});

test('the mother jelly slides in to the right of the lane, bobs, and releases babies that swim at the fleet', async ({ page }) => {
  await gotoGame(page, '?wave=9');
  expect(await debug(page, 'state()')).toBe('boss');
  expect(await mother(page)).toMatchObject({ phase: 'entering', hp: MOTHER.hp, maxHp: MOTHER.hp, released: 0 });
  expect((await mother(page)).x).toBeGreaterThan(GAME_WIDTH);
  expect((await stepUntil(page, `s.__debug.mother().phase === 'live'`, Math.ceil(MOTHER_LAYOUT.enterMs / FRAME) + 2)).done).toBe(true);
  expect((await mother(page)).x).toBeCloseTo(MOTHER_LAYOUT.x, 0);
  expect(swimming(await jellies(page))).toHaveLength(0);
  // Her first release, then the next one on the dial's interval.
  const first = await stepUntil(page, `s.__debug.mother().released > 0`, Math.ceil(MOTHER.firstReleaseMs / FRAME) + 2);
  expect(first.done).toBe(true);
  let babies = swimming(await jellies(page));
  expect(babies).toHaveLength(MOTHER.babiesPerRelease);
  expect(babies.every((b) => b.baby && b.hp === 1 && b.maxHp === 1 && b.r === JELLY_LAYOUT.babyRadius)).toBe(true);
  await stepGame(page, FRAME, 1);
  expect((await jellies(page)).filter((j) => j.phase === 'swimming').every((b) => b.target >= 0)).toBe(true);
  const next = await stepUntil(page, `s.__debug.mother().released > ${MOTHER.babiesPerRelease}`, Math.ceil(MOTHER.releaseEveryMs / FRAME) + 2);
  expect(Math.abs(next.steps - MOTHER.releaseEveryMs / FRAME)).toBeLessThanOrEqual(2);
  babies = swimming(await jellies(page));
  expect(babies).toHaveLength(2 * MOTHER.babiesPerRelease);
  // She bobs: up and down the lane over one bob period, inside it.
  const ys = await page.evaluate((frames) => {
    const w = window as any;
    const d = w.__game.scene.keys['Sandbox'].__debug;
    const out: number[] = [];
    for (let n = 0; n < frames; n++) {
      out.push(d.mother().y);
      w.__step();
    }
    return out;
  }, Math.ceil(MOTHER_LAYOUT.bobMs / FRAME));
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1.9 * MOTHER_LAYOUT.bobAmp);
  expect(Math.min(...ys) - MOTHER_LAYOUT.radius).toBeGreaterThanOrEqual(LANE.top - 1);
  expect(Math.max(...ys) + MOTHER_LAYOUT.radius).toBeLessThanOrEqual(LANE.bottom + 1);
});

test('every weapon hurts the mother, and she heals from 0 back to full given time', async ({ page }) => {
  await gotoGame(page, '?wave=9');
  expect((await stepUntil(page, `s.__debug.mother().phase === 'live'`, 200)).done).toBe(true);
  const m = await mother(page);
  // A plain round 1, a charged round 2 (fired straight at her from the left).
  await fire(page, m.x - 120, m.y, SLING.maxSpeed, 0);
  expect((await stepUntil(page, `s.__debug.mother().hp < ${MOTHER.hp}`, 30)).done).toBe(true);
  expect((await mother(page)).hp).toBe(MOTHER.hp - 1);
  const at = await mother(page);
  await fire(page, at.x - 120, at.y, SLING.maxSpeed, 0, '{ charged: true }');
  expect((await stepUntil(page, `s.__debug.mother().hp < ${MOTHER.hp - 1}`, 30)).done).toBe(true);
  expect((await mother(page)).hp).toBe(MOTHER.hp - 3);
  // The detonator's blast 2; and a missile's picker takes her.
  const b = await mother(page);
  await blastAt(page, b.x - b.r, b.y);
  expect((await mother(page)).hp).toBe(MOTHER.hp - 5);
  expect(await page.evaluate(`${SCENE}.pickMissileTarget(${b.x - 150}, ${b.y}, 1, 0) === ${SCENE}.mother`)).toBe(true);
  // Her bar shows; she doesn't heal inside the wait.
  expect((await healthBars(page)).some((bar) => Math.abs(bar.y - b.y) < 1)).toBe(true);
  await stepGame(page, FRAME, Math.floor((MOTHER.healPauseMs - 100) / FRAME));
  expect(await mother(page)).toMatchObject({ hp: MOTHER.hp - 5, healing: false });

  // From 0 hp left alone (her babies popped each frame so the fleet lasts),
  // she heals all the way back in about healPauseMs + healFullMs.
  await debug(page, 'setMotherHp(0)');
  const r = await stepUntil(page, `(s.swarm.popAll(() => {}), s.__debug.mother().hp >= ${MOTHER.hp})`, 2400);
  expect(r.done).toBe(true);
  expect(Math.abs(r.steps - (MOTHER.healPauseMs + MOTHER.healFullMs) / FRAME)).toBeLessThanOrEqual(3);
  expect(await mother(page)).toMatchObject({ phase: 'live', hp: MOTHER.hp, healing: false });
  expect(await failVisible(page)).toBe(false);
});

test("the mother's pop pops every baby in flight (each scoring), then her pods drop", async ({ page }) => {
  await gotoGame(page, '?wave=9');
  expect((await stepUntil(page, `s.__debug.mother().released >= ${2 * MOTHER.babiesPerRelease}`, 400)).done).toBe(true);
  const inFlight = swimming(await jellies(page)).length;
  expect(inFlight).toBe(2 * MOTHER.babiesPerRelease);
  await debug(page, 'setMotherHp(1)');
  const before = await score(page);
  await debug(page, 'hitMother(1)');
  expect((await mother(page)).phase).toBe('popping');
  expect(swimming(await jellies(page))).toHaveLength(0);
  expect((await score(page)) - before).toBe(inFlight * SCORE.babyJelly);
  // The wave ends into the boss drop: the monster boss's two pods.
  expect((await stepUntil(page, `s.__debug.pods().phase === 'live'`, 60)).done).toBe(true);
  expect(await debug(page, 'pods()')).toMatchObject({ phase: 'live', kinds: [...BOSS_DROPS.monsterBoss] });
  expect(await debug(page, 'interludes()')).toEqual(['drop:9']);
  await stepGame(page, FRAME, Math.ceil(MOTHER_LAYOUT.popMs / FRAME) + 1);
  expect((await mother(page)).phase).toBe('parked');
});

test('the MOTHER dials outlast an ignored brood, and steady fire holds her heal', () => {
  // AC5 / D6: even the fastest focus kill (every round charged, every
  // special a triple, from full ammo) takes longer than ignored babies need
  // to wipe the fleet, in solo and co-op.
  for (const players of [1, 2] as const) {
    expect(motherFocusKillMs(players), `${players}p`).toBeGreaterThan(babyWipeMs());
  }
  // One seat firing as fast as its rounds come back keeps her heal stopped.
  expect(MOTHER.healPauseMs).toBeGreaterThan(AMMO_REGEN_MS);
  // More than one baby every few seconds (D6).
  expect(MOTHER.babiesPerRelease).toBeGreaterThan(1);
  expect(MOTHER.releaseEveryMs).toBeLessThanOrEqual(3000);
});
