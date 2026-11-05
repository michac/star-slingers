/**
 * waves.ts — the difficulty dials. This is the one file to tune the run:
 * the run (`RUN`: 10 waves in 4 acts, each wave's kind and targets), the knob ranges the solver moves through
 * (`DIFFICULTY_MODEL`), the rock streams (`ROCK_STREAMS`), and the
 * budget/solver math that turns a target into a concrete asteroid field.
 *
 * The model (see docs/design.md §7 "Difficulty"): a wave is a TARGET — the net team
 * damage/s it should demand — and `solveWave` realizes it by advancing knobs in
 * priority order (count → speed → toughness) until the field's threat meets the
 * target. Damage per shot is `DAMAGE`; a rock's clear damage counts its hp (a
 * two-hit rock costs 2), so the target is damage/s, not kills/s.
 * Geometry/paint live in layout.ts; this file only imports the few constants
 * the budget math needs.
 */
import { AMMO, AMMO_REGEN_MS, FLEET, GAME_WIDTH, JELLY_LAYOUT, MOTHER_LAYOUT, SPECIAL, SPLITTER_CHILDREN } from './layout';
import type { SpecialKind } from './objects/specials';

export interface AsteroidSpec {
  kind: AsteroidKind;
  radius: number;
  speed: number; // px/s, right -> left (each (re)spawn draws its y: WaveDirector's sublane bag)
  /** Max hp override (tests / future tuning); defaults to ASTEROID_KIND[kind].hp. */
  hp?: number;
}

/** A standard pops on one point of damage. A tough rock (#25) takes two: it's
 * a little bigger and drawn in a darker, denser shade so it reads as tough
 * before it's hit. A splitter pops on one, then adds two standard children,
 * so clearing it completely takes 3 damage (clearDamage). */
export type AsteroidKind = 'standard' | 'tough' | 'splitter';
export const ASTEROID_KIND = {
  standard: { radius: 13, hp: 1 },
  tough: { radius: 15, hp: 2 },
  splitter: { radius: 17, hp: 1 },
} as const satisfies Record<AsteroidKind, { radius: number; hp: number }>;

/** Damage per rocket hit, by shot type (#22): a plain FIRE round, a charged
 *  FIRE round (the railgun: double damage, and it carries on past a target only
 *  if this hit kills it), the SPECIAL homing missile (one per missile of a
 *  triple, #26), and a detonator's blast (#26: to every enemy inside it). A
 *  charged round pops a two-hit rock at once; on a one-hit rock its second
 *  point is overkill. */
export const DAMAGE = {
  fire: 1,
  charged: 2,
  missile: 1,
  blast: 2,
} as const;

/** A rock's max hp: its spec override, else its kind's default. */
export function maxHpOf(spec: AsteroidSpec): number {
  return spec.hp ?? ASTEROID_KIND[spec.kind].hp;
}

/** Total damage to clear a rock completely: its hp, plus for a splitter the hp
 *  of the standard children it releases (1 + 2 × 1 = 3). A tough rock is 2. */
export function clearDamage(spec: AsteroidSpec): number {
  const children = spec.kind === 'splitter' ? SPLITTER_CHILDREN.count * ASTEROID_KIND.standard.hp : 0;
  return maxHpOf(spec) + children;
}

/** Rock streams — one asteroid wrapper each, fielding rock after rock at its
 *  base speed. Only the speed is fixed here: the solver assigns toughness and
 *  size per wave, and every (re)spawn draws its y from the WaveDirector's
 *  sublane bag, so no stream owns a sublane. The floor (minStreams) uses the
 *  first streams. */
export const ROCK_STREAMS: { baseSpeed: number }[] = [
  { baseSpeed: 40 },
  { baseSpeed: 50 },
  { baseSpeed: 55 },
  { baseSpeed: 65 },
];

/**
 * The difficulty model: knob ranges the solver moves through, in priority
 * order count -> speed -> toughness (gentlest lever first; toughness, the
 * most frustrating for the 5yo, last). spawnGapMax is global here — it's
 * downtime texture, not a primary difficulty lever.
 */
