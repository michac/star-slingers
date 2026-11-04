/**
 * The retired station geometry that the shield prototypes (glow-lab.ts,
 * reference/shield-pulse.ts) were built on, frozen here for them. Not a page:
 * the shelf lists only .html files.
 */
export const STATION = {
  cx: -10,
  cy: 370,
  hullR: 24,
  windows: [
    { x: 5, y: 361, r: 2.5 },
    { x: 3, y: 383, r: 2 },
  ],
} as const;
export const SHIELD_RINGS = [46, 39, 32] as const;
