/**
 * layout.ts — geometry constants, ported 1:1 from the canonical v3 mock
 * (plans/mockups/style-wireframe.html, viewBox 360x740).
 */

export const GAME_WIDTH = 360;
export const GAME_HEIGHT = 740;

/** Launcher (each seat's rocket origin) geometry + shot speed. Every FIRE
 *  round, plain or charged, leaves at `maxSpeed` (the missile has its own
 *  `MISSILE.speed`). */
export const SLING = {
  anchorRadius: 6, // launcher base dot under the nocked rocket (mock: sling-anchor r=6)
  maxSpeed: 560, // rocket launch speed (px/s)
  trajectoryGap: 14, // the dotted aim line starts this far from the launcher (mock leaves a gap)
  trajectoryMax: 280, // aim line length
} as const;

/**
 * Charged shot (#22) — FIRE is the railgun. Hold it to a full charge for a
 * charged round: double damage (`DAMAGE.charged`), and it carries on along its
 * line past a target only if that hit kills it; it stops in anything it doesn't
 * kill. Charge fills over `fullMs` of held game time. The cue is a ring round the FIRE button that sweeps in the charge
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

/** Which screen edge a seat sits at; the top seat's frame is the bottom's rotated 180°. */
export type SeatEdge = 'top' | 'bottom';

/** World ↔ seat frame for a point (the same involution both ways): the top
 *  seat's frame is the bottom seat's rotated 180° about the field centre. */
export function seatPoint(edge: SeatEdge, p: { x: number; y: number }): { x: number; y: number } {
  return edge === 'top' ? { x: GAME_WIDTH - p.x, y: GAME_HEIGHT - p.y } : { x: p.x, y: p.y };
}

/**
 * SPECIAL homing missile (#22) — the 5yo fairness lever, built to be hard to
 * miss from a rough aim. At launch it takes the enemy nearest its aim line
 * inside a WIDE forward cone (no tight perpendicular gate); whenever it has no
 * live target (none at launch, or its target died) it picks the enemy nearest
 * its current heading inside the same cone. It flies straight for a short
 * arming run, eases its turn-rate in over `rampDistancePx`, then steers hard.
 * `lifetimeMs` recycles a missile that never connects (no endless orbiting).
 */
export const MISSILE = {
  speed: 420, // px/s — a touch slower than a FIRE round, so it can turn tight
  coneHalfAngleDeg: 45, // target must sit within this of the aim/heading line
  maxRange: 700, // ignore targets farther than this along the line
  ringPad: 6, // aim-preview ring sits this far outside the targeted enemy
  armDistancePx: 40, // straight flight before any steering…
  armFraction: 0.5, // …but never more than this share of the way to a launch target
  rampDistancePx: 50, // then ease the turn-rate 0→full over this much more travel
  turnRateDeg: 720, // max deg/s the heading may rotate toward the target
  lifetimeMs: 3000, // recycle a missile still flying after this long
} as const;

/** SPECIAL ammo (#22): its own, smaller pool beside FIRE's (AMMO). */
export const SPECIAL = {
  max: 2,
  regenMs: 3000, // one missile back every this many ms
} as const;

/** Triple missile (#26 D7): one SPECIAL press fires three homing missiles,
 *  the aim line and this many degrees either side of it. */
export const TRIPLE = { fanDeg: 12 } as const;

/** Detonator (#26 D8): a straight, slower bomb that blows up on the seat's
 *  next SPECIAL press, on touching an enemy (or the boss's shield web), or at
 *  the screen edge. The blast hurts every enemy whose body reaches inside
 *  `blastRadius` (damage is `DAMAGE.blast` in waves.ts). */
export const BOMB = { speed: 300, blastRadius: 45 } as const;

/**
 * Rotating a seat's special modes (#26 D2): an upward swipe on SPECIAL (seat
 * frame: toward the field) rotates to the next mode at the moment it crosses
 * `minUpPx` while staying within `maxOffDeg` of straight up; that press then
 * fires nothing. Less travel, or a sideways drift, is still a tap that fires.
 * The icons slide carousel-style over `carouselMs`; pips under the button (one
 * per mode, the current one filled) show only once the seat has two modes.
 */
