/**
 * controlsVariant.ts — which control scheme this boot runs (controls v2, #7).
 *
 *   ?controls=v2|sling   two-thumb aim + fire buttons, or today's pull-and-release
 *   ?aim=arc|drag        v2 aim pad: absolute (thumb direction) or relative drag
 *   ?lefty=p1|p2|both|none   mirror that seat's v2 layout (pad left, buttons right)
 *   ?players=1|2         solo (bottom seat only, #6 prototype slice) or the co-op two seats
 *
 * Resolution per param: the URL wins and is SAVED to localStorage; an absent (or
 * unrecognised) param falls back to the saved value, then the default. Saving is
 * what lets the installed home-screen PWA (which always opens at the bare start
 * URL) keep the last variant picked from the prototype shelf. Every storage call
 * is try/caught: private mode or blocked storage just means no memory.
 */

export type ControlsMode = 'v2' | 'sling';
export type AimMode = 'arc' | 'drag';
export type LeftySetting = 'p1' | 'p2' | 'both' | 'none';
export type PlayersSetting = '1' | '2';

export interface ControlsVariant {
  controls: ControlsMode;
  aim: AimMode;
  lefty: LeftySetting;
  players: PlayersSetting;
}

/** Defaults on this branch: v2 controls, arc aim, nobody mirrored, two players. */
const DEFAULTS: ControlsVariant = { controls: 'v2', aim: 'arc', lefty: 'none', players: '2' };

const ALLOWED: { [K in keyof ControlsVariant]: readonly ControlsVariant[K][] } = {
  controls: ['v2', 'sling'],
  aim: ['arc', 'drag'],
  lefty: ['p1', 'p2', 'both', 'none'],
  players: ['1', '2'],
};

const STORAGE_PREFIX = 'starSlingers.';

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // No storage (private mode, blocked site data): the choice lasts this boot only.
  }
}

function resolve<K extends keyof ControlsVariant>(params: URLSearchParams, key: K): ControlsVariant[K] {
  const allowed = ALLOWED[key] as readonly string[];
  const fromUrl = params.get(key);
  if (fromUrl !== null && allowed.includes(fromUrl)) {
    storageSet(key, fromUrl);
    return fromUrl as ControlsVariant[K];
  }
  const saved = storageGet(key);
  if (saved !== null && allowed.includes(saved)) return saved as ControlsVariant[K];
  return DEFAULTS[key];
}

let cached: ControlsVariant | null = null;

/** The boot's variant, resolved once (a scene restart reuses it). */
export function controlsVariant(): ControlsVariant {
  if (!cached) {
    const params = new URLSearchParams(window.location.search);
    cached = {
      controls: resolve(params, 'controls'),
      aim: resolve(params, 'aim'),
      lefty: resolve(params, 'lefty'),
      players: resolve(params, 'players'),
    };
  }
  return cached;
}

/** Is this seat mirrored (pad on the player's left, buttons on their right)? */
export function isLefty(lefty: LeftySetting, player: 'p1' | 'p2'): boolean {
  return lefty === 'both' || lefty === player;
}

/** The variant's player count as a number (the waves math takes 1 | 2). */
export function playerCount(variant: ControlsVariant): 1 | 2 {
  return variant.players === '1' ? 1 : 2;
}
