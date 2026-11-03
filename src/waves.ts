/**
 * waves.ts — the difficulty dials. This is the one file to tune the run:
 * the run (`RUN`: 10 waves in 4 acts, each wave's kind and targets), the knob ranges the solver moves through
 * (`DIFFICULTY_MODEL`), the physical lanes (`LANE_SLOTS`), and the
 * budget/solver math that turns a target into a concrete asteroid field.
 *
 * The model (see docs/design.md §7 "Difficulty"): a wave is a TARGET — the net team
 * damage/s it should demand — and `solveWave` realizes it by advancing knobs in
 * priority order (count → speed → toughness) until the field's threat meets the
 * target. Damage per shot is `DAMAGE`; every rock is 1 hp today, so damage/s == kills/s.
 * Geometry/paint live in layout.ts; this file only imports the few constants
 * the budget math needs.
 */
import { AMMO_REGEN_MS, GAME_WIDTH, SHIELD_RINGS, SPECIAL, SPLITTER_CHILDREN, STATION } from './layout';

export interface AsteroidSpec {
  kind: AsteroidKind;
  radius: number;
  y: number; // drift lane, kept clear of both seats' control bands
  speed: number; // px/s, right -> left
  /** Max hp override (tests / future tuning); defaults to ASTEROID_KIND[kind].hp. */
  hp?: number;
}

/** Both kinds pop on one point of damage today. A splitter then adds two
 * standard children, so clearing it completely takes 3 damage (clearDamage). */
export type AsteroidKind = 'standard' | 'splitter';
export const ASTEROID_KIND = {
  standard: { radius: 13, hp: 1 },
  splitter: { radius: 17, hp: 1 },
} as const satisfies Record<AsteroidKind, { radius: number; hp: number }>;

/** Damage per rocket hit, by shot type (#22): a plain FIRE round, a charged
 *  FIRE round (the railgun: double damage, and it carries on past a target only
 *  if this hit kills it), and the SPECIAL homing missile. Every rock is 1 hp
 *  today, so a charged round's second point is overkill on a rock and the
 *  solver's per-kill damage is unchanged. */
export const DAMAGE = {
  fire: 1,
  charged: 2,
  missile: 1,
} as const;

/** A rock's max hp: its spec override, else its kind's default. */
export function maxHpOf(spec: AsteroidSpec): number {
  return spec.hp ?? ASTEROID_KIND[spec.kind].hp;
}

/** Total damage to clear a rock completely — a splitter includes the hp of the
 *  standard children it releases (1 + 2 × 1 = 3 today). */
export function clearDamage(spec: AsteroidSpec): number {
  const children = spec.kind === 'splitter' ? SPLITTER_CHILDREN.count * ASTEROID_KIND.standard.hp : 0;
  return maxHpOf(spec) + children;
}

/** Physical lanes — position + base speed only. Toughness and size are NOT
 *  fixed here; the solver assigns them per wave. The floor (minLanes) uses
 *  the first lanes, so order them well-spread and clear of the control bands. */
export const LANE_SLOTS: { y: number; baseSpeed: number }[] = [
  { y: 300, baseSpeed: 40 },
  { y: 215, baseSpeed: 50 },
  { y: 390, baseSpeed: 55 },
  { y: 480, baseSpeed: 65 },
];

/**
 * The difficulty model: knob ranges the solver moves through, in priority
 * order count -> speed -> toughness (gentlest lever first; toughness, the
 * most frustrating for the 5yo, last). spawnGapMax is global here — it's
 * downtime texture, not a primary difficulty lever.
 */
export const DIFFICULTY_MODEL = {
  minLanes: 3, // the always-on "minimum asteroid rate" floor
  maxLanes: 4,
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
  shieldRegenMs: number; // a ring regrows after this long unhit; 0 = off
}

/** The run's four acts: 1 asteroids, 2 ships, 3 space monsters, 4 the finale. */
export type Act = 1 | 2 | 3 | 4;

/** What a wave fields. Each kind gets its real content from its act's issue
 *  (#25 asteroids, #27 ships, #28 monsters); until then a `placeholder` wave
 *  plays as a solver asteroid field. */
export type WaveKind = 'asteroid' | 'ship' | 'monster' | 'boss' | 'finale';

/** Which boss a `boss` wave is: the giant asteroid ends act 1, the command
 *  ship (BOSS below, docs/design.md §9) ends act 2, the monster boss act 3. */
export type BossId = 'giantAsteroid' | 'commandShip' | 'monsterBoss';

/** One wave of the run. A wave with a `field` is played by the difficulty
 *  solver (an asteroid field today); the command ship has none and is played
 *  by the BossEncounter with the BOSS dials. */
export interface RunWave {
  act: Act;
  kind: WaveKind;
  boss?: BossId;
  field?: WaveConfig;
  /** Plays as an asteroid field until its act's issue builds the real content. */
  placeholder?: true;
}