export const SPECIAL_SWIPE = {
  minUpPx: 28,
  maxOffDeg: 35,
  carouselMs: 180,
  slidePx: 18, // how far an icon slides in/out of the button
  pipR: 2.5,
  pipGap: 8, // centre-to-centre
  pipBelow: 8, // pips' centre line, this far below the button's bottom edge
} as const;

/**
 * Starfield (#19): three parallax layers streaming right to left behind
 * everything, ported from the v6 mock. Each layer is one tiling texture
 * (`TEX.starLayer`) scrolled by Starfield.ts. `speed` is px/s at
 * `speedScale` 1; the act transition (#29, ACT_TRANSITION.starRush) raises
 * the scale at run time via Starfield.setSpeedScale. Counts are per 360px of
 * width (the tile is wider, so it scales them up).
 */
export const STARFIELD = {
  speedScale: 1,
  /** Tile size: power-of-two, so Phaser wraps it without resampling. 512 is
   *  wider than the field, so a layer never shows its own repeat. */
  tile: { width: 512, height: 1024 },
  seed: '19-starfield',
  layers: [
    { count: 46, rMin: 0.5, rMax: 0.9, alpha: 0.35, speed: 8, streak: 0 },
    { count: 22, rMin: 0.9, rMax: 1.3, alpha: 0.6, speed: 22, streak: 0 },
    // The near layer draws as short streaks (length = streak × r) for speed.
    { count: 9, rMin: 1.3, rMax: 1.8, alpha: 0.95, speed: 55, streak: 5 },
  ],
} as const;

/**
 * The enemy lane (#19): the band between the two seats' control areas. Every
 * enemy lives inside it. It splits into `sublanes` equal sublanes, top to
 * bottom, one per fleet ship; a rock's sublane is the one its centre is in.
 */
export const LANE = { top: 200, bottom: 540, sublanes: 4 } as const;
export const SUBLANE_H = (LANE.bottom - LANE.top) / LANE.sublanes; // 85

/** Centre y of sublane `i` (0 = top). */
export function sublaneCenterY(i: number): number {
  return LANE.top + SUBLANE_H * (i + 0.5);
}

/** The sublane a y falls in, clamped to the band (a y above the lane counts
 *  as the top sublane, below it as the bottom one). */
export function sublaneOf(y: number): number {
  const i = Math.floor((y - LANE.top) / SUBLANE_H);
  return Math.max(0, Math.min(LANE.sublanes - 1, i));
}

/**
 * Upgrade pods (#26): a boss drop puts two pods side by side across the middle
 * of the lane, the same distance from both launchers, bobbing gently. Each
 * live seat takes one with a FIRE round; the pods leave once every live seat
 * has picked or after `timeoutMs`, blinking for the last `blinkMs`. All of it
 * runs on the scene's update delta (no tweens), so the e2e stepper drives it.
 */
export const PODS = {
  xs: [130, 230] as readonly number[],
  y: (LANE.top + LANE.bottom) / 2,
  r: 22,
  bobPx: 4,
  bobMs: 1600, // one full bob cycle
  timeoutMs: 12000,
  blinkMs: 3000,
  blinkPeriodMs: 250,
  /** A picking seat's colour ring sits this far outside the pod (P1 inside P2's). */
  pickRingGap: [4, 8] as readonly number[],
  iconFrac: 0.62, // the upgrade icon's radius, as a share of r
} as const;

/** A fleet ship's shield bubble: an ellipse centred on the hull (local x).
 *  ry stays under SUBLANE_H / 2, so neighbouring bubbles never touch. */
const FLEET_SHIELD = { cx: 22, rx: 31, ry: 36 } as const;

/**
 * The colony fleet (#19): one ship per sublane at the left edge, nose right,
 * ported from the v6 mock (plans/mockups/layout-colony-ship.html). Points are
 * in a ship's local frame: x from the left wall, y from its sublane centre.
 * Each ship has one shield bubble (an ellipse round the hull); enemies stop at
 * the bubble's front while it's up, or at the hull's nose once it's popped.
 */
