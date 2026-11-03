/**
 * lineup.ts — who is playing this run: each seat is not joined (null), Easy or
 * Normal (#20). The join screen (JoinScene) sets it; the game scene reads it in
 * create(). It is module state, so "Try again" (a scene.restart in the same
 * boot) keeps the same seats and difficulties, while a reload starts empty and
 * shows the join screen again. Nothing is saved to storage.
 *
 * Easy changes ammo only (unlimited, PlayerHud.setUnlimitedAmmo); wave
 * difficulty depends only on how many seats are live (SOLO in waves.ts).
 */
import type { PlayerId } from './objects/Rocket';

export type Difficulty = 'easy' | 'normal';
export type Lineup = Record<PlayerId, Difficulty | null>;

/** The seats in their fixed order: P1 (top) first, P2 (bottom) second. */
export const SEAT_ORDER: readonly PlayerId[] = ['p1', 'p2'];

/** Used when no join screen ran (a scene started directly): today's co-op. */
const FALLBACK: Lineup = { p1: 'normal', p2: 'normal' };

let current: Lineup | null = null;

export function setLineup(next: Lineup): void {
  current = { ...next };
}

export function clearLineup(): void {
  current = null;
}

/** The run's lineup (a copy), or both Normal if none was set. */
export function lineup(): Lineup {
  return { ...(current ?? FALLBACK) };
}

/** The joined seats, in SEAT_ORDER. */
export function liveSeats(l: Lineup): PlayerId[] {
  return SEAT_ORDER.filter((p) => l[p] !== null);
}

/** Live seat count as the waves math takes it (solo or co-op). An empty
 *  lineup never reaches the game (the countdown needs a ready seat). */
export function seatCount(l: Lineup): 1 | 2 {
  return liveSeats(l).length === 1 ? 1 : 2;
}