export const DIFFICULTY_MODEL = {
  minStreams: 3, // the always-on "minimum asteroid rate" floor
  maxStreams: 4,
  minSpeedScale: 0.5,
  maxSpeedScale: 0.85,
  speedStep: 0.02,
  spawnGapMax: 300,
} as const;

/** A wave is just its difficulty TARGET (required team damage/s — the budget
 *  scalar, now the input) plus length (quota) and shield regen. The solver
 *  derives the asteroid composition. */
export interface WaveConfig {
  required: number; // target net damage/s players must land (see docs/design.md §7)
  quota: number; // total asteroids this wave fields, then respawns stop
  shieldRegenMs: number; // a fleet ship's shield regrows after this long unhit; 0 = off
  /** The toughest rock the solver may field: its last lever swaps standards
   *  for this kind. Default 'splitter'; 'standard' turns the lever off (#25:
   *  act 1 brings in one new idea per wave). */
  topKind?: AsteroidKind;
}

/** The run's four acts: 1 asteroids, 2 ships, 3 space monsters, 4 the finale. */
export type Act = 1 | 2 | 3 | 4;

/** What a wave fields: asteroids (#25), enemy ships (#27), space jellies
 *  (#28), a boss, or the finale's asteroid field. */
export type WaveKind = 'asteroid' | 'ship' | 'monster' | 'boss' | 'finale';

/** Which boss a `boss` wave is: the giant asteroid ends act 1, the command
 *  ship (BOSS below, docs/design.md §9) ends act 2, the mother jelly (MOTHER below, §12) act 3. */
export type BossId = 'giantAsteroid' | 'commandShip' | 'monsterBoss';

/** A ship wave (#27, act 2): enemy ships roam the lane and shoot bolts at
 *  the fleet (ShipSquadron). Ships don't fit the asteroid solver's threat
 *  model, so a ship wave has its own dials. The "if nobody shoots" fleet-hit
 *  rate is shipFleetHitsPerSec below; the e2e suite checks it against the
 *  asteroid waves'. */
export interface ShipWaveConfig {
  onScreen: number; // ships in play at once; a destroyed ship's place is refilled from the quota
  quota: number; // total ships this wave fields (the initial ones included)
  /** Every Nth ship fielded wears a one-hit shield bubble; 0 = none. */
  shieldedEvery: number;
  /** One ship's whole move: glide to a new spot, then hold there (the
   *  ENEMY_SHIP.telegraphMs warning, the shot, a beat). So each ship fires one
   *  bolt per fireEveryMs. */
  fireEveryMs: number;
  shieldRegenMs: number; // a fleet ship's shield regrows after this long unhit
}

/** A monster wave (#28, act 3): space jellies swim at the fleet
 *  (JellySwarm). Like a ship wave it has its own dials, not the solver's. A
 *  jelly has JELLY.hp and heals: healPauseMs after its last hit it starts
 *  climbing back, empty to full in healFullMs, so a jelly is killed by hits
 *  landing close together. */
export interface MonsterWaveConfig {
  onScreen: number; // jellies in play at once; a gone jelly's place is refilled from the quota
  quota: number; // total jellies this wave fields (the initial ones included)
  healPauseMs: number; // a hit stops the heal this long
  healFullMs: number; // then it heals empty → full in this long
  shieldRegenMs: number; // a fleet ship's shield regrows after this long unhit
}

/** One wave of the run. A wave with a `field` is played by the difficulty
 *  solver (an asteroid field), a wave with `ships` by the ShipSquadron, a
 *  wave with `monsters` by the JellySwarm; a boss with none of them is played
 *  by its own encounter (the giant asteroid by GiantAsteroid with the GIANT
 *  dials, the command ship by the BossEncounter with the BOSS dials, the
 *  mother jelly by MotherJelly with the MOTHER dials). */
export interface RunWave {
  act: Act;
  kind: WaveKind;
  boss?: BossId;
  field?: WaveConfig;
  ships?: ShipWaveConfig;
  monsters?: MonsterWaveConfig;
}