export const FLEET = {
  hull: [
    [4, -13],
    [20, -16],
    [27, -9],
    [40, 0],
    [27, 9],
    [20, 16],
    [4, 13],
  ],
  /** Engine flame behind the hull (drawn under it). */
  flame: [
    [4, -7],
    [-6, 0],
    [4, 7],
  ],
  deck: { x1: 6, x2: 34 }, // centre line along the hull
  /** Two rows of windows: their left x, the top/bottom rows' y, square size. */
  windows: { xs: [9, 13, 17, 21], yTop: -10.5, yBottom: 8.1, size: 2.4 },
  pod: { x: 14, r: 5 }, // habitat pod
  bridge: { x: 30, r: 2.6 },
  noseX: 40, // hull front: the contact line once the shield is popped
  shield: FLEET_SHIELD,
  /** The bubble's front: the contact line while the shield is up. */
  bubbleFrontX: FLEET_SHIELD.cx + FLEET_SHIELD.rx,
  /** Burst radius where a ship is lost. */
  lostBoomR: 20,
  /** Where the boss and escorts face: the fleet's middle. */
  facePoint: { x: FLEET_SHIELD.cx, y: (LANE.top + LANE.bottom) / 2 },
} as const;

/** How far past the screen edge the flyby takes the fleet's bubbles before it
 *  wraps: past their ambient glow's reach too (22px, Fleet.ts), so no glow
 *  sliver jumps between the edges at the wrap. */
const ACT_OFFSCREEN_PAD = 32;

/**
 * The act transition (#29), played by ActTransition.ts: between acts the whole
 * fleet flies off the right edge, comes back in from the left and eases into
 * its slots, while the starfield rushes. Total ≈ leadInMs + outMs + inMs.
 */
export const ACT_TRANSITION = {
  /** Minimum pause before take-off (it also waits for restored ships to show). */
  leadInMs: 700,
  /** Slot → off the right edge, speeding up. */
  outMs: 1300,
  /** Off the left edge → back in the slot, slowing down. */
  inMs: 1300,
  /** Peak star speed (Starfield speed scale), reached at the wrap. */
  starRush: 6,
  /** Fleet x offset where the out leg ends: its bubbles' left edge past the right edge. */
  exitX: GAME_WIDTH - (FLEET_SHIELD.cx - FLEET_SHIELD.rx) + ACT_OFFSCREEN_PAD,
  /** Fleet x offset where the in leg starts: its bubbles' front past the left edge. */
  entryX: -FLEET.bubbleFrontX - ACT_OFFSCREEN_PAD,
} as const;

/** Worried-shake tween on a fleet ship when its shield pops. */
export const SHAKE = { amplitude: 3, durationMs: 60, repeats: 2 } as const;

/** The shield REGROW cue: a copy of the bubble settles in from this scale
 *  (the pop cue is the SHIELD_FX flare-then-fade below). A rebuilt hull fades
 *  in over the same duration. */
export const REGROW = { scaleFrom: 1.25, durationMs: 200 } as const;

/**
 * Shield FX (B22 glow + B23 pulse), from the locked prototype
 * `prototype/reference/shield-pulse.ts`, carried onto the fleet's bubbles.
 * Bubbles breathe on a sine (COLOR brightness, never alpha — an opaque thick
 * stroke avoids the radial "grid" spokes a semi-transparent one shows at its
 * tessellation joins) and FLOW down the fleet via a per-ship phase offset,
 * under one shared ambient glow. A popped bubble flares its glow then expands
 * + fades. Perf: no DPI, glow `quality` stays 0.3, and one glow FX for the
 * whole fleet. (Width + colour: STROKES.bubble, COLORS.shieldOuter.)
 */
