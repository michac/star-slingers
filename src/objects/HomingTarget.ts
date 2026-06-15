/**
 * HomingTarget — the minimal shape the homing system (B14) needs from anything
 * a shot can lock onto: a physics sprite, live/popping flags, and a radius for
 * the aim-highlight ring. Asteroid, Escort, and Boss all satisfy it, so homing
 * keeps working through the wave run AND the final-boss fight.
 */
import Phaser from 'phaser';

export interface HomingTarget {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly isActive: boolean;
  readonly isPopping: boolean;
  readonly radius: number;
}
