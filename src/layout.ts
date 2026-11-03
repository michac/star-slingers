/**
 * layout.ts — geometry constants, ported 1:1 from the canonical v3 mock
 * (plans/mockups/style-wireframe.html, viewBox 360x740).
 */

export const GAME_WIDTH = 360;
export const GAME_HEIGHT = 740;

/** Launcher (each seat's rocket origin) geometry + shot speed. Every shot,
 *  plain, homing or railgun, leaves at `maxSpeed`. */
export const SLING = {
  anchorRadius: 6, // launcher base dot under the nocked rocket (mock: sling-anchor r=6)
  maxSpeed: 560, // rocket launch speed (px/s)
  trajectoryGap: 14, // the dotted aim line starts this far from the launcher (mock leaves a gap)
  trajectoryMax: 280, // aim line length
} as const;

/**
 * Charged shot (B13) — hold FIRE to power up a **railgun**: a full charge fires
 * a rocket that pierces straight through every asteroid in its path (chipping
 * each once) until it leaves the screen. Charge fills over `fullMs` of held
 * game time. The cue is a ring round the FIRE button that sweeps in the charge
 * violet, then breathes when armed (no text, orientation-neutral). All
 * code-drawn (Graphics), no postFX.
 */
export const CHARGE = {
  fullMs: 600, // hold FIRE this long to reach full charge
  // Armed "ready" pulse (sine off elapsed ms): a steady brightness breath on the
  // full charge-color ring so the player can see the shot is armed.
  pulseW: 0.012, // rad/ms (period ~520ms)
  armedPulseDepth: 0.25, // ± this fraction of the arc alpha at full charge
} as const;

export const P1_ANCHOR = { x: 180, y: 100 } as const; // top player
export const P2_ANCHOR = { x: 180, y: 640 } as const; // bottom player

/**
 * Homing (B14) — the 5yo fairness lever. A shot fired from HOME curves toward
 * the target it locked at fire. Tuning lives here, beside SLING (control feel is
 * a layout concern).
 */
