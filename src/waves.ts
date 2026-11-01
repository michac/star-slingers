/**
 * waves.ts — the difficulty dials. This is the one file to tune the run:
 * the per-wave targets (`WAVES`), the knob ranges the solver moves through
 * (`DIFFICULTY_MODEL`), the physical lanes (`LANE_SLOTS`), and the
 * budget/solver math that turns a target into a concrete asteroid field.
 *
 * The model (see spec.md §7 "Difficulty"): a wave is a TARGET — the net team
 * hits/s it should demand — and `solveWave` realizes it by advancing knobs in
 * priority order (count → speed → toughness) until the field's threat hits the
 * target. Geometry/paint live in layout.ts; this file only imports the few
 * constants the budget math needs.
 */
import { AMMO_REGEN_MS, GAME_WIDTH, SHIELD_RINGS, STATION } from './layout';

export interface AsteroidSpec {
  kind: AsteroidKind;
  radius: number;
  y: number; // drift lane, kept clear of both sling zones
  speed: number; // px/s, right -> left
}

/** A splitter takes one rocket hit, then adds two standard children: three
 * required hits to clear it completely. */
export type AsteroidKind = 'standard' | 'splitter';
export const ASTEROID_KIND = {
  standard: { radius: 13, threatHits: 1 },
  splitter: { radius: 17, threatHits: 3 },
} as const satisfies Record<AsteroidKind, { radius: number; threatHits: number }>;

/** Physical lanes — position + base speed only. Toughness and size are NOT
 *  fixed here; the solver assigns them per wave. The floor (minLanes) uses
 *  the first lanes, so order them well-spread and clear of the sling zones. */
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

/** A wave is just its difficulty TARGET (required team hits/s — the budget
 *  scalar, now the input) plus length (quota) and shield regen. The solver
 *  derives the asteroid composition. */
export interface WaveConfig {
  required: number; // target net hits/s players must land (see spec.md §7)
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

/** Breather between waves: celebration beat + shield restore + banner. */
export const BREATHER = {
  ringRestoreStaggerMs: 300, // rings regrow one-by-one at this spacing
  bannerMs: 2200, // how long the next-wave banner holds
} as const;

/**
 * Final boss (B5) BALANCE dials — the run's finale (geometry is in layout.ts).
 * A repeating, urgent CYCLE (reworked 2026-06-09 from the flat two-phase fight):
 *
 *   CHARGING: four escorts rotate a physical shield web around the boss.
 *     ├ a downed escort opens two links for escortRegenMs and pauses charge
 *     └ charge fills only with all nodes live → boss FIRES (−1 shield ring)
 *   win: boss HP 0 (chipped across windows) · lose: shield gone when it fires
 *
 * Urgency = the charge bar racing you; co-op = needing both slings to clear the
 * every gap to land railguns on the boss while keeping the charge paused. A
 * completed charge shatters a ring (reuses the wave shield + regen).
 */
export const BOSS = {
  hp: 10, // charged railgun hits to destroy through shield-web gaps
  escortCount: 4,
  escortHits: 2, // one unique contribution from each player
  chargeMs: 5000, // time to clear the escorts before the boss fires (the urgency)
  exposedMs: 6000, // legacy cycle dial; retired when the shield-web mechanic lands
  escortRegenMs: 6000, // a downed web node returns with both co-op locks restored
  shieldRegenMs: 14000, // regen during the boss (the leak allowance)
} as const;

// ---- difficulty budget + solver (see spec.md "Difficulty") ----
// threat = sum of hits*speed/travel; leak = what shield regen forgives;
// required = threat - leak is THE scalar. The solver INVERTS it: given a
// target required, pick knobs (in priority order) so threat hits the target.
// An approximation — consistency matters more than precision.

/** Average spawn -> shield-contact travel distance (lane radius cancels). */
const TRAVEL_DIST = GAME_WIDTH + DIFFICULTY_MODEL.spawnGapMax / 2 - (STATION.cx + SHIELD_RINGS[0]);

/**
 * Gross accurate hits/s a concrete field demands, sustained.
 *
 * A splitter includes the threat of its two standard children: three required
 * hits total. The calibrated targets (0.30/0.45/0.60/0.75) stay as-is for the
 * first B37 phone playtest.
 */
function threatOf(specs: AsteroidSpec[]): number {
  return specs.reduce((sum, a) => sum + (ASTEROID_KIND[a.kind].threatHits * a.speed) / TRAVEL_DIST, 0);
}

/**
 * solveWave — realize a target `required` hits/s as a concrete field by
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

/** The asteroid field a wave fields — solved from its target. */
export function asteroidsFor(wave: WaveConfig): AsteroidSpec[] {
  return solveWave(wave.required, leakAllowancePerSec(wave));
}

/** Accurate hits/s a wave actually demands (post-solve). */
export function threatHitsPerSec(wave: WaveConfig): number {
  return threatOf(asteroidsFor(wave));
}

/** Hits/s the wave's shield regen forgives forever. */
export function leakAllowancePerSec(wave: WaveConfig): number {
  return wave.shieldRegenMs > 0 ? 1000 / wave.shieldRegenMs : 0;
}

/** THE difficulty scalar: accurate team hits/s actually required (achieved). */
export function requiredHitsPerSec(wave: WaveConfig): number {
  return Math.max(0, threatHitsPerSec(wave) - leakAllowancePerSec(wave));
}

/** Fraction of the two players' ammo ceiling that must land. */
export function breakEvenAccuracy(wave: WaveConfig): number {
  return requiredHitsPerSec(wave) / (2 * (1000 / AMMO_REGEN_MS));
}
