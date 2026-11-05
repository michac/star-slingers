/**
 * RocketPool — pooled arcade-physics sprites for both players' shots: FIRE
 * rounds (plain or charged), SPECIAL homing missiles (#22) and detonator bombs
 * (#26: straight; wherever a flight ends without a hit, end() hands a bomb to
 * `onBombEnd` to blow up there instead of recycling it quietly). Rounds fly
 * straight (no gravity) and recycle at the world bounds or on a hit (a charged
 * round carries on past a kill, see the scene's spendShot). Missiles carry a
 * target and get steered toward it each frame by steer().
 */
import Phaser from 'phaser';
import { MISSILE, TRAIL } from '../layout';
import { COLORS } from '../tokens';
import { specialCanHit, type HomingTarget } from './HomingTarget';
import { TEX } from './textures';

export type PlayerId = 'p1' | 'p2';

/** Optional shot modifiers applied at fire time. */
export interface ShotOptions {
  /** A charged FIRE round: double damage, carries on past a kill, bright trail tier. */
  charged?: boolean;
  /** A SPECIAL homing missile: steered by steer(). */
  missile?: boolean;
  /** The missile's target at launch; null/absent = it acquires one in flight. */
  target?: HomingTarget | null;
  /** A SPECIAL detonator bomb (#26): flies straight until the scene blows it up. */
  bomb?: boolean;
}

/** Picks a missile's target: the live enemy nearest the line from (ox, oy)
 *  along (dirx, diry), inside MISSILE's cone and range, or null. */
export type AcquireTarget = (ox: number, oy: number, dirx: number, diry: number) => HomingTarget | null;

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

  constructor(
    scene: Phaser.Scene,
    /** A bomb's flight ended (end()): the scene blows it up there (and recycles it). */
    private readonly onBombEnd: (rocket: Phaser.Physics.Arcade.Sprite) => void
  ) {
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
        if (go?.getData('isRocket')) this.end(go as Phaser.Physics.Arcade.Sprite);
      }
    );
  }

  /** Returns the launched sprite (or null if the pool is exhausted). A fresh
   *  rocket starts plain; `opts` makes it a charged round or a missile.
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
    rocket.setData('missile', false); // pooled sprite may carry a stale flag
    rocket.setData('charged', false); // pooled sprite may carry a stale flag
    rocket.setData('bomb', opts.bomb === true);
    rocket.setData('player', player); // B33: escorts need one hit from each seat
    rocket.setData('dist', 0); // reset travelled distance for the arm/ramp curve
    rocket.setData('age', 0); // ms in flight (the missile's lifetime cap)
    rocket.setData('history', [{ x, y }] as TrailPoint[]); // fresh trail history
    if (opts.charged) rocket.setData('charged', true);
    if (opts.missile) this.arm(rocket, opts.target ?? null, x, y, vx, vy);

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

  /** This shot's flight ends here without a hit (the world bounds, the
   *  boss's shield web): a bomb goes to `onBombEnd` to blow up, anything else
   *  recycles. */
  end(rocket: Phaser.Physics.Arcade.Sprite): void {
    if (rocket.getData('bomb')) this.onBombEnd(rocket);
    else this.recycle(rocket);
  }

  /** End (end()) every live rocket the predicate selects (e.g. ones the
   *  boss's shield web blocks this frame). Returns how many it ended. */
  endWhere(pred: (rocket: Phaser.Physics.Arcade.Sprite) => boolean): number {
    let ended = 0;
    this.group.children.iterate((child) => {
      const rocket = child as Phaser.Physics.Arcade.Sprite;
      if (rocket.active && pred(rocket)) {
        this.end(rocket);
        ended += 1;
      }
      return true;
    });
    return ended;
  }

  /** Arm a missile: steer() reads these keys. The straight arming run is
   *  capped at MISSILE.armFraction of the way to a close target, so it can't
   *  sail past it. */
  private arm(rocket: Phaser.Physics.Arcade.Sprite, target: HomingTarget | null, x: number, y: number, vx: number, vy: number): void {
    rocket.setData('missile', true);
    rocket.setData('target', target);
    rocket.setData('speed', Math.hypot(vx, vy));
    const toTarget = target ? Phaser.Math.Distance.Between(x, y, target.sprite.x, target.sprite.y) : Infinity;
    rocket.setData('armAt', Math.min(MISSILE.armDistancePx, toTarget * MISSILE.armFraction));
  }

  /** Per-frame missile steering (#22). Each missile flies STRAIGHT for its
   *  arming run, then its turn-rate eases 0→full over MISSILE.rampDistancePx and
   *  it pursues hard. Whenever it has no live target (none at launch, or the one
   *  it had died) it asks `acquire` for the enemy nearest its CURRENT heading,
   *  so it is hard to miss. A missile still flying after MISSILE.lifetimeMs
   *  recycles (no endless orbiting). */
  steer(deltaMs: number, acquire: AcquireTarget): void {
    const fullTurn = Phaser.Math.DegToRad(MISSILE.turnRateDeg) * (deltaMs / 1000);
    this.group.children.iterate((child) => {
      const rocket = child as Phaser.Physics.Arcade.Sprite;
      if (!rocket.active || !rocket.getData('missile')) return true;
      const age = ((rocket.getData('age') as number) ?? 0) + deltaMs;
      rocket.setData('age', age);
      if (age >= MISSILE.lifetimeMs) {
        this.recycle(rocket);
        return true;
      }
      const body = rocket.body as Phaser.Physics.Arcade.Body;
      const speed = rocket.getData('speed') as number;

      // Advance the missile's travelled distance, then derive how much of the
      // turn-rate is unlocked: nothing until armed, then eased in over the ramp.
      const dist = ((rocket.getData('dist') as number) ?? 0) + (speed * deltaMs) / 1000;
      rocket.setData('dist', dist);
      const armAt = (rocket.getData('armAt') as number) ?? MISSILE.armDistancePx;
      const ramp = (dist - armAt) / MISSILE.rampDistancePx;
      if (ramp <= 0) return true; // still in the straight arming run
      const maxTurn = fullTurn * Math.min(1, ramp);

      let target = rocket.getData('target') as HomingTarget | null;
      if (!target || !specialCanHit(target)) {
        target = acquire(rocket.x, rocket.y, body.velocity.x, body.velocity.y);
        rocket.setData('target', target);
        if (!target) return true; // nothing in its cone: fly straight, keep looking
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
    rocket.setData('charged', false); // clear the shot-kind flags…
    rocket.setData('missile', false);
    rocket.setData('bomb', false);
    rocket.setData('target', null); // …and drop its target ref
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
      // baseline; any other shot gets a subdued multiplier set. So the in-flight
      // trail doubles as the "this was a charged round" read.
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
