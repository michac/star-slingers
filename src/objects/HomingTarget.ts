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
}
