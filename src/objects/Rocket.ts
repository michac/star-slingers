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
import { TEX } from './textures';

export type PlayerId = 'p1' | 'p2';

/** Optional shot modifiers applied at fire time. */
export interface ShotOptions {
  /** B13 railgun: pierces asteroids and wears the bright trail tier. */
  charged?: boolean;
  /** B14 homing lock picked at fire; null/absent = a straight shot. */
  target?: HomingTarget | null;
}

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

  /** Returns the launched sprite (or null if the pool is exhausted). A fresh
   *  rocket starts plain; `opts` makes it a railgun and/or locks a homing target.
   *  (The e2e suite also tags rockets directly via the same setData keys.) */
  fire(
    textureKey: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    player: PlayerId = textureKey === TEX.rocketP2 ? 'p2' : 'p1',
    opts: ShotOptions = {}
  ): Phaser.Physics.Arcade.Sprite | null {
    const rocket = this.group.get(x, y, textureKey) as Phaser.Physics.Arcade.Sprite | null;
    if (!rocket) return null; // pool exhausted
    rocket.setTexture(textureKey); // pooled sprite may carry the other player's
    rocket.setActive(true).setVisible(true);
    rocket.setData('isRocket', true);
    rocket.setData('homing', false); // pooled sprite may carry a stale flag
    rocket.setData('charged', false); // B13: pooled sprite may carry a stale flag
    rocket.setData('player', player); // B33: escorts need one hit from each seat
    rocket.setData('hitSet', new Set()); // B13: rocks this railgun has chipped
    rocket.setData('dist', 0); // reset travelled distance for the arm/ramp curve
    rocket.setData('history', [{ x, y }] as TrailPoint[]); // fresh trail history
    if (opts.charged) rocket.setData('charged', true);
    if (opts.target) this.lockOn(rocket, opts.target, x, y, vx, vy);

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

  /** Recycle every live rocket the predicate selects (e.g. ones the boss's
   *  shield web blocks this frame). */
  recycleWhere(pred: (rocket: Phaser.Physics.Arcade.Sprite) => boolean): void {
    this.group.children.iterate((child) => {
      const rocket = child as Phaser.Physics.Arcade.Sprite;
      if (rocket.active && pred(rocket)) this.recycle(rocket);
      return true;
    });
  }

  /** Arm a homing shot (B14): steer() reads these keys. The straight arming
   *  run is capped so it can't sail past a closer target. */
  private lockOn(rocket: Phaser.Physics.Arcade.Sprite, target: HomingTarget, x: number, y: number, vx: number, vy: number): void {
    rocket.setData('homing', true);
    rocket.setData('target', target);
    rocket.setData('speed', Math.hypot(vx, vy));
    const toTarget = Phaser.Math.Distance.Between(x, y, target.sprite.x, target.sprite.y);
    rocket.setData('armAt', Math.min(HOMING.armDistancePx, toTarget * HOMING.armFraction));
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
    rocket.setData('charged', false); // B13: clear the railgun flag…
    rocket.setData('hitSet', undefined); // …and drop its pierced-rock refs
    rocket.setData('player', undefined);
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
      // Reuse the dropped tail point as the new head (no per-frame allocation).
      const head = history.length >= TRAIL.afterLen ? history.pop()! : { x: 0, y: 0 };
      head.x = rocket.x;
      head.y = rocket.y;
      history.unshift(head);

      // Per-rocket trail tier (B13): the absolute TRAIL values are the CHARGED
      // (railgun) baseline; a normal shot gets a subdued multiplier set. So the
      // in-flight trail doubles as the "this was a railgun" read.
      const m = rocket.getData('charged') ? TRAIL.chargedMul : TRAIL.normalMul;
      this.afterimage(history, m.alpha, m.width, m.len); // long faint light-streak (under)
      this.strip(history, TRAIL.bodyHalf * TRAIL.glowMul * m.width, EXHAUST, TRAIL.glowAlpha * m.alpha, TRAIL.bodyFlux, m.len); // glow halo
      this.strip(history, TRAIL.bodyHalf * m.width, EXHAUST, TRAIL.bodyAlpha * m.alpha, TRAIL.bodyFlux, m.len); // violet body
      this.strip(history, TRAIL.coreHalf * m.width, COLORS.white, TRAIL.coreAlpha * m.alpha, TRAIL.coreFlux, m.len); // white-hot core
      return true;
    });
  }

  /** Thin, near-constant-width line over the long history, alpha fading to 0
   *  along its length → a lingering light-streak of the flight path. Tier
   *  multipliers (B13): `alphaMul`/`widthMul` dim+thin it, `lenMul` shortens it. */
  private afterimage(h: TrailPoint[], alphaMul: number, widthMul: number, lenMul: number): void {
    const effLen = Math.max(2, Math.round(TRAIL.afterLen * lenMul));
    const n = Math.min(h.length, effLen);
    const half = TRAIL.afterHalf * widthMul;
    for (let i = 0; i < n - 1; i++) {
      const a = h[i];
      const b = h[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || len > TRAIL.wrapSkip) continue;
      const alpha = TRAIL.afterAlpha * alphaMul * (1 - i / (effLen - 1));
      if (alpha < 0.012) continue;
      const px = (-dy / len) * half;
      const py = (dx / len) * half;
      this.trail.fillStyle(EXHAUST, alpha);
      this.quad(a.x + px, a.y + py, b.x + px, b.y + py, b.x - px, b.y - py, a.x - px, a.y - py);
    }
  }

  /** Tapered exhaust strip over the first TRAIL.trailLen points. `fluxDepth`
   *  modulates each segment's brightness by a wave that scrolls down the trail.
   *  `lenMul` (B13) shortens the ribbon for the subdued normal-shot tier. */
  private strip(h: TrailPoint[], halfW: number, color: number, maxAlpha: number, fluxDepth: number, lenMul: number): void {
    const count = Math.max(2, Math.round(TRAIL.trailLen * lenMul));
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
      this.quad(
        a.x + px * wA, a.y + py * wA,
        b.x + px * wB, b.y + py * wB,
        b.x - px * wB, b.y - py * wB,
        a.x - px * wA, a.y - py * wA
      );
    }
  }

  /** Convex quad p0→p1→p2→p3 as two triangles: plain numbers, so no Point /
   *  path allocation or Earcut pass per segment per frame (fillPoints did
   *  both). Shared-edge triangles don't overlap, so ADD blending is unchanged. */
  private quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.trail.fillTriangle(x0, y0, x1, y1, x2, y2);
    this.trail.fillTriangle(x0, y0, x2, y2, x3, y3);
  }
}