/**
 * THE RUN — 10 waves in 4 acts, in play order (docs/design.md §3). Every dial
 * for the run lives here so each act's issue retunes it in one place.
 *
 * Targets: each act eases back a step from the last one's peak, then climbs.
 * Act 1 (#25) brings in one new idea per wave: W1 is standards only (its
 * calibrated 0.30 target saturates at four standards ×0.85, ≈0.29), W2 adds
 * two-hit rocks (no splitters), W3 is the giant asteroid (GIANT below). The
 * 5yo's cushion is homing, not speed: if W1 plays too steep, soften its target
 * toward ~0.25. Act 2 (#27) plays its first two waves as enemy ships (their
 * own dials, ShipWaveConfig): W4 two at a time, W5 three with every second
 * one shielded. Each eases its unattended fleet-hit rate below the matching
 * act-1 wave's (W4 under W1, W5 under W2). Act 3 (#28) plays its first two
 * waves as space jellies (MonsterWaveConfig): W7 three at a time, healing
 * empty → full in 3 s; W8 four, healing in 2 s. W9 is the mother jelly (MOTHER).
 * All revisable in playtest. Tune by the dev boot log (target vs achieved +
 * tier; a ship wave logs its bolts/s).
 *
 * The finale is a long, dense, forgiving wave to blast with every upgrade:
 * its target solves to all four streams as splitters at max speed, with a big
 * quota and a quick shield regen.
 */
export const RUN: readonly RunWave[] = [
  { act: 1, kind: 'asteroid', field: { required: 0.3, quota: 8, shieldRegenMs: 10000, topKind: 'standard' } },
  { act: 1, kind: 'asteroid', field: { required: 0.45, quota: 10, shieldRegenMs: 11000, topKind: 'tough' } },
  { act: 1, kind: 'boss', boss: 'giantAsteroid' },
  { act: 2, kind: 'ship', ships: { onScreen: 2, quota: 6, shieldedEvery: 0, fireEveryMs: 8000, shieldRegenMs: 11000 } },
  { act: 2, kind: 'ship', ships: { onScreen: 3, quota: 8, shieldedEvery: 2, fireEveryMs: 8000, shieldRegenMs: 13000 } },
  { act: 2, kind: 'boss', boss: 'commandShip' },
  { act: 3, kind: 'monster', monsters: { onScreen: 3, quota: 8, healPauseMs: 500, healFullMs: 3000, shieldRegenMs: 13000 } },
  { act: 3, kind: 'monster', monsters: { onScreen: 4, quota: 10, healPauseMs: 500, healFullMs: 2000, shieldRegenMs: 15000 } },
  { act: 3, kind: 'boss', boss: 'monsterBoss' },
  { act: 4, kind: 'finale', field: { required: 0.9, quota: 24, shieldRegenMs: 8000 } },
];

/** What each boss drops when it's popped (#26): the two upgrade pods' specials,
 *  in pod order (left, right). The command ship drops the giant asteroid's
 *  pair until its laser + helper drone are built (#42), and the mother jelly
 *  until its Swarm + Mega laser are (#43); each edits its row. */
export const BOSS_DROPS: Record<BossId, readonly [SpecialKind, SpecialKind]> = {
  giantAsteroid: ['triple', 'detonator'],
  commandShip: ['triple', 'detonator'],
  monsterBoss: ['triple', 'detonator'],
};

/** The 1-based wave number of the command-ship boss (`?boss` jumps here). */
export const COMMAND_SHIP_WAVE = RUN.findIndex((w) => w.boss === 'commandShip') + 1;

/** True when `n` is a 1-based wave number of the run (1..RUN.length). */
export function isWaveNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= RUN.length;
}

/** The 1-based first wave of wave `n`'s act: where Try again restarts after a loss. */
export function actStartWave(n: number): number {
  const act = RUN[n - 1].act;
  return RUN.findIndex((w) => w.act === act) + 1;
}

/** The wave a fresh load starts at, from the URL's query string: `?wave=N`
 *  (1..RUN.length) wins, else `?boss` gives the command ship, else wave 1. An
 *  out-of-range or non-numeric N is ignored. */
export function startWaveFromQuery(search: string): number {
  const params = new URLSearchParams(search);
  const n = Number(params.get('wave'));
  if (isWaveNumber(n)) return n;
  return params.has('boss') ? COMMAND_SHIP_WAVE : 1;
}

