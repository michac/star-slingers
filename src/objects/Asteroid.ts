/**
 * Asteroid — a drifting target: a bare physics Sprite (no label: size tells
 * standards from splitters, and a two-hit rock is also drawn in a darker,
 * denser shade, #25). It drifts straight
 * left inside the enemy lane, at a y the WaveDirector's sublane bag picks on
 * every (re)spawn; the scene's fleet-contact check decides what reaching the
 * left edge does, and a rock that gets past (a lost ship's sublane) just
 * leaves the field like any other left exit. Pops once its hp runs
 * out (a standard or splitter on one point of damage, a tough rock on two; a
 * damaged rock shows a health bar, drawn by the scene's HealthBars from
 * `hp`/`maxHp`), then asks the
 * WaveDirector for respawn permission (the wave's finite quota); denied
 * respawns park it inactive instead. The wrapper itself is NEVER destroyed
 * or recreated — the scene's rocket→asteroid overlap collider is built once
 * over these sprites, and recreating them would silently kill hit detection.
 * Between waves the director reconfigure()s the same wrappers in place.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, LANE, SCORE, SPLITTER_CHILDREN, type ChildMotion } from '../layout';
import { COLORS } from '../tokens';
import { ASTEROID_KIND, maxHpOf, type AsteroidSpec } from '../waves';
import { ensureAsteroidTexture, TEX } from './textures';

/** A non-lethal hit flashes the rock white this long, so a shot that chips a
 *  tough rock never reads as "my shot didn't work". Counted on update()'s delta
 *  (not a tween/timer), so it stays in lockstep with the e2e stepped clock. */
const HIT_FLASH_MS = 70;

