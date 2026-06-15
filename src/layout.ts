/**
 * layout.ts — geometry constants, ported 1:1 from the canonical v3 mock
 * (plans/star-slingers/mockups/style-wireframe.html, viewBox 360x740).
 */

export const GAME_WIDTH = 360;
export const GAME_HEIGHT = 740;

/** Sling control geometry + tuning. */
export const SLING = {
  pullRadius: 70, // mock: A70 70 range arc
  grabRadius: 48, // touch slop around the anchor that claims a pointer
  anchorRadius: 6, // mock: sling-anchor r=6
  touchDotRadius: 9, // mock: sling-touch r=9
  maxSpeed: 560, // rocket speed (px/s) at a full pull
  minSpeed: 120, // floor so tiny pulls still launch, not dribble
  minFirePull: 12, // pulls shorter than this cancel instead of firing
  trajectoryGap: 14, // preview starts this far from the anchor (mock leaves a gap)
  trajectoryMax: 280, // preview length at a full pull
} as const;

export const P1_ANCHOR = { x: 180, y: 100 } as const; // top player
export const P2_ANCHOR = { x: 180, y: 640 } as const; // bottom player

/**
 * Homing mode (B14) — the 5yo fairness lever. A per-player toggle next to the
 * sling makes that player's shots curve toward a locked target. Tuning + the
 * toggle geometry live here, beside SLING (control feel is a layout concern).
 */
export const HOMING = {
  // Target selection — used both at fire AND for the aim-preview highlight.
  // Tight on purpose: you must aim fairly close to a rock to lock/highlight it.
  coneHalfAngleDeg: 25, // the launch ray must point within this of the target
  maxRange: 520, // ignore targets farther than this along the ray
  maxPerp: 50, // AND the ray must pass within this many px of the rock's center
  ringPad: 6, // aim-highlight ring sits this far outside the locked rock
  // Steering. The design (Michael, 2026-06-09): a shot only homes if it LOCKED
  // a target at fire (no lock → ordinary straight shot), and a lock should
  // CONNECT — so the turn-rate is cranked high. The challenge lives in earning
  // the lock (the tight cone/maxPerp above), not in the flight.
  turnRateDeg: 600, // max deg/sec the velocity may rotate toward the target
  // Delayed + eased curve so homing reads as a deliberate "smart rocket": the
  // shot flies STRAIGHT for the arm distance (a long, obvious straight run),
  // then the turn-rate ramps 0→full over the next rampDistancePx and snaps onto
  // the target. Distance-based (not time) so it looks the same at any pull
  // strength. armFraction caps a shot's arm distance at this fraction of its
  // distance-to-target, so a closer lock still leaves runway to curve in and
  // connect (a long straight run never sails past a near target).
  armDistancePx: 140, // straight flight before any curving begins
  armFraction: 0.4, // …but never more than this share of the way to the target
  rampDistancePx: 120, // then ease the turn-rate in over this much more travel
  // Toggle UI, mirrored per seat (P1 sits at the top edge, rotated 180).
  // offset 125 centers it in the gap between the pull arc (anchor ± r=70) and
  // the screen edge: P2 at x=305 (sling edge 250 ↔ screen 360), P1 mirrored at
  // x=55 — both clear of the sling and the HUD columns (344 / 16).
  toggle: { offsetX: 125, width: 46, height: 22, knobR: 9, hitPad: 14 },
} as const;

/** Star backdrop, exact positions from the mock's <g class="stars">. */
export const STARS = [
  { x: 220, y: 120, r: 1.4 },
  { x: 300, y: 110, r: 1 },
  { x: 330, y: 360, r: 1.6 },
  { x: 250, y: 640, r: 1 },
  { x: 200, y: 560, r: 1.2 },
  { x: 320, y: 540, r: 1 },
  { x: 160, y: 380, r: 1.1 },
  { x: 290, y: 270, r: 1.3 },
] as const;

/**
 * Station geometry, ported from the v5 mock: hull mostly off-screen left,
 * only a sliver + the shield rings poke into the field.
 */
export const STATION = {
  cx: -10, // mock: hull cx=-10
  cy: 370,
  hullR: 24, // mock: hull r=24
  windows: [
    { x: 5, y: 361, r: 2.5 },
    { x: 3, y: 383, r: 2 },
  ],
  shieldHp: 3,
} as const;

/**
 * Shield = 3 concentric rings, outermost first; each ring is 1 HP and the
 * outermost remaining one shatters on contact. (Decided 2026-06-06 —
 * supersedes the mock's 3-segments-along-the-arc: segments imply a
 * positional weak spot the player can't control.)
 */
export const SHIELD_RINGS = [46, 39, 32] as const;

/** Where the funnel turn happens: asteroids re-aim at the station once
 *  their x crosses this. Keep <= 150 so smoke.mjs's head-on hit test still
 *  catches its target in lane phase. */
export const APPROACH_X = 150;

/** Worried-shake tween on the station when a ring shatters. */
export const SHAKE = { amplitude: 3, durationMs: 60, repeats: 2 } as const;

