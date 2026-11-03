/**
 * lineup.ts — the two seats and who is playing in them this run (#20): each
 * seat is not joined (null), Easy or Normal. The join screen (JoinScene) builds
 * the lineup and starts the game scene with it as scene data. Try again
 * restarts that scene with the same data, so it keeps the seats and picks; a
 * win goes back to the join screen, and a reload starts there too. Nothing is
 * saved to storage.
 *
 * Easy changes ammo only (unlimited, PlayerHud.setUnlimitedAmmo); wave
 * difficulty depends only on how many seats are live (SOLO in waves.ts).
 */
import { COLORS, CSS } from './tokens';
import { P1_ANCHOR, P2_ANCHOR, type SeatEdge } from './layout';
import { TEX } from './objects/textures';
import type { PlayerId } from './objects/Rocket';

export type Difficulty = 'easy' | 'normal';
export type Lineup = Record<PlayerId, Difficulty | null>;

/** One seat's fixed wiring and look (P1 top edge, P2 bottom). */
export interface SeatDef {
  player: PlayerId;
  anchor: { x: number; y: number };
  color: number;
  colorCss: string;
  edge: SeatEdge;
  tex: string;
}

/** The seats in their fixed order: P1 (top) first, P2 (bottom) second. */
export const SEAT_DEFS: readonly SeatDef[] = [
  { player: 'p1', anchor: P1_ANCHOR, color: COLORS.p1, colorCss: CSS.p1, edge: 'top', tex: TEX.rocketP1 },
  { player: 'p2', anchor: P2_ANCHOR, color: COLORS.p2, colorCss: CSS.p2, edge: 'bottom', tex: TEX.rocketP2 },
];

/** A partial lineup (a seat left out didn't join) as a full one. */
export const toLineup = (l: Partial<Lineup>): Lineup => ({ p1: l.p1 ?? null, p2: l.p2 ?? null });

/** The joined seats, in seat order. */
export function liveSeats(l: Lineup): PlayerId[] {
  return SEAT_DEFS.map((d) => d.player).filter((p) => l[p] !== null);
}