export class Asteroid {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private _spec: AsteroidSpec;
  private spawnGapMax: number;
  private popping = false;
  private active = false;
  /** Splitter child: a one-shot standard rock, not a stream rock. */
  private child = false;
  /** Child lifetime clock — pauses for free behind overlays (update is
   *  frozen then). A hard cap guarantees the wave clears. */
  private aliveMs = 0;
  /** Child spawn grace: body stays off until aliveMs passes this. */
  private graceUntilMs = 0;
  /** Child still in its scatter burst (it turns straight left after
   *  motion.scatterMs). */
  private scattering = false;
  /** A child's scatter, grace and lifetime dials (a splitter's or the giant's burst). */
  private motion: ChildMotion = SPLITTER_CHILDREN;
  /** Current hp; reset to the spec's max on every (re)field. */
  private _hp = 1;
  /** Remaining white hit-flash time (non-lethal hits only). */
  private flashMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    spec: AsteroidSpec,
    spawnGapMax: number,
    /** Asks the wave for quota: true = respawn granted (and spent). */
    private readonly onWantRespawn: () => boolean,
    /** The y for a fresh spawn of a rock this size (the director's sublane bag). */
    private readonly pickY: (radius: number) => number,
    /** Fires the shared burst (B29) at a pop position. */
    private readonly boom: (x: number, y: number, radius: number) => void
  ) {
    this._spec = spec;
    this.spawnGapMax = spawnGapMax;
    ensureAsteroidTexture(scene, spec.kind, spec.radius);
    this.sprite = scene.physics.add.sprite(0, 0, TEX.asteroid(spec.kind, spec.radius));
    this.sprite.setData('ref', this); // collision callback reaches the wrapper
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(spec.radius); // texture is exactly 2r x 2r, so no offset

    this.park(); // starts parked; the director spawn()s it when fielded
  }

  /** Read-only view kept for the scene's contact math and the e2e suite. */
  get spec(): AsteroidSpec {
    return this._spec;
  }

  /** HomingTarget: the collision radius (mirrors spec.radius). */
  get radius(): number {
    return this._spec.radius;
  }

  /** Mid-pop asteroids are out of play (no fleet contact, no rocket hits). */
  get isPopping(): boolean {
    return this.popping;
  }

  /** Parked wrappers don't move, collide, or count toward field-empty. */
  get isActive(): boolean {
    return this.active;
  }

  /** Current hp (the e2e suite's asteroidHp() hook reads it). */
  get hp(): number {
    return this._hp;
  }

  /** Full hp for the current spec. */
  get maxHp(): number {
    return maxHpOf(this._spec);
  }

  /** Splitter children move fast on spawn — the e2e suite's
   *  childrenAlive() hook counts them. */
  get isChild(): boolean {
    return this.child;
  }

  /** Swap this wrapper to a new wave's stream values (texture, body, tuning),
   *  parked — the director spawn()s it against the new wave's quota. */
  reconfigure(spec: AsteroidSpec, spawnGapMax: number): void {
    this.scene.tweens.killTweensOf(this.sprite); // a mid-pop tween would respawn it
    this._spec = spec;
    this.spawnGapMax = spawnGapMax;
    this.child = false; // defensive: a stream reconfigure clears any child identity
    this.aliveMs = 0;
    this.resetHp();
    // Kind and radius may change here; spawnChild needs no swap (child wrappers
    // are built as standards at the child radius).
    ensureAsteroidTexture(this.scene, spec.kind, spec.radius);
    this.sprite.setTexture(TEX.asteroid(spec.kind, spec.radius));
    (this.sprite.body as Phaser.Physics.Arcade.Body).setCircle(spec.radius);
    this.park();
  }

  /** Field this asteroid off the right edge (director-controlled; the
   *  director spends quota BEFORE calling this). */
  spawn(): void {
    this.respawn();
  }

  /** Field this wrapper as a scatter CHILD at (x,y) with velocity
   *  (vx,vy) — a one-shot standard rock. Sibling to spawn(): same wrapper, but
   *  positioned in-field with a scatter burst rather than off the right edge,
   *  and its onWantRespawn returns false so pop/exit/expire just parks it.
   *  After motion.scatterMs (update) it turns from the fast launchSpeed
   *  scatter to straight left at the calmer childSpeed. */
  spawnChild(x: number, y: number, vx: number, vy: number, motion: ChildMotion = SPLITTER_CHILDREN): void {
    this.motion = motion;
    this._spec = {
      kind: 'standard',
      radius: ASTEROID_KIND.standard.radius,
      speed: motion.childSpeed, // the straight-left cruise after the scatter
    };
    this.child = true;
    this.active = true;
    this.popping = false;
    this.scattering = true;
    this.aliveMs = 0;
    this.graceUntilMs = motion.spawnGraceMs;
    this.resetHp();
    this.sprite.setVisible(true).setScale(1).setAlpha(1).setPosition(x, y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y); // resets position AND zeroes velocity — set velocity AFTER
    body.enable = false; // grace: re-enabled in update() once aliveMs passes graceUntilMs
    body.setVelocity(vx, vy);
  }

  update(delta: number): void {
    if (!this.active || this.popping) return;
    if (this.flashMs > 0) {
      this.flashMs -= delta;
      if (this.flashMs <= 0) this.sprite.clearTint();
    }
    if (this.child) {
      this.aliveMs += delta;
      // Spawn grace: keep the body off briefly so a charged round carrying on
      // past the kill that split its parent can't hit it the instant it
      // spawns. The aliveMs clock pauses for free behind overlays.
      const body = this.sprite.body as Phaser.Physics.Arcade.Body;
      if (!body.enable && this.aliveMs >= this.graceUntilMs) body.enable = true;
      // Hard lifetime cap: a child counts toward field-empty, so this
      // guarantees the wave can always clear even if one never reaches the
      // fleet or an edge. Parks (onWantRespawn is false).
      if (this.aliveMs >= this.motion.lifetimeMs) {
        this.respawnOrPark();
        return;
      }
      if (this.scattering) this.scatter(body);
    }
    // Past the left edge: the fleet-contact check didn't stop it (its
    // sublane's ship is lost), so it leaves harmlessly — no damage, no score.
    if (this.sprite.x < -this._spec.radius) {
      this.respawnOrPark();
    }
  }

  /** A child's scatter burst: it may not drift out of the enemy lane, and once
   *  the burst is over it turns straight left at its cruise speed. */
  private scatter(body: Phaser.Physics.Arcade.Body): void {
    if (this.aliveMs >= this.motion.scatterMs) {
      this.scattering = false;
      body.setVelocity(-this._spec.speed, 0);
      return;
    }
    const r = this._spec.radius;
    const { y } = this.sprite;
    const vy = body.velocity.y;
    if ((vy < 0 && y - r <= LANE.top) || (vy > 0 && y + r >= LANE.bottom)) body.setVelocityY(0);
  }

  /** Remove this rock at once: no burst, no score, no respawn (the wave-skip
   *  and clear shortcuts). Parks synchronously, unlike the pop tween. */
  vanish(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.park();
  }

  /** A fleet ship consumed this asteroid (it reached the ship's bubble or hull). */
  consume(): void {
    this.pop();
  }

  /** A rocket hit dealing `damage`. Returns points when it kills the rock (hp
   *  ≤ 0 → pop), else 0 and flashes white (the health bar shows what's left). Scoring is
   *  driven purely from here — consume() (fleet-reached) calls pop() directly
   *  and never scores. */
  takeHit(damage: number): number {
    if (this.popping || !this.active) return 0;
    if (this.child && this.aliveMs < this.graceUntilMs) return 0; // spawn grace
    this._hp -= damage;
    if (this._hp > 0) {
      this.showDamage();
      return 0;
    }
    this.pop();
    return SCORE[this._spec.kind];
  }

  /** Full hp for the current spec, no hit flash. */
  private resetHp(): void {
    this._hp = this.maxHp;
    this.flashMs = 0;
    this.sprite.clearTint();
  }

  /** Non-lethal hit feedback (only reachable when max hp > 1): a brief white
   *  flash. The remaining hp is the health bar's job. */
  private showDamage(): void {
    this.sprite.setTintFill(COLORS.white);
    this.flashMs = HIT_FLASH_MS;
  }

  private pop(): void {
    this.popping = true;
    this.flashMs = 0;
    this.sprite.clearTint(); // a mid-flash kill pops in its real colors
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    // The composed burst (B29) lives independently and self-cleans; the rock
    // itself just snaps bigger and vanishes under the flash, then recycles.
    this.boom(this.sprite.x, this.sprite.y, this._spec.radius);
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.35,
      alpha: 0,
      duration: 110,
      ease: 'Quad.Out',
      onComplete: () => this.respawnOrPark(),
    });
  }

  /** Quota gate: respawn if the wave still has asteroids to field. */
  private respawnOrPark(): void {
    if (this.onWantRespawn()) {
      this.respawn();
    } else {
      this.park();
    }
  }

  private respawn(): void {
    const { radius, speed } = this._spec;
    this.resetHp(); // a damaged rock that reached the fleet comes back whole
    this.active = true;
    this.popping = false;
    const x = GAME_WIDTH + radius + Phaser.Math.Between(0, this.spawnGapMax);
    const y = this.pickY(radius);
    this.sprite.setVisible(true).setScale(1).setAlpha(1).setPosition(x, y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    body.enable = true;
    body.setVelocityX(-speed);
  }

  /** Strictly inactive: invisible, body off, flags reset —
   *  the wave-clear check relies on this being unambiguous. */
  private park(): void {
    this.active = false;
    this.popping = false;
    this.scattering = false;
    this.child = false; // a parked wrapper is a plain free slot again
    this.aliveMs = 0;
    this.graceUntilMs = 0;
    this.sprite.setVisible(false);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
