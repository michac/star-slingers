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
  /** Set on a target only charged FIRE rounds may hurt, so no SPECIAL takes
   *  or damages it (see specialCanHit). Nothing sets it yet; it's the opt-out
   *  #25's giant asteroid is meant to use. */
  readonly chargedOnly?: boolean;
}

/** THE one check for what a SPECIAL can hurt (#26): a live target, not
 *  already popping, and not charged-only. Missiles (single and triple) only
 *  take targets that pass it, and a detonator's blast (inBlast) only damages them. */
export function specialCanHit(t: HomingTarget): boolean {
  return t.isActive && !t.isPopping && !t.chargedOnly;
}

/** Does a detonator blast of `radius` centred on (x, y) hurt `t` (#26)? A
 *  target a SPECIAL can hurt whose body reaches inside the blast. */
export function inBlast(t: HomingTarget, x: number, y: number, radius: number): boolean {
  return specialCanHit(t) && Phaser.Math.Distance.Between(x, y, t.sprite.x, t.sprite.y) <= radius + t.radius;
}
