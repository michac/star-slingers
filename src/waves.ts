/**
 * waves.ts — the difficulty dials. This is the one file to tune the run:
 * the per-wave targets (`WAVES`), the knob ranges the solver moves through
 * (`DIFFICULTY_MODEL`), the physical lanes (`LANE_SLOTS`), and the
 * budget/solver math that turns a target into a concrete asteroid field.
 *
 * The model (see spec.md §7 "Difficulty"): a wave is a TARGET — the net team
 * damage/s it should demand — and `solveWave` realizes it by advancing knobs in
 * priority order (count → speed → toughness) until the field's threat meets the
 * target. Every shot deals 1 damage today (`DAMAGE`), so damage/s == hits/s.
 * Geometry/paint live in layout.ts; this file only imports the few constants
 * the budget math needs.
 */
import { AMMO_REGEN_MS, GAME_WIDTH, SHIELD_RINGS, SPLITTER_CHILDREN, STATION } from './layout';

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

/** Damage per rocket hit, by shot type — the dial for future shot types
 *  (e.g. a railgun that hits harder). All 1 today, so every rock still pops on
 *  any hit and the solver's damage/s equals the old hits/s exactly. */
export const DAMAGE = {
  normal: 1,
  homing: 1,
  railgun: 1,
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
  required: number; // target net damage/s players must land (see spec.md §7)
  quota: number; // total asteroids this wave fields, then respawns stop
  shieldRegenMs: number; // a ring regrows after this long unhit; 0 = off
}

/**
 * The run: 4 escalating waves (boss B5 comes after, separately). Each wave
 * is just a target; solveWave() realizes it. Targets chosen so the waterfall
 * is visible AND each wave feels distinct (Playtest 3 fix: waves 1 & 2 used
 * to solve to near-identical all-1-hit fields). The shape (B32 floor raise —
 * every wave now runs 4 lanes @ max speed, splitter count is the ramp):
 *   W1 one splitter → W2/W3 two splitters → W4 three splitters.
 *   "Noticeably harder, still soloable": a skilled solo player can scrape W4
 *   (~75% accuracy) but two is comfy.
 * Tune by the dev boot log (target vs achieved + tier). Raise targets to add
 * more splitters; drop targets to soften. (The slow-lane
 * gentle lever is gone from W1 — the 5yo's cushion is homing (B8/B14), not
 * speed; if W1 is too steep for him, soften its target toward ~0.25.)
 */
export const WAVES: WaveConfig[] = [
  { required: 0.3, quota: 8, shieldRegenMs: 10000 },
  { required: 0.45, quota: 10, shieldRegenMs: 11000 },
  { required: 0.6, quota: 12, shieldRegenMs: 13000 },
  { required: 0.75, quota: 14, shieldRegenMs: 15000 },
];

/**
 * Solo (?players=1, #6 prototype slice) difficulty dial. A solo run fields the
 * same waves with each target scaled: `required × requiredScale`. Shipped at
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
 * Final boss (B5) BALANCE dials — the run's finale (geometry is in layout.ts).
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

// ---- difficulty budget + solver (see spec.md "Difficulty") ----
// threat = sum of clearDamage*speed/travel; leak = what shield regen forgives;
// required = threat - leak is THE scalar (damage/s; == hits/s while DAMAGE is
// all 1). The solver INVERTS it: given a target required, pick knobs (in
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

/** Fraction of the players' damage ceiling (seats × ammo rate × a normal
 *  shot's damage) that must land. */
export function breakEvenAccuracy(wave: WaveConfig, players: 1 | 2): number {
  return requiredDamagePerSec(wave, players) / (players * (1000 / AMMO_REGEN_MS) * DAMAGE.normal);
}
