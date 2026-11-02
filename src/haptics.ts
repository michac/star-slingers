/**
 * haptics.ts — phone vibration (#3). Durations are the HAPTICS dials in
 * layout.ts. Feature-detected: where `navigator.vibrate` doesn't exist (iPhone /
 * WebKit) every call is a silent no-op.
 */
import { HAPTICS } from './layout';

/** Vibrate for `ms`, if this device can. */
export function buzz(ms: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Chrome logs a console ERROR for a vibrate before the first tap, and the armed tick fires from update(), outside any touch handler.
  if (navigator.userActivation?.hasBeenActive === false) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Haptics are a nicety; never let one break a shot.
  }
}

/** The buzz for a shot that just fired: railgun > homing > plain. */
export function shotBuzz(kind: { charged: boolean; homing: boolean }): void {
  buzz(kind.charged ? HAPTICS.railgunMs : kind.homing ? HAPTICS.homingMs : HAPTICS.shotMs);
}
