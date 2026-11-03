/**
 * haptics.ts — phone vibration (#3). Durations are the HAPTICS dials in
 * layout.ts. Feature-detected: where `navigator.vibrate` doesn't exist (iPhone /
 * WebKit) every call is a silent no-op.
 */
import { HAPTICS } from './layout';

/** Vibrate for `ms`, if this device can. */
export function buzz(ms: number): void {
  // Chrome logs a console ERROR for a vibrate before the first tap, and the armed tick fires from update(), outside any touch handler.
  if (navigator.userActivation?.hasBeenActive === false) return;
  navigator.vibrate?.(ms);
}

/** The buzz for a shot that just fired (#22): charged > missile > plain. */
export function shotBuzz(kind: { charged: boolean; special: boolean }): void {
  buzz(kind.charged ? HAPTICS.chargedMs : kind.special ? HAPTICS.missileMs : HAPTICS.shotMs);
}