/**
 * Solo (one seat joined, #6/#20) difficulty dial. A solo run fields the
 * same field waves with each target scaled: `required × requiredScale`. Shipped at
 * 1.0 (no change) — the playtest finds the real value. Ammo regen is per seat,
 * so one player already has half the team's firepower; the dev boot log's
 * break-even % accounts for that. Boss timing is NOT scaled (out of this slice).
 */
export const SOLO = {
  requiredScale: 1.0,
} as const;

/** The target damage/s the solver realizes for this wave at this player count.
 *  `soloScale` exists only so a test can catch the solo wiring (scale applied
 *  in solo, never in two-player) while the shipped SOLO.requiredScale is 1.0;
 *  callers leave it at its default. */
export function waveTarget(wave: WaveConfig, players: 1 | 2, soloScale: number = SOLO.requiredScale): number {
  return players === 1 ? wave.required * soloScale : wave.required;
}

/** Breather between waves: celebration beat + fleet restore + banner. */
export const BREATHER = {
  shipRestoreStaggerMs: 300, // restored ships + shields reappear one by one at this spacing
  bannerMs: 2200, // how long the next-wave banner holds
} as const;

/**
 * Giant-asteroid boss (#25) BALANCE dials — wave 3, act 1's boss (geometry is
 * GIANT_LAYOUT in layout.ts). It comes alone and drifts straight at the fleet;
 * reaching it loses the whole fleet. Only charged FIRE rounds hurt it: in solo
 * every charged hit is one point; with two seats one seat's charged hit lights
 * a ring in its colour for `pairWindowMs`, and the OTHER seat's charged hit
 * inside it is the point. Plain rounds and missiles spark off. At 0 hp it
 * bursts into `burstCount` one-hit rocks, and the wave clears once they're gone.
 */
export const GIANT = {
  hp: 5, // paired (two-player) or single (solo) charged hits
  pairWindowMs: 1000, // how long one seat's lock ring waits for the other seat
  travelMs: 30000, // its leading edge's trip from the right edge to the fleet's bubble front
  burstCount: 6, // one-hit rocks it bursts into
  shieldRegenMs: 13000, // regen during the wave (its burst rocks can pop shields)
} as const;

/**
 * Space jelly (#28) BALANCE dial: its hp. Every hit counts (plain 1, charged
 * 2, missile 1, blast 2), so a charged round helps but never kills one alone;
 * its heal timing is the wave's (MonsterWaveConfig). Motion is JELLY_LAYOUT.
 */
export const JELLY = {
  hp: 3,
} as const;

/**
 * Mother jelly (#28) BALANCE dials — wave 9, act 3's boss (geometry is
 * MOTHER_LAYOUT). It hangs at the lane's right end, bobbing, and releases
 * `babiesPerRelease` one-hit baby jellies every `releaseEveryMs`; they swim
 * at the fleet like any jelly. Every weapon hurts it, and it heals like a
 * jelly (empty → full in healFullMs, healPauseMs after its last hit), so it
 * can climb all the way back from nearly dead. Its pop pops every baby still
 * in flight. Tuned so it outlives the fleet if the babies are ignored
 * (motherFocusKillMs vs babyWipeMs below; the e2e suite checks both).
 */
export const MOTHER = {
  hp: 140,
  healPauseMs: 1200, // longer than a round's regen, so one seat's steady fire keeps the heal stopped
  healFullMs: 30000,
  firstReleaseMs: 1000, // after it has slid in
  releaseEveryMs: 2500,
  babiesPerRelease: 2,
  shieldRegenMs: 15000,
} as const;

/**
 * Command-ship boss (B5) BALANCE dials — wave 6, act 2's boss (geometry is in layout.ts).
 * One continuous CHARGING phase (B34 shield web):
 *
 *   CHARGING: four escorts rotate a physical shield web around the boss.
 *     ├ a downed escort (one hit from EACH seat) opens two links for
 *     │ escortRegenMs and resets + pauses the charge
 *     └ charge fills only with all nodes live → boss FIRES its beam at the
 *       top-most live fleet ship (#27), marked by a pulsing crosshair
 *   win: boss HP 0 (railguns through web gaps) · lose: the beam takes the last ship
 *
 * Urgency = the charge bar racing you; co-op = needing both players to down an
 * escort and open a gap, then land railguns on the boss through it. A completed
 * charge hits a ship like a rock would: it pops the shield, or loses the ship
 * if the shield is already down (reuses the fleet's shields + regen).
 */