/** Shatter tween for the lost ring. */
export const SHATTER = { scaleTo: 1.25, durationMs: 200 } as const;

/** End-of-round overlays (fail "Try again?" and victory "You did it!"):
 *  calm dim + an opaque modal card + a central icon (reads either way up).
 *  The card hides field clutter behind the UI. */
export const OVERLAY = {
  iconR: 60,
  center: { x: 180, y: 370 },
  dimAlpha: 0.7,
  panel: { w: 230, h: 300, radius: 16 },
} as const;

/** Wave banner: big mirrored numeral at field center between waves. */
export const BANNER = {
  center: { x: 180, y: 370 },
  // Each seat's copy sits this far from center — wide enough to land in that
  // player's half (matches the overlay card gap); at 28 they overlapped.
  numeralOffsetY: 94,
  fadeMs: 250,
} as const;

/** Explicit render depths for late-created UI (creation order isn't enough:
 *  the WaveDirector creates asteroids AFTER the overlays exist). */
export const DEPTHS = { banner: 900, overlay: 1000 } as const;

/** Victory-card icon: a star burst — celebratory and symmetric, so it
 *  reads the same from both seats. Offsets are local to the card center. */
export const VICTORY_ICON = {
  starR: 38,
  starInnerRatio: 0.45,
  sparkles: [
    { x: -62, y: -48, r: 3 },
    { x: 58, y: -56, r: 2.5 },
    { x: 70, y: 30, r: 3 },
    { x: -70, y: 40, r: 2.5 },
    { x: 0, y: 72, r: 2 },
    { x: -6, y: -76, r: 2 },
  ],
} as const;

/**
 * Final boss (B5) GEOMETRY. The boss slides in from the right and parks at
 * center — fully on screen, equidistant from both seats — and is stationary
 * while battling. 4 escorts slowly orbit it at a radius kept OUTSIDE the boss
 * so the whole boss stays visible. Balance dials (HP, charge rate) live in
 * waves.ts; this block is positions/sizes only. (`park.x` is tunable
 * left-of-center; the orbit must clear the station shield at x≤46.)
 */
export const BOSS_LAYOUT = {
  park: { x: 180, y: 370 }, // center; both seats reach it
  radius: 32, // big but fully on screen (orbit extent stays < field edges)
  shieldRingPad: 9, // the boss's own "invulnerable" shield ring sits this far out
  chargeArcWidth: 5, // the filling charge telegraph drawn just outside the shield ring
  enterFromX: GAME_WIDTH + 70, // starts off the right edge, slides to park.x
  enterMs: 1900, // slower, more menacing entrance (was 1100 — too fast on the phone)
  escort: {
    radius: 17, // outer SHIELD radius (collision + orbit size)
    coreRadius: 10, // the bare core once the shield ring is knocked off
    orbitRadius: 62, // > boss radius (32) so escorts never occlude the boss
    orbitSpeedDeg: 22, // slow spin (deg/sec)
  },
  // Two vertical gauges (HEALTH + CHARGE) live in the empty band to the boss's
  // right (boss right edge ~212 → screen edge 360), evenly spaced. Each bar
  // fills bottom-up and is capped by a heart / bolt icon at both ends (the top
  // copy rotated 180° so it reads from the top seat).
  bars: {
    width: 16,
    top: 224, // track top y (track is centered on park.y=370, ~292 tall)
    bottom: 516, // track bottom y
    health: { x: 259 }, // inner bar (nearer the boss)
    charge: { x: 313 }, // outer bar
    labelPad: 18, // icon center sits this far beyond each bar end
    iconSize: 16, // icon texture is iconSize x iconSize
  },
} as const;

/** Ammo regen is global — it deliberately does NOT escalate with waves.
 *  (Lives here, not in waves.ts, because it's an ammo/HUD constant; waves.ts
 *  imports it for the break-even math.) */
export const AMMO_REGEN_MS = 1000;

// Wave targets, the difficulty model, lanes, and the budget/solver math live
// in waves.ts — that's the one file to tune the run. See spec.md §7.

/**
 * Per-player HUD anchors = the mock HUD GROUP origins (rows are laid out at
 * the mock's local offsets inside one rotated container). P1's group is at
 * (344,85) rotate(180), so all its rows render upside-down for the player
 * at the top edge; P2's group is at (16,655) unrotated.
 */
export const HUD_P1 = { x: 344, y: 85, angle: 180 } as const;
export const HUD_P2 = { x: 16, y: 655, angle: 0 } as const;

/** Mock HUD group row offsets (local y): WAVE 0, SCORE 20, AMMO 40. */
export const HUD_ROWS = {
  wave: 0,
  score: 20, // reserved — built in B6
  ammo: 40,
} as const;

export const AMMO = {
  max: 5,
  // regen interval is the global AMMO_REGEN_MS — deliberately not per-wave
  labelOffsetX: 0, // row label, mock local x=0
  valueOffsetX: 46, // row value, mock local x=46
} as const;
