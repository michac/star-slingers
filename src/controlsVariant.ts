/**
 * controlsVariant.ts — the phone's per-seat option for the two-thumb controls
 * (TwoThumbControl): which seats play lefty. Which seats play, and at what
 * difficulty, is the join screen's call (lineup.ts).
 *
 * Lefty is switched in game with each seat's swap control (#21) and SAVED to
 * localStorage, so the phone remembers it across runs and reloads (the
 * installed home-screen PWA too). Every storage call is try/caught: private
 * mode or blocked storage just means no memory. Saved keys this module doesn't
 * read are ignored.
 */

export type LeftySetting = 'p1' | 'p2' | 'both' | 'none';

export interface ControlsVariant {
  lefty: LeftySetting;
}

/** Default: nobody mirrored. */
const DEFAULTS: ControlsVariant = { lefty: 'none' };

const ALLOWED: readonly LeftySetting[] = ['p1', 'p2', 'both', 'none'];

/** Storage key (unchanged since the old `?lefty` URL switch, so a saved choice carries over). */
const LEFTY_KEY = 'starSlingers.lefty';

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // No storage (private mode, blocked site data): the choice lasts this boot only.
  }
}

let cached: ControlsVariant | null = null;

/** The phone's variant, read from storage once; setSeatLefty keeps it current. */
export function controlsVariant(): ControlsVariant {
  if (!cached) {
    const saved = storageGet(LEFTY_KEY);
    cached = {
      lefty: saved !== null && (ALLOWED as readonly string[]).includes(saved) ? (saved as LeftySetting) : DEFAULTS.lefty,
    };
  }
  return cached;
}

/** Is this seat mirrored (aim zone on the player's left, buttons on their right)? */
export function isLefty(lefty: LeftySetting, player: 'p1' | 'p2'): boolean {
  return lefty === 'both' || lefty === player;
}

/** Set one seat's lefty, leaving the other seat's as it was, and save it. */
export function setSeatLefty(player: 'p1' | 'p2', on: boolean): void {
  const variant = controlsVariant();
  const p1 = player === 'p1' ? on : isLefty(variant.lefty, 'p1');
  const p2 = player === 'p2' ? on : isLefty(variant.lefty, 'p2');
  variant.lefty = p1 && p2 ? 'both' : p1 ? 'p1' : p2 ? 'p2' : 'none';
  storageSet(LEFTY_KEY, variant.lefty);
}