export const BOSS = {
  hp: 10, // charged railgun hits to destroy through shield-web gaps
  escortCount: 4,
  chargeMs: 5000, // time to open a gap before the boss fires (the urgency)
  escortRegenMs: 6000, // a downed web node returns with both co-op locks restored
  shieldRegenMs: 14000, // regen during the boss (the leak allowance)
} as const;

// ---- difficulty budget + solver (see docs/design.md §7 "Difficulty") ----
// threat = sum of clearDamage*speed/travel; leak = what shield regen forgives;
// required = threat - leak is THE scalar (damage/s). The solver INVERTS it: given a target required, pick knobs (in
// priority order) so threat meets the target.
// An approximation — consistency matters more than precision.

/** Average spawn -> shield-contact travel distance: from the mean spawn x to a
 *  fleet ship's bubble front (the rock's radius cancels). */
const TRAVEL_DIST = GAME_WIDTH + DIFFICULTY_MODEL.spawnGapMax / 2 - FLEET.bubbleFrontX;

/**
 * Gross accurate damage/s a concrete field demands, sustained.
 *
 * A splitter includes the threat of its two standard children (clearDamage):
 * three required damage total. The calibrated targets (0.30/0.45/0.60/0.75) stay as-is for the
 * first B37 phone playtest.
 */
function threatOf(specs: AsteroidSpec[]): number {
  return specs.reduce((sum, a) => sum + (clearDamage(a) * a.speed) / TRAVEL_DIST, 0);
}

/**
 * solveWave — realize a target `required` damage/s as a concrete field by
 * advancing knobs in priority order until threat reaches `required + leak`:
 *   1. (count)     streams minStreams -> maxStreams, weak + slow
 *   2. (speed)     speedScale minSpeedScale -> maxSpeedScale
 *   3. (toughness) replace standard rocks with `topKind` (slot order): a
 *      splitter by default, a two-hit rock in act 1's wave 2, none in wave 1
 * Greedy/discrete: stops at the first step that meets the target, or when
 * fully saturated (target unreachable — caller's dev log shows the gap).
 */
export function solveWave(required: number, leak: number, topKind: AsteroidKind = 'splitter'): AsteroidSpec[] {
  const M = DIFFICULTY_MODEL;
  const target = required + leak;
  let streams: number = M.minStreams;
  let speedScale: number = M.minSpeedScale;
  const kinds: AsteroidKind[] = ROCK_STREAMS.map(() => 'standard');

  const build = (): AsteroidSpec[] =>
    ROCK_STREAMS.slice(0, streams).map((stream, i) => ({
      kind: kinds[i],
      radius: ASTEROID_KIND[kinds[i]].radius,
      speed: stream.baseSpeed * speedScale,
    }));

  const met = () => threatOf(build()) >= target;
  // Priority waterfall: exhaust each tier before moving to the next.
  while (!met() && streams < M.maxStreams) streams++;
  while (!met() && speedScale < M.maxSpeedScale) {
    speedScale = Math.min(M.maxSpeedScale, speedScale + M.speedStep);
  }
  // Last lever: replace standards with the wave's toughest kind, in slot order.
  for (let i = 0; i < streams && topKind !== 'standard' && !met(); i++) {
    kinds[i] = topKind;
  }
  return build();
}

/** The asteroid field a wave fields — solved from its (player-count) target. */
export function asteroidsFor(wave: WaveConfig, players: 1 | 2): AsteroidSpec[] {
  return solveWave(waveTarget(wave, players), leakAllowancePerSec(wave), wave.topKind);
}

/** Accurate damage/s a wave actually demands (post-solve). */
export function threatDamagePerSec(wave: WaveConfig, players: 1 | 2): number {
  return threatOf(asteroidsFor(wave, players));
}

