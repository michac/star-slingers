/**
 * RocketPool — pooled arcade-physics sprites for both players' rockets.
 * Rockets fly straight (no gravity) and recycle when they hit the world
 * bounds or an asteroid. Homing shots (B14) additionally carry a locked
 * target and get steered toward it each frame by steer().
 */
import Phaser from 'phaser';
import { HOMING, TRAIL } from '../layout';
import { COLORS } from '../tokens';
import type { HomingTarget } from './HomingTarget';

/** A point on a rocket's flight history; stored per-sprite via setData. */
type TrailPoint = { x: number; y: number };

/** Exhaust color: the violet COLORS.shieldMid (#9d6bff), for contrast against
 *  the cyan(P1)/amber(P2) head and the magenta enemies. */
const EXHAUST = COLORS.shieldMid;

export class RocketPool {
  readonly group: Phaser.Physics.Arcade.Group;
  /** One shared additive Graphics for ALL rockets' trails, redrawn each frame. */
  private readonly trail: Phaser.GameObjects.Graphics;
  /** Drives the brightness flux scrolling down the exhaust. */
  private elapsed = 0;

  constructor(scene: Phaser.Scene) {
    this.group = scene.physics.add.group({ allowGravity: false, maxSize: 24 });
    // Created right after the group (before the asteroids), so it sits just
    // below the rockets; additive + filled quads only (no postFX, no particles).
    this.trail = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);

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
    rocket.setData('history', [{ x, y }] as TrailPoint[]); // fresh trail history

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
    rocket.setData('history', undefined); // drop the trail so a refire starts clean
  }

  /** Per-frame: advance every active rocket's flight history and redraw the
   *  shared trail. Called from the scene right beside steer(). The exhaust is
   *  the locked shot-trail look: a long faint afterimage under a short tapered
   *  glow/body/core ribbon with a brightness flux scrolling down it. */
  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.trail.clear();
    this.group.children.iterate((child) => {
      const rocket = child as Phaser.Physics.Arcade.Sprite;
      if (!rocket.active) return true;
      let history = rocket.getData('history') as TrailPoint[] | undefined;
      if (!history) {
        history = [{ x: rocket.x, y: rocket.y }];
        rocket.setData('history', history);
      }
      history.unshift({ x: rocket.x, y: rocket.y });
      if (history.length > TRAIL.afterLen) history.pop();

      this.afterimage(history); // long faint light-streak (under)
      this.strip(history, TRAIL.bodyHalf * TRAIL.glowMul, EXHAUST, TRAIL.glowAlpha, TRAIL.bodyFlux); // glow halo
      this.strip(history, TRAIL.bodyHalf, EXHAUST, TRAIL.bodyAlpha, TRAIL.bodyFlux); // violet body
      this.strip(history, TRAIL.coreHalf, 0xffffff, TRAIL.coreAlpha, TRAIL.coreFlux); // white-hot core
      return true;
    });
  }

  /** Thin, near-constant-width line over the long history, alpha fading to 0
   *  along its length → a lingering light-streak of the flight path. */
  private afterimage(h: TrailPoint[]): void {
    const n = Math.min(h.length, TRAIL.afterLen);
    for (let i = 0; i < n - 1; i++) {
      const a = h[i];
      const b = h[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || len > TRAIL.wrapSkip) continue;
      const alpha = TRAIL.afterAlpha * (1 - i / (TRAIL.afterLen - 1));
      if (alpha < 0.012) continue;
      const px = (-dy / len) * TRAIL.afterHalf;
      const py = (dx / len) * TRAIL.afterHalf;
      this.trail.fillStyle(EXHAUST, alpha);
      this.trail.fillPoints(
        [
          new Phaser.Geom.Point(a.x + px, a.y + py),
          new Phaser.Geom.Point(b.x + px, b.y + py),
          new Phaser.Geom.Point(b.x - px, b.y - py),
          new Phaser.Geom.Point(a.x - px, a.y - py),
        ],
        true
      );
    }
  }

  /** Tapered exhaust strip over the first TRAIL.trailLen points. `fluxDepth`
   *  modulates each segment's brightness by a wave that scrolls down the trail. */
  private strip(h: TrailPoint[], halfW: number, color: number, maxAlpha: number, fluxDepth: number): void {
    const count = TRAIL.trailLen;
    const n = Math.min(h.length, count);
    for (let i = 0; i < n - 1; i++) {
      const a = h[i];
      const b = h[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || len > TRAIL.wrapSkip) continue;
      const px = -dy / len;
      const py = dx / len;
      const tA = 1 - i / (count - 1);
      const tB = Math.max(0, 1 - (i + 1) / (count - 1));
      const wA = halfW * tA;
      const wB = halfW * tB;
      const wave = 0.5 + 0.5 * Math.sin(this.elapsed * TRAIL.fluxW - i * TRAIL.fluxPhase);
      const flux = 1 - fluxDepth + fluxDepth * wave;
      this.trail.fillStyle(color, maxAlpha * tA * flux);
      this.trail.fillPoints(
        [
          new Phaser.Geom.Point(a.x + px * wA, a.y + py * wA),
          new Phaser.Geom.Point(b.x + px * wB, b.y + py * wB),
          new Phaser.Geom.Point(b.x - px * wB, b.y - py * wB),
          new Phaser.Geom.Point(a.x - px * wA, a.y - py * wA),
        ],
        true
      );
    }
  }
}