export const HOMING = {
  // Target selection — used both at fire AND for the lock ring while HOME is held.
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
  // the target. Distance-based (not time) so it looks the same at any shot
  // speed. armFraction caps a shot's arm distance at this fraction of its
  // distance-to-target, so a closer lock still leaves runway to curve in and
  // connect (a long straight run never sails past a near target).
  armDistancePx: 140, // straight flight before any curving begins
  armFraction: 0.4, // …but never more than this share of the way to the target
  rampDistancePx: 120, // then ease the turn-rate in over this much more travel
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
 *  their x crosses this. (Kept <= 150 historically so the old smoke.mjs
 *  head-on hit test caught its target in lane phase.) */
export const APPROACH_X = 150;

/** Worried-shake tween on the station when a ring shatters. */
export const SHAKE = { amplitude: 3, durationMs: 60, repeats: 2 } as const;

/** Shatter tween for the lost ring (used by the shield REGROW cue; the
 *  destroy cue is now the SHIELD_FX flare-then-fade below). */
export const SHATTER = { scaleTo: 1.25, durationMs: 200 } as const;

/**
 * Shield FX (B22 glow + B23 pulse), ported 1:1 from the locked prototype
 * `prototype/reference/shield-pulse.ts`. Rings breathe on a sine (COLOR
 * brightness, never alpha — opaque thick strokes avoid the radial "grid"
 * spokes a semi-transparent ring shows at its tessellation joins) and FLOW
 * outer→inner via a per-ring phase offset, under an ambient glow that hugs +
 * recolors to the outermost remaining ring. A destroyed ring flares its glow
 * then expands + fades. Perf: no DPI, glow `quality` stays 0.3. (Ring width +
 * colors reuse STROKES.shield.width + the per-ring SHIELD_RINGS mapping.)
 */
export const SHIELD_FX = {
  periodMs: 3200, // ms per breath — slow
  pulseLo: 0.6, // trough brightness (crest is 1.0): a half-dim, still clearly lit
  glowQuality: 0.3, // glow bloom sample size — keep low; higher lags the Pixel 6
  // Destroyed ring: flare the glow bright (yoyo), then expand + fade away.
  flare: { strength: 11, flareMs: 150, fadeMs: 540, scaleTo: 1.45 },
} as const;

/**
 * Explosion (B29), ported from the locked prototype
 * `prototype/reference/explosion-lab.ts` — flash + shockwave + debris + sparks.
 * The reference was authored at its review-zoom (SCALE 2.5); the spatial dials
 * here are the reference values brought down to real game coordinates: particle
 * speed/scale/gravity and the shockwave stroke are ÷2.5, while flash/shockwave
 * radii size off the asteroid's REAL radius and the scale tweens (unitless
 * multipliers) port directly. The 2.5×→1× translation is the main tuning risk —
 * verify on the phone. Perf: one shared pair of emitters, one transient glow per
 * pop, glow `quality` 0.3. (Counts 12/28 from the reference.)
 */
export const EXPLOSION = {
  glowQuality: 0.3,
  depth: 50, // above asteroids/rockets, below the banner (900) / overlay (1000)
  // White core disc under a transient magenta glow that blows out fast.
  flash: { sizeFactor: 0.85, glowStrength: 6, scaleFrom: 0.3, scaleTo: 1.7, durationMs: 170 },
  // Thin magenta ring expanding + fading — the classic shock front.
  shockwave: { width: 1.5, alpha: 0.9, scaleFrom: 0.4, scaleTo: 2.4, durationMs: 360 }, // ref width 3 ÷2.5
  // Rock shards flung out, spinning, falling, fading (ref speed 70/250, scale 1.4/0.3, gravity 160).
  debris: {
    count: 12,
    speed: { min: 28, max: 100 }, // ÷2.5
    lifespan: { min: 450, max: 760 },
    scale: { start: 0.56, end: 0.12 }, // ÷2.5
    gravityY: 64, // ÷2.5
  },
  // White-hot additive sparks: fast, twinkling out (ref speed 140/430, scale 1.5).
  sparks: {
    count: 28,
    speed: { min: 56, max: 172 }, // ÷2.5
    lifespan: { min: 300, max: 560 },
    scale: { start: 0.6, end: 0 }, // ÷2.5
  },
} as const;

/**
 * Shot trail, ported 1:1 from the locked prototype
 * `prototype/reference/shot-trail.ts`. All additive filled quads — no postFX,
 * no particles. An `afterimage` (thin near-constant-width violet line over the
 * full ~75-pt history, fading to 0 along its length) under a tapered exhaust:
 * glow halo → violet body → white-hot core over the first ~18 points, with a
 * brightness `flux` (a sine scrolling down the trail). The trail widths are
 * absolute px in the reference (NOT multiplied by its demo zoom), so they port
 * directly; verify against the game's real rocket speed. EXHAUST = the violet
 * COLORS.shieldMid (the head stays the rocket sprite's player color).
 */
export const TRAIL = {
  trailLen: 18, // bright exhaust ribbon length (points)
  bodyHalf: 7,
  bodyAlpha: 0.7,
  glowMul: 2.3,
  glowAlpha: 0.14,
  coreHalf: 2.3,
  coreAlpha: 0.85,
  afterLen: 75, // afterimage history length (~1.2s at 60fps)
  afterHalf: 1.0, // thin, near-constant-width line
  afterAlpha: 0.22, // faint at the head, fading to 0 down the path
  // Brightness flux: a wave scrolling down the exhaust → pulsing bands.
  fluxW: 0.026, // rad/ms (period ~240ms)
  fluxPhase: 0.55,
  bodyFlux: 0.5,
  coreFlux: 0.55,
  wrapSkip: 60, // skip a segment longer than this (a homing re-aim / recycle teleport)
  // Per-rocket TIER multipliers (B13). The absolute values above are the
  // CHARGED (railgun) baseline — exactly the locked shot-trail look; a normal
  // uncharged shot gets a subdued version (less alpha, shorter ribbon), so the
  // in-flight trail doubles as the "this was a railgun" read.
  chargedMul: { alpha: 1, len: 1, width: 1 }, // == the current look
  normalMul: { alpha: 0.45, len: 0.65, width: 0.9 }, // subdued
} as const;

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
  enterFromX: GAME_WIDTH + 70, // starts off the right edge, slides to park.x
  enterMs: 1900, // slower, more menacing entrance (was 1100 — too fast on the phone)
  escort: {
    radius: 17, // collision + orbit size
    formationRadius: 92, // fixed clearance: the rotating shield web never clips the boss
    orbitSpeedDeg: 20, // the diamond formation rotates as one unit
    webWidth: 2.5, // stroke + collision width of each shield-web link (B34)
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
// in waves.ts — that's the one file to tune the run. See docs/design.md §7.

/**
 * Controls v2 (#7): two-thumb drag aim + fire buttons. ALL control geometry
 * lives here.
 *
 * Written in the BOTTOM seat's (P2's) frame, as screen coords for P2:
 *
 *    [FIRE]  [HOME]     (launcher)      ( aim pad )
 *    player's left     P2_ANCHOR        player's right
 *
 * P1 (top edge) is the same layout rotated 180° about the field centre, i.e.
 * (x, y) → (GAME_WIDTH − x, GAME_HEIGHT − y); P2_ANCHOR maps onto P1_ANCHOR. A
 * `?lefty` seat mirrors x within its own frame (x → GAME_WIDTH − x) BEFORE that
 * rotation: aim zone + pad on the player's left, buttons on their right. Aim
 * directions are not mirrored.
 *
 * Aim angle (seat frame): 0° = toward the player's right, 90° = straight across
 * the field at the other player, 180° = toward the player's left.
 *
 * Clearances (checked against the trajectory at the aim clamps, 15°/165°, from
 * the launcher at (180,640)): the line passes 2px outside HOME and ~20px above
 * the pad; FIRE/HOME centres are 74 apart (gap 11); HOME's right edge is 145
 * and the pad's left edge 254, which bracket the HUD column (x 150..~250 with a
 * 4-digit score). Controls stay below y≈625, well under the lanes (y≤480).
 * Sized for small thumbs; exact numbers are for tuning on the phone.
 */
export const CONTROLS_V2 = {
  /** Big round FIRE button (hold to charge the railgun, release to fire). */
  fire: { x: 52, y: 682, r: 38 },
  /** Smaller round HOME button beside FIRE, a little higher and inward. */
  home: { x: 120, y: 652, r: 25 },
  /** Touch slop outside a button's drawn radius (a down in the overlap goes
   *  to the button whose centre is nearer, relative to its radius). */
  buttonHitPad: 5,
  /** Gap between a button's edge and its charge ring. */
  chargeRingGap: 5,
  /** Aim pad: the aim zone's visual (a disc with a ◀ ▶ hint, the range arc
   *  just outside, and a knob `knobFrac` of the way out along the current aim).
   *  Touch goes by the whole `drag` zone below, not the disc. */
  pad: { x: 300, y: 678, r: 46, knobR: 9, knobFrac: 0.62 },
  /** Aim zone: a thumb anywhere here (seat-frame x ≥ minX, y ≥ minY: the
   *  player's right side of their band) turns the aim by sideways motion.
   *  0.8°/px sweeps the whole 150° clamp in ~190 units (~4cm). */
  drag: { minX: 165, minY: 540, gainDegPerPx: 0.8 },
  /** Aim clamp (seat-frame degrees) + the boot aim (straight across). */
  aim: { minDeg: 15, maxDeg: 165, startDeg: 90 },
  /** Nocked-rocket draw-back along −aim: FIRE eases to `pullBack` with the
   *  charge (from `pullBackMinFrac`); HOME holds at `homePullBack`. */
  pullBack: 12,
  pullBackMinFrac: 0.3,
  homePullBack: 6,
  /** Resting trajectory alpha, as a fraction of STROKES.trajectory.alpha (it
   *  brightens to full while the seat aims or holds a button). */
  trajectoryRestFrac: 0.35,
  /** HUD group origin under the launcher (rows run +x/+y from here, see
   *  HUD_ROWS): below the nocked rocket's furthest draw-back (y≈659), between
   *  HOME and the pad. `hudLefty` shifts it left to clear the mirrored HOME
   *  (x≥215) while staying right of the mirrored pad's range arc (x≤111). */
  hud: { x: 150, y: 670 },
  hudLefty: { x: 116, y: 670 },
} as const;

/** Phone vibration (#3), in ms; values accepted on the Pixel 6: a buzz
 *  per shot fired (FIRE or HOME) and a tick the moment FIRE is fully charged
 *  with ammo to fire. Pulses of 15ms or less can be imperceptible on some
 *  Android motors. See src/haptics.ts. */
export const HAPTICS = {
  shotMs: 20,
  homingMs: 25,
  railgunMs: 40,
  armedMs: 20,
} as const;

/** Mock HUD group row offsets (local y): WAVE 0, SCORE 20, AMMO 40. */
export const HUD_ROWS = {
  wave: 0,
  score: 20, // built in B6
  ammo: 40,
} as const;

/**
 * Scoring presentation — standards score 10 and splitters score 20 immediately;
 * their two children score 10 each. The popup grows-and-fades in place (orientation-neutral so it
 * reads the same from both seats); the HUD number is the canonical read.
 */
export const SCORE = {
  standard: 10,
  splitter: 20,
  popup: { riseScale: 1.4, durationMs: 650, fontPx: 18 }, // floating "+N"
} as const;

/**
 * Splitter children (B37) — one rocket breaks a large splitter into two
 * standard-size children. They funnel toward the station like mini-asteroids (the
 * existing funnel + station-contact + left-exit logic all engage), threaten a
 * shield ring (a self-balancing "winning tax"), and score their own standard
 * pop (10 pts each). Only rocket-kills split; a rock that reaches the station never does.
 *
 * Children live as pre-allocated wrappers appended to the asteroid pool (so
 * the rocket→asteroid collider, built once, covers them); they differ from
 * lane rocks only in being one-shot (no respawn) and fielded at a position
 * with a scatter velocity rather than off the right edge.
 */
export const SPLITTER_CHILDREN = {
  poolSize: 6, // pre-allocated child wrappers (graceful degrade if exhausted)
  count: 2, // children per splitter
  launchSpeed: 90, // initial scatter burst (px/s)
  childSpeed: 45, // post-funnel cruise toward the station (~ a slow lane rock)
  scatterConeDeg: 70, // total spread of the 2 children...
  scatterCenterDeg: 180, // ...centered LEFTWARD (toward the station, -x)
  spawnGraceMs: 100, // body disabled on spawn (railgun/fresh-pop guard)
  lifetimeMs: 6000, // hard cap — guarantees the wave can always clear
} as const;

/**
 * Wave-clear star-shower (B7 visual): confetti rains down across the field's
 * top on every wave clear. One persistent ADD-blend emitter (created once in
 * Explosions, never per-event); tints are sourced from tokens.ts inside
 * Explosions per the "all color comes from tokens" rule.
 */
export const STAR_SHOWER = {
  count: 90, // total particles per shower, spread across the X positions
  lifespan: { min: 1100, max: 1800 }, // long fall — confetti drifts the field
  speed: { min: 40, max: 130 }, // initial spread before gravity takes over
  angleDeg: { min: 55, max: 125 }, // downward fan (Phaser: 90 = straight down)
  gravityY: 140, // pulls the confetti down the field
  scale: { start: 0.85, end: 0.2 },
  // X positions across the field's top where bursts seed (y just above frame).
  spreadX: [40, 100, 160, 220, 280, 330] as const,
  seedY: -8,
} as const;

export const AMMO = {
  max: 5,
  // regen interval is the global AMMO_REGEN_MS — deliberately not per-wave
  labelOffsetX: 0, // row label, mock local x=0
  valueOffsetX: 46, // row value, mock local x=46
} as const;
