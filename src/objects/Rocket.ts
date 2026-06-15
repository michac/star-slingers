/**
 * RocketPool — pooled arcade-physics sprites for both players' rockets.
 * Rockets fly straight (no gravity) and recycle when they hit the world
 * bounds or an asteroid. Homing shots (B14) additionally carry a locked
 * target and get steered toward it each frame by steer().
 */
import Phaser from 'phaser';
import { HOMING } from '../layout';
import type { HomingTarget } from './HomingTarget';

export class RocketPool {
  readonly group: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene) {
    this.group = scene.physics.add.group({ allowGravity: false, maxSize: 24 });

    // Asteroids never set onWorldBounds, so this only ever sees rockets —
    // but check the flag anyway in case future bodies opt in.
    scene.physics.world.on(
      Phaser.Physics.Arcade.Events.WORLD_BOUNDS,
      (body: Phaser.Physics.Arcade.Body) => {
        const go = body.gameObject as Phaser.GameObjects.GameObject | undefined;
        if (go?.getData('isRocket')) {
          this.recycle(go as Phaser.Physics.Arcade.Sprite);
        }
      }
    );
  }

  /** Returns the launched sprite (or null if the pool is exhausted) so the
   *  caller can tag it as homing; a fresh rocket always starts non-homing. */
  fire(
    textureKey: string,
    x: number,
    y: number,
    vx: number,
    vy: number
  ): Phaser.Physics.Arcade.Sprite | null {
    const rocket = this.group.get(x, y, textureKey) as Phaser.Physics.Arcade.Sprite | null;
    if (!rocket) return null; // pool exhausted
    rocket.setTexture(textureKey); // pooled sprite may carry the other player's
    rocket.setActive(true).setVisible(true);
    rocket.setData('isRocket', true);
    rocket.setData('homing', false); // pooled sprite may carry a stale flag
    rocket.setData('dist', 0); // reset travelled distance for the arm/ramp curve

    const body = rocket.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y); // clears stale pooled velocity + syncs position
    body.enable = true;
    body.onWorldBounds = true;
    rocket.setCollideWorldBounds(true);
    body.setVelocity(vx, vy);
    // Texture nose points at -y, so offset atan2's +x convention by 90°.
    rocket.setRotation(Math.atan2(vy, vx) + Math.PI / 2);
    return rocket;
  }

  /** Per-frame homing steer (B14). Each in-flight homing rocket flies STRAIGHT
   *  for its arm distance, then its turn-rate ramps 0→full over the next
   *  rampDistancePx, so the curve eases in as an obvious "smart rocket" move
   *  rather than snapping. Steering is pure-pursuit at a high capped turn-rate:
   *  a shot only ever homes if it locked a target at fire, and a lock is meant
   *  to connect. If that locked target dies (e.g. the other player popped it),
   *  drop homing and fly straight — we never re-acquire a different rock. */
  steer(deltaMs: number): void {
    const fullTurn = Phaser.Math.DegToRad(HOMING.turnRateDeg) * (deltaMs / 1000);
    this.group.children.iterate((child) => {
      const rocket = child as Phaser.Physics.Arcade.Sprite;
      if (!rocket.active || !rocket.getData('homing')) return true;
      const body = rocket.body as Phaser.Physics.Arcade.Body;
      const speed = rocket.getData('speed') as number;

      // Advance the rocket's travelled distance, then derive how much of the
      // turn-rate is unlocked: nothing until armed, then eased in over the ramp.
      const dist = ((rocket.getData('dist') as number) ?? 0) + (speed * deltaMs) / 1000;
      rocket.setData('dist', dist);
      const armAt = (rocket.getData('armAt') as number) ?? HOMING.armDistancePx;
      const ramp = (dist - armAt) / HOMING.rampDistancePx;
      if (ramp <= 0) return true; // still in the straight arming run
      const maxTurn = fullTurn * Math.min(1, ramp);

      const target = rocket.getData('target') as HomingTarget | null;
      if (!target || !target.isActive || target.isPopping) {
        rocket.setData('homing', false); // lock lost — fly straight, don't re-aim
        return true;
      }

      const desired = Math.atan2(target.sprite.y - rocket.y, target.sprite.x - rocket.x);
      const current = Math.atan2(body.velocity.y, body.velocity.x);
      const next = Phaser.Math.Angle.RotateTo(current, desired, maxTurn);
      body.setVelocity(Math.cos(next) * speed, Math.sin(next) * speed);
      rocket.setRotation(next + Math.PI / 2);
      return true;
    });
  }

  recycle(rocket: Phaser.Physics.Arcade.Sprite): void {
    this.group.killAndHide(rocket);
    const body = rocket.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
