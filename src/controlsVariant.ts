/**
 * controlsVariant.ts — the phone's per-seat option for the two-thumb controls
 * (TwoThumbControl): which seats play lefty. Which seats play, and at what
 * difficulty, is the join screen's call (lineup.ts).
 *
 * Lefty is switched in game with each seat's swap control (#21) and SAVED to
 * localStorage, so the phone remembers it across runs and reloads (the
 * installed home-screen PWA too). Every storage call is try/caught: private
 * mode or blocked storage just means no memory. An unrecognised saved value
 * reads as the default (nobody mirrored).
 */

export type LeftySetting = 'p1' | 'p2' | 'both' | 'none';

const ALLOWED: readonly string[] = ['p1', 'p2', 'both', 'none'] satisfies readonly LeftySetting[];

/** Storage key (unchanged since the old `?lefty` URL switch, so a saved choice carries over). */
const LEFTY_KEY = 'starSlingers.lefty';

let cached: LeftySetting | null = null;

/** The phone's lefty setting, read from storage once; setSeatLefty keeps it current. */
export function leftySetting(): LeftySetting {
  if (cached === null) {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LEFTY_KEY);
    } catch {
      // No storage: the default.
    }
    cached = saved !== null && ALLOWED.includes(saved) ? (saved as LeftySetting) : 'none';
  }
  return cached;
}

/** Is this seat mirrored (aim zone on the player's left, buttons on their right)? */
export function isLefty(lefty: LeftySetting, player: 'p1' | 'p2'): boolean {
  return lefty === 'both' || lefty === player;
}

/** Set one seat's lefty, leaving the other seat's as it was, and save it. */
export function setSeatLefty(player: 'p1' | 'p2', on: boolean): void {
  const current = leftySetting();
  const p1 = player === 'p1' ? on : isLefty(current, 'p1');
  const p2 = player === 'p2' ? on : isLefty(current, 'p2');
  cached = p1 && p2 ? 'both' : p1 ? 'p1' : p2 ? 'p2' : 'none';
  try {
    window.localStorage.setItem(LEFTY_KEY, cached);
  } catch {
    // No storage (private mode, blocked site data): the choice lasts this boot only.
  }
}
