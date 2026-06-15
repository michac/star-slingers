/**
 * tokens.ts — the game's THEMING API, ported 1:1 from
 * plans/star-slingers/mockups/tokens-neon.css (Neon Arcade, the B9 style winner).
 *
 * Every color and font in the game comes from here and nowhere else.
 * Restyling = swapping these values for another style variant's token file.
 * Geometry lives in layout.ts, not here.
 *
 * Neon is a richer palette than the wireframe it replaced: the wireframe used
 * one `line` color for hull/shield/borders, but neon splits those roles, so
 * this set has grown (hull stroke is cyan, the 3 shield rings each take one
 * stop of the mock's cyan→purple→magenta gradient, etc.). The mock's glow,
 * gradients, and a shield pulse are NOT here — they're the deferred effects
 * layer (backlog B21–B23); this file is flat color + font only.
 */

/** Hex numbers for Graphics / tints / backgroundColor. */
export const COLORS = {
  sceneBg: 0x0a0626, // --scene-bg: deep purple-black space
  line: 0xff5ec7, // --line: hot magenta wireframe stroke
  lineDim: 0x6a3fb0, // --line-dim: dim purple
  p1: 0x38f6ff, // --p1: TOP player — hot cyan
  p2: 0xffb13b, // --p2: BOTTOM player — amber-orange
  danger: 0xff2e88, // --danger: magenta enemies (asteroid ring) + boss CHARGE bar
  health: 0x4dff9e, // neon green — the boss HEALTH bar (no green elsewhere in the skin)
  ink: 0xfdf4ff, // --ink: hit counts, HUD values
  chromeMuted: 0x9d7fd6, // --chrome-muted: HUD labels
  accent: 0xff5ec7, // --accent: score text, overlay card border

  // Station + enemies need fills the wireframe never had:
  hullFill: 0x123056, // solid stand-in for the #neon-hull radial (#16306a→#0b1130)
  hullWindow: 0xbffcff, // .hull-window
  rockFill: 0x2a0e3e, // .rock interior (wireframe rock was stroke-only)
  crater: 0xff7ab3, // .crater
  star: 0xbfefff, // .star (bright cyan-white, was lineDim)

  // The 3-ring shield maps onto the #neon-shield gradient stops (outer→inner).
  shieldOuter: 0x38f6ff, // cyan
  shieldMid: 0x9d6bff, // purple
  shieldInner: 0xff5ec7, // magenta
} as const;

/** Same palette as CSS strings — Phaser Text styles want strings. */
export const CSS = {
  p1: '#38f6ff',
  p2: '#ffb13b',
  ink: '#fdf4ff',
  chromeMuted: '#9d7fd6',
  accent: '#ff5ec7', // --accent: score (SCORE row arrives with B6)
} as const;

export const FONTS = {
  display: '"Audiowide", "Courier New", monospace', // --font-display: numbers, counters
  body: '"Audiowide", system-ui, sans-serif', // --font-body: labels
} as const;

/** Stroke/dash recipes from the neon paint rules. */
export const STROKES = {
  rangeArc: { width: 2, alpha: 0.8, dash: 3, gap: 7 }, // .sling-range-*
  pullLine: { width: 2.8, alpha: 0.95 }, // .sling-pull
  touchDot: { fillAlpha: 0.28, strokeWidth: 1.8 }, // .sling-touch
  trajectory: { width: 2, alpha: 0.85, dash: 2, gap: 7 }, // .trajectory
  rock: { width: 2.5 }, // .rock
  crater: { width: 1.5 }, // .crater
  // Solid (not dashed) shield rings: 3 nested dashed circles read as noise.
  shield: { width: 5, alpha: 0.9 },
  hull: { width: 2 },
  replay: { width: 5, alpha: 0.9 }, // fail-overlay circular-arrow icon
  panel: { width: 2, alpha: 1 }, // fail-overlay modal card border
} as const;