/** Damage/s (missed hits) the wave's shield regen forgives forever. */
export function leakAllowancePerSec(wave: WaveConfig): number {
  return wave.shieldRegenMs > 0 ? 1000 / wave.shieldRegenMs : 0;
}

/** THE difficulty scalar: accurate team damage/s actually required (achieved). */
export function requiredDamagePerSec(wave: WaveConfig, players: 1 | 2): number {
  return Math.max(0, threatDamagePerSec(wave, players) - leakAllowancePerSec(wave));
}

/** One seat's sustained damage ceiling: both ammo pools at their regen rates
 *  (FIRE rounds + SPECIAL missiles), one hit each. */
function seatDamagePerSec(): number {
  return (1000 / AMMO_REGEN_MS) * DAMAGE.fire + (1000 / SPECIAL.regenMs) * DAMAGE.missile;
}

/** Fraction of the players' damage ceiling (seats × seatDamagePerSec) that
 *  must land. */
export function breakEvenAccuracy(wave: WaveConfig, players: 1 | 2): number {
  return requiredDamagePerSec(wave, players) / (players * seatDamagePerSec());
}

// ---- ship waves (#27): the "if nobody shoots" check ----
// Every enemy bolt is unstoppable (#27 D10), so a ship wave's danger is how
// fast its bolts reach the fleet. The sanity check compares that against the
// asteroid waves the kids have already learned: the rate their rocks would
// reach the fleet if nobody shot any.

/** Bolts/s reaching the fleet if nobody shoots: each ship in play fires one per fireEveryMs. */
export function shipFleetHitsPerSec(ships: ShipWaveConfig): number {
  return (ships.onScreen * 1000) / ships.fireEveryMs;
}

/** Rocks/s reaching the fleet if nobody shoots: each stream fields a rock per
 *  trip (its speed over the spawn→bubble distance); a rock is one fleet hit
 *  whatever its hp. */
export function fieldFleetHitsPerSec(wave: WaveConfig, players: 1 | 2): number {
  return asteroidsFor(wave, players).reduce((sum, a) => sum + a.speed / TRAVEL_DIST, 0);
}

// ---- the mother jelly (#28): does it outlive an ignored brood? ----
// The design (#28 D6): the fight is shooting the mother while still
// intercepting her babies, so she must survive long enough that babies left
// alone would wipe the fleet. Both sides here are deliberately generous to the
// players: the fastest focus kill, and the slowest baby wipe.

/** Fleet hits that lose every ship (each ship: shield, then hull). */
const FLEET_HITS_TO_WIPE = 2 * 4;

/** A baby's trip from the mother's front to the fleet's bubble fronts, at its
 *  cruise speed (the straight-line part; it also climbs to its ship's row). */
function babyTravelMs(): number {
  return ((MOTHER_LAYOUT.x - MOTHER_LAYOUT.radius - FLEET.bubbleFrontX) / JELLY_LAYOUT.babySpeed) * 1000;
}

/** How long the mother's babies take to wipe the fleet if nobody shoots any:
 *  her entry, the releases until FLEET_HITS_TO_WIPE babies are out, and the
 *  last one's trip. */
export function babyWipeMs(): number {
  const releases = Math.ceil(FLEET_HITS_TO_WIPE / MOTHER.babiesPerRelease);
  return MOTHER_LAYOUT.enterMs + MOTHER.firstReleaseMs + (releases - 1) * MOTHER.releaseEveryMs + babyTravelMs();
}

/** The fastest the seats could kill her shooting nothing else: every round
 *  charged, every special a triple missile (the strongest special so far),
 *  starting from full ammo, with her heal never running (steady fire keeps it
 *  stopped). Normal seats; an Easy seat has no ammo limit. */
export function motherFocusKillMs(players: 1 | 2): number {
  const tripleDamage = 3 * DAMAGE.missile;
  const perSeat = (1000 / AMMO_REGEN_MS) * DAMAGE.charged + (1000 / SPECIAL.regenMs) * tripleDamage;
  const burst = players * (AMMO.max * DAMAGE.charged + SPECIAL.max * tripleDamage);
  return (Math.max(0, MOTHER.hp - burst) / (players * perSeat)) * 1000;
}