export const SHIELD_FX = {
  periodMs: 3200, // ms per breath — slow
  pulseLo: 0.6, // trough brightness (crest is 1.0): a half-dim, still clearly lit
  glowQuality: 0.3, // glow bloom sample size — keep low; higher lags the Pixel 6
  // Popped bubble: flare the glow bright (yoyo), then expand + fade away.
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

/** Enemy health bar (#23): a vertical pill just off a damaged enemy's right
 *  side, its fill centred so both seats read it the same. Sized from the
 *  enemy's radius (13 → ~18px tall), never shorter than minHeight. */
export const HEALTH_BAR = {
  gap: 4, // from the enemy's rim to the bar
  width: 4,
  heightPerRadius: 1.4,
  minHeight: 16,
  depth: 1, // a readout: over the depth-0 field (rocks, rockets, trails, shield), under escorts, banners and overlays
} as const;

/** Explicit render depths for late-created UI (creation order isn't enough:
 *  the WaveDirector creates asteroids AFTER the overlays exist). */
/** Draw order above (or, negative, below) the default depth 0 that most of the
 *  game draws at in creation order. fleetGlow sits under the starfield: the
 *  glow's source shapes are filled with the scene background, so drawn above
 *  the stars they would blank them out inside every bubble. */
export const DEPTHS = { fleetGlow: -1, banner: 900, overlay: 1000 } as const;

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
 * Giant asteroid (#25) GEOMETRY — act 1's boss. A boulder about as tall as one
 * sublane (3.4× a standard rock's radius), centred on the lane so it never
 * leaves it, entering just off the right edge and drifting straight left
 * (its speed comes from GIANT.travelMs in waves.ts). Balance dials live there.
 */
export const GIANT_LAYOUT = {
  radius: 44,
  y: (LANE.top + LANE.bottom) / 2,
  /** Extra craters on top of the rock drawing, as (x, y, r) fractions of the radius. */
  extraCraters: [
    [0.1, -0.55, 0.14],
    [-0.45, 0.45, 0.17],
    [0.5, -0.15, 0.1],
    [-0.05, 0.25, 0.09],
  ],
  /** The two-player lock ring (one seat's charged hit waiting for the other's):
   *  a circle just outside the rim in that seat's colour, fading as its window runs out. */
  ring: { pad: 7, width: 4, alpha: 0.95 },
  hitFlashMs: 90, // a damaging hit flashes it white this long (counted on update's delta)
  /** The burst: its rocks fan out evenly up and down the lane (the outer pair
   *  spreadY above and below the giant's row, on the outer sublanes' ships, so
   *  every ship is threatened), easing only driftX to the left as they spread,
   *  then drift left like a splitter's children. Their own ChildMotion: a
   *  no-hit grace long enough for the 560 px/s charged round that popped the
   *  giant to carry on clear of them (they sit still under the boom meanwhile:
   *  a body that's off doesn't move, so scatterMs counts the grace too, and
   *  they spread over scatterMs − spawnGraceMs); and a lifetime cap that
   *  outlasts the trip to the fleet from a pop at the right edge (~8 s at the
   *  cruise speed). */
  burst: {
    spreadY: 1.5 * SUBLANE_H, // the outer sublanes' centres, from the lane's centre line
    driftX: 40,
    childSpeed: 45, // SPLITTER_CHILDREN's cruise
    scatterMs: 1000,
    spawnGraceMs: 400,
    lifetimeMs: 10000,
  },
} as const;

/** How a scatter child moves once launched: its cruise, scatter time, spawn
 *  grace and lifetime cap (SPLITTER_CHILDREN for a splitter's,
 *  GIANT_LAYOUT.burst for the giant's). */
export type ChildMotion = {
  readonly childSpeed: number;
  readonly scatterMs: number;
  readonly spawnGraceMs: number;
  readonly lifetimeMs: number;
};

/**
 * Final boss (B5) GEOMETRY. The boss slides in from the right and parks at
 * center — fully on screen, equidistant from both seats — and is stationary
 * while battling. 4 escorts slowly orbit it at a radius kept OUTSIDE the boss
 * so the whole boss stays visible. Balance dials (HP, charge rate) live in
 * waves.ts; this block is positions/sizes only. (`park.x` is tunable
 * left-of-center; the orbit must clear the fleet's bubbles at x ≤ FLEET.bubbleFrontX.)
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

// Wave targets, the difficulty model, rock streams, and the budget/solver math live
// in waves.ts — that's the one file to tune the run. See docs/design.md §7.

/**
 * Controls v2 (#7): two-thumb drag aim + fire buttons. ALL control geometry
 * lives here.
 *
 * Written in the BOTTOM seat's (P2's) frame, as screen coords for P2:
 *
 *    [FIRE] [SPECIAL]   (launcher)      ( aim pad )
 *    player's left     P2_ANCHOR        player's right
 *
 * P1 (top edge) is the same layout rotated 180° about the field centre, i.e.
 * (x, y) → (GAME_WIDTH − x, GAME_HEIGHT − y); P2_ANCHOR maps onto P1_ANCHOR. A
 * lefty seat (switched in game with its swap control, #21) mirrors x within its
 * own frame (x → GAME_WIDTH − x) BEFORE that rotation: aim zone + pad on the
 * player's left, buttons + swap on their right. Aim directions are not mirrored.
 *
 * Aim angle (seat frame): 0° = toward the player's right, 90° = straight across
 * the field at the other player, 180° = toward the player's left.
 *
 * Clearances (checked against the trajectory at the aim clamps, 15°/165°, from
 * the launcher at (180,640)): the line passes 2px outside SPECIAL and ~20px above
 * the pad; FIRE/SPECIAL centres are 74 apart (gap 11); SPECIAL's right edge is 145
 * and the pad's left edge 254, which bracket the HUD column (x 150..~250 with a
 * 4-digit score). Controls stay below y≈625, under the enemy lane (y ≤ LANE.bottom = 540).
 * Sized for small thumbs; exact numbers are for tuning on the phone.
 */
export const CONTROLS_V2 = {
  /** Big round FIRE button (hold to charge the railgun, release to fire). */
  fire: { x: 52, y: 682, r: 38 },
  /** Smaller round SPECIAL button beside FIRE, a little higher and inward. */
  special: { x: 120, y: 652, r: 25 },
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
   *  charge (from `pullBackMinFrac`); SPECIAL holds at `specialPullBack`. */
  pullBack: 12,
  pullBackMinFrac: 0.3,
  specialPullBack: 6,
  /** Resting trajectory alpha, as a fraction of STROKES.trajectory.alpha (it
   *  brightens to full while the seat aims or holds a button). */
  trajectoryRestFrac: 0.35,
  /** HUD group origin under the launcher (rows run +x/+y from here, see
   *  HUD_ROWS): below the nocked rocket's furthest draw-back (y≈659), between
   *  SPECIAL and the pad. `hudLefty` shifts it left to clear the mirrored SPECIAL
   *  (x≥215) while staying right of the mirrored pad's range arc (x≤111). */
  hud: { x: 150, y: 670 },
  hudLefty: { x: 116, y: 670 },
  /** Lefty swap (#21): a small ⇄ control above FIRE, on the buttons' side (it
   *  mirrors with them). Holding it `holdMs` mirrors the seat; an earlier
   *  release cancels. Its hit circle (r + hitPad) stays clear of both aim zones
   *  (righty x ≥ 165, lefty x ≤ 195) and ~45 units above FIRE's hit edge. */
  swap: { x: 28, y: 572, r: 16, hitPad: 6, holdMs: 800 },
} as const;

/** Phone vibration (#3), in ms; values accepted on the Pixel 6: a buzz
 *  per shot fired, by kind (plain / missile / charged), and a tick the moment FIRE is fully charged
 *  with ammo to fire. Pulses of 15ms or less can be imperceptible on some
 *  Android motors. See src/haptics.ts. */
export const HAPTICS = {
  blastMs: 40, // a detonator's blast (#26)
  bossHitMs: 30, // a hit that counts on the command ship or the giant asteroid (#3 D6)
  shotMs: 20,
  missileMs: 25,
  chargedMs: 40,
  armedMs: 20,
} as const;

/** Sound (#3): the mix dials for src/sfx.ts. The sounds themselves are the
 *  recipes in src/sfxRecipes.ts. Every voice runs through one master gain, a
 *  limiter (so stacked booms can't spike) and a lowpass that takes the harsh
 *  top off: a moderate, kid-friendly level. */
export const SFX = {
  masterVolume: 0.6,
  limiter: { thresholdDb: -18, ratio: 6 },
  lowpassHz: 8000,
  /** ± fraction of random pitch per play, so repeats don't sound robotic. */
  pitchJitter: 0.04,
  /** Fade when a sound is cut short (stop()), in seconds. */
  stopFadeS: 0.05,
  /** Voices of one sound at once, and the minimum gap between its starts:
   *  two seats' rapid fire can't stack into a wall of noise. */
  caps: {
    default: { max: 4, gapMs: 20 },
    thwip: { max: 3, gapMs: 35 },
    charged: { max: 2, gapMs: 60 },
    rockBreak: { max: 3, gapMs: 40 },
    toughDent: { max: 2, gapMs: 40 },
    refused: { max: 2, gapMs: 60 },
    flyby: { max: 1, gapMs: 0 },
    bossEnter: { max: 1, gapMs: 0 },
    beamCharge: { max: 1, gapMs: 0 },
  },
  /** The command ship's beam whine starts when this much of its charge is
   *  left; the beamCharge recipe lasts exactly this long. */
  beamWhineMs: 1800,
} as const;

/** Mock HUD group row offsets (local y): WAVE 0, SCORE 20, AMMO 40, plus the
 *  SPECIAL ammo row (#22) at 60, labelled with the current special's icon. */
export const HUD_ROWS = {
  wave: 0,
  score: 20, // built in B6
  ammo: 40,
  special: 60,
  specialIconR: 7, // the special row's icon label: drawn in a circle of this radius…
  specialIconX: 8, // …centred this far along the row
} as const;

/**
 * Scoring presentation — standards score 10, two-hit rocks 20, and splitters
 * 20 immediately; a splitter's two children (and the giant asteroid's burst
 * rocks) score 10 each. The giant itself is unscored, like the command ship. The popup grows-and-fades in place (orientation-neutral so it
 * reads the same from both seats); the HUD number is the canonical read.
 */
export const SCORE = {
  standard: 10,
  tough: 20,
  splitter: 20,
  popup: { riseScale: 1.4, durationMs: 650, fontPx: 18 }, // floating "+N"
} as const;

/**
 * Splitter children (B37) — one rocket breaks a large splitter into two
 * standard-size children. They scatter briefly, then drift straight left like
 * small rocks (the fleet-contact and left-exit logic both apply), threaten
 * their sublane's ship (a self-balancing "winning tax"), and score their own
 * standard pop (10 pts each). The scatter stays inside the enemy lane. Only
 * rocket-kills split; a rock that reaches the fleet never does.
 *
 * Children live as pre-allocated wrappers appended to the asteroid pool (so
 * the rocket→asteroid collider, built once, covers them); they differ from
 * wave rocks only in being one-shot (no respawn) and fielded at a position
 * with a scatter velocity rather than off the right edge.
 */
export const SPLITTER_CHILDREN = {
  poolSize: 6, // pre-allocated child wrappers (graceful degrade if exhausted)
  count: 2, // children per splitter
  launchSpeed: 90, // initial scatter burst (px/s)
  childSpeed: 45, // straight-left cruise after the scatter (~ a slow wave rock)
  scatterMs: 400, // the scatter burst lasts this long, then the child turns straight left
  scatterConeDeg: 70, // total spread of the 2 children...
  scatterCenterDeg: 180, // ...centered LEFTWARD (toward the fleet, -x)
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

/** Join screen (#20), in the BOTTOM seat's frame; the top seat's panel is the
 *  same layout rotated 180° about the field centre (like CONTROLS_V2). A tap
 *  anywhere in a seat's half (y ≥ `halfY`) joins it; the seat then shows its
 *  ring between two pick buttons, Easy (∞) on the player's left and Normal
 *  (5 ammo pips) on their right. Tapping the ring again leaves. Once every
 *  joined seat has picked, a `countdownMs` numeral countdown starts the run;
 *  a join or a leave restarts it. */
export const JOIN = {
  halfY: GAME_HEIGHT / 2,
  ring: { x: 180, y: 640, r: 40 },
  easy: { x: 82, y: 640, r: 40 },
  normal: { x: 278, y: 640, r: 40 },
  /** Touch slop outside a button's drawn radius. */
  hitPad: 8,
  /** A ring tap this soon after joining doesn't leave (a double-tap, or two
   *  fingers landing together, would otherwise join and leave at once). */
  leaveGraceMs: 500,
  /** The unjoined ring breathes (scale) on this period, by this much. */
  pulseMs: 1400,
  pulseScale: 0.12,
  /** Alpha of a pick button that isn't the seat's pick. */
  unpickedAlpha: 0.45,
  countdownMs: 3000,
  countdownAt: { x: 180, y: 520 },
  countdownFontPx: 56,
  /** The sound on/off button (#3): on the centre line, between the two seat
   *  halves, so it's in neither player's region. */
  speaker: { x: 180, y: 370, r: 22 },
} as const;
