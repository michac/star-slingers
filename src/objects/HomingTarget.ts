/**
 * HomingTarget — the minimal shape the SPECIAL homing missile (#22) needs from
 * anything it can take: a physics sprite, live/popping flags, and a radius for
 * the aim-preview ring. Asteroid and Escort satisfy it, so the missile keeps
 * working through the wave run AND the boss fight (the boss itself takes only
 * charged FIRE rounds).
 */
import Phaser from 'phaser';

export interface HomingTarget {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly isActive: boolean;
  readonly isPopping: boolean;
  readonly radius: number;
  /** Only charged FIRE rounds hurt it (the command ship's rule; #25's giant
   *  asteroid sets it too): see specialCanHit. */
  readonly chargedOnly?: boolean;
}

/** THE one check for what a SPECIAL can hurt (#26): a live target that isn't
 *  charged-only. Missiles (single and triple) only take targets that pass it,
 *  and a detonator's blast only damages them. */
export function specialCanHit(t: HomingTarget): boolean {
  return t.isActive && !t.isPopping && !t.chargedOnly;
}