/**
 * THE RUN — 10 waves in 4 acts, in play order (docs/design.md §3). Every dial
 * for the run lives here so each act's issue retunes it in one place.
 *
 * Targets: each act eases back a step from the last one's peak, then climbs.
 * The act-1 targets are the calibrated ones from Playtest 3 / B37 (W1 one
 * splitter → W2/W3 two; the 5yo's cushion is homing, not speed: if W1 plays
 * too steep, soften its target toward ~0.25). The rest are placeholders,
 * revisable in playtest. Tune by the dev boot log (target vs achieved + tier).
 *
 * The finale is a long, dense, forgiving wave to blast with every upgrade:
 * its target solves to all four lanes as splitters at max speed, with a big
 * quota and a quick shield regen.
 */
export const RUN: readonly RunWave[] = [
  { act: 1, kind: 'asteroid', field: { required: 0.3, quota: 8, shieldRegenMs: 10000 } },
  { act: 1, kind: 'asteroid', field: { required: 0.45, quota: 10, shieldRegenMs: 11000 } },
  { act: 1, kind: 'boss', boss: 'giantAsteroid', placeholder: true, field: { required: 0.6, quota: 12, shieldRegenMs: 13000 } },
  { act: 2, kind: 'ship', placeholder: true, field: { required: 0.45, quota: 10, shieldRegenMs: 11000 } },
  { act: 2, kind: 'ship', placeholder: true, field: { required: 0.6, quota: 12, shieldRegenMs: 13000 } },
  { act: 2, kind: 'boss', boss: 'commandShip' },
  { act: 3, kind: 'monster', placeholder: true, field: { required: 0.6, quota: 12, shieldRegenMs: 13000 } },
  { act: 3, kind: 'monster', placeholder: true, field: { required: 0.75, quota: 14, shieldRegenMs: 15000 } },
  { act: 3, kind: 'boss', boss: 'monsterBoss', placeholder: true, field: { required: 0.75, quota: 14, shieldRegenMs: 15000 } },
  { act: 4, kind: 'finale', field: { required: 0.9, quota: 24, shieldRegenMs: 8000 } },
];

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

/** Breather between waves: celebration beat + shield restore + banner. */
export const BREATHER = {
  ringRestoreStaggerMs: 300, // rings regrow one-by-one at this spacing
  bannerMs: 2200, // how long the next-wave banner holds
} as const;

/**
 * Command-ship boss (B5) BALANCE dials — wave 6, act 2's boss (geometry is in layout.ts).
 * One continuous CHARGING phase (B34 shield web):
 *
 *   CHARGING: four escorts rotate a physical shield web around the boss.
 *     ├ a downed escort (one hit from EACH seat) opens two links for
 *     │ escortRegenMs and resets + pauses the charge
 *     └ charge fills only with all nodes live → boss FIRES (−1 shield ring)
 *   win: boss HP 0 (railguns through web gaps) · lose: shield gone when it fires
 *
 * Urgency = the charge bar racing you; co-op = needing both players to down an
 * escort and open a gap, then land railguns on the boss through it. A completed
 * charge shatters a ring (reuses the wave shield + regen).
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
// required = threat - leak is THE scalar (damage/s; == kills/s while every
// rock is 1 hp). The solver INVERTS it: given a target required, pick knobs (in
// priority order) so threat meets the target.
// An approximation — consistency matters more than precision.

/** Average spawn -> shield-contact travel distance (lane radius cancels). */
const TRAVEL_DIST = GAME_WIDTH + DIFFICULTY_MODEL.spawnGapMax / 2 - (STATION.cx + SHIELD_RINGS[0]);

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
 *   1. (count)     lanes minLanes -> maxLanes, weak + slow
 *   2. (speed)     speedScale minSpeedScale -> maxSpeedScale
 *   3. (splitters) replace standard rocks with splitters (slot order)
 * Greedy/discrete: stops at the first step that meets the target, or when
 * fully saturated (target unreachable — caller's dev log shows the gap).
 */
export function solveWave(required: number, leak: number): AsteroidSpec[] {
  const M = DIFFICULTY_MODEL;
  const target = required + leak;
  let lanes: number = M.minLanes;
  let speedScale: number = M.minSpeedScale;
  const kinds: AsteroidKind[] = LANE_SLOTS.map(() => 'standard');

  const build = (): AsteroidSpec[] =>
    LANE_SLOTS.slice(0, lanes).map((slot, i) => ({
      kind: kinds[i],
      radius: ASTEROID_KIND[kinds[i]].radius,
      y: slot.y,
      speed: slot.baseSpeed * speedScale,
    }));

  const met = () => threatOf(build()) >= target;
  // Priority waterfall: exhaust each tier before moving to the next.
  while (!met() && lanes < M.maxLanes) lanes++;
  while (!met() && speedScale < M.maxSpeedScale) {
    speedScale = Math.min(M.maxSpeedScale, speedScale + M.speedStep);
  }
  // Last lever: replace standards with splitters, in slot order.
  for (let i = 0; i < lanes && !met(); i++) {
    kinds[i] = 'splitter';
  }
  return build();
}

/** The asteroid field a wave fields — solved from its (player-count) target. */
export function asteroidsFor(wave: WaveConfig, players: 1 | 2): AsteroidSpec[] {
  return solveWave(waveTarget(wave, players), leakAllowancePerSec(wave));
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
