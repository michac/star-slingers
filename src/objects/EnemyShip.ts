/**
 * EnemyShip (#27) — one of act 2's enemy ships (waves 4–5), owned by the
 * ShipSquadron. It enters just off the right edge and then repeats:
 *
 *   gliding → holding (warn telegraphMs, fire, a beat) → gliding … | popping → parked
 *
 * A glide eases in and out to a new spot in ENEMY_SHIP.roam, at most hopMax
 * away, nose turning to its heading. In the hold the nose swings to the
 * nearest live fleet ship (re-picked every frame of the warning, so a ship
 * lost meanwhile is dropped), glows brighter for telegraphMs, then the ship
 * fires one bolt at that ship. The first shot comes only after the entry glide.
 *
 * A wave-5 ship wears a one-hit bubble that soaks one point of damage: a plain
 * round or a missile pops it and leaves the ship whole; a charged round or a
 * detonator blast (2) pops it and kills the ship. The hull has 1 hp. Neither
 * shows a health bar (#23: shields never do, and 1 hp never needs one).
 *
 * Every timer runs on update()'s delta (no tweens), so it steps in lockstep
 * with the e2e fixed clock. Motion is kinematic: the ship sets its sprite's
 * position each frame and the Arcade body follows it into the next step (the
 * escorts' pattern). The sprite is created ONCE (parked) so the scene's
 * rocket↔ship overlap collider, built once over the pool, never points at a
 * recreated body. Satisfies HomingTarget, so missiles (single and triple)
 * take it and a detonator's blast reaches it.
 */
import Phaser from 'phaser';
import { ENEMY_SHIP, SCORE } from '../layout';
import { COLORS } from '../tokens';
import { TEX } from './textures';
import type { HomingTarget } from './HomingTarget';

export type ShipPhase = 'parked' | 'gliding' | 'holding' | 'popping';

/** What a ship asks of its squadron. */
export interface ShipOrders {
  /** The fleet ship (index) a shot from (x, y) would go at: the nearest live one, or -1. */
  pickTarget(x: number, y: number): number;
  /** Fleet ship i's centre (where the nose points while warning). */
  targetPoint(i: number): { x: number; y: number };
  /** Fire a bolt from (x, y) at fleet ship i. */
  fire(x: number, y: number, i: number): void;
  /** The ship has left play: popped after a kill. */
  onGone(): void;
  /** The shared burst (B29). */
  boom(x: number, y: number, r: number): void;
}

const { Linear: lerp, SmoothStep } = Phaser.Math;

export class EnemyShip implements HomingTarget {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = ENEMY_SHIP.radius;
  private readonly art: Phaser.GameObjects.Graphics;
  private phaseState: ShipPhase = 'parked';
  private shieldUp = false;
  /** It was fielded with a bubble (the score for a kill). */
  private woreShield = false;
  /** The nose's direction (radians, 0 = right). */
  private heading = Math.PI;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private glideMs = 1;
  /** The glide's heading (radians), fixed for the whole glide. */
  private glideHeading = Math.PI;
  private t = 0; // ms into the current glide, hold or pop
  private fired = false;
  private targetIndex = -1;
  /** DEV/test: a placed ship holds still and never fires on its own. */
  private frozen = false;

  constructor(
    scene: Phaser.Scene,
    private readonly orders: ShipOrders
  ) {
    this.sprite = scene.physics.add.sprite(ENEMY_SHIP.entryX, 0, TEX.enemyShip).setDepth(2);
    this.sprite.setData('ref', this); // collision callback reaches the wrapper
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(this.radius); // the texture is exactly 2r × 2r
    this.art = scene.add.graphics().setDepth(2.1);
    this.park();
  }

  /** Where it is: the sprite is the one copy (motion is kinematic: setPosition). */
  private get x(): number {
    return this.sprite.x;
  }
  private get y(): number {
    return this.sprite.y;
  }

  get phase(): ShipPhase {
    return this.phaseState;
  }
  get isActive(): boolean {
    return this.phaseState === 'gliding' || this.phaseState === 'holding';
  }
  get isPopping(): boolean {
    return this.phaseState === 'popping';
  }
  get shielded(): boolean {
    return this.shieldUp;
  }
  /** Its nose is glowing: it's in the hold, about to fire. */
  get warning(): boolean {
    return this.phaseState === 'holding' && !this.fired; // a placed ship is held with fired set
  }
  /** The fleet ship it's warning (or last fired) at, -1 for none. */
  get target(): number {
    return this.targetIndex;
  }

  /** Field it just off the right edge at a random height in the lane, with
   *  or without a bubble; every later glide lasts glideMs. */
  field(shielded: boolean, glideMs: number): void {
    const { roam } = ENEMY_SHIP;
    this.reset(shielded);
    this.glideMs = Math.max(1, glideMs);
    this.sprite.setPosition(ENEMY_SHIP.entryX, Phaser.Math.FloatBetween(roam.minY, roam.maxY));
    this.startGlide();
  }

  update(deltaMs: number): void {
    if (this.phaseState === 'parked') return;
    if (this.phaseState === 'popping') {
      this.t += deltaMs;
      const u = Math.min(1, this.t / ENEMY_SHIP.popMs);
      this.sprite.setScale(1 + 0.6 * u).setAlpha(1 - u);
      if (u >= 1) {
        this.park();
        this.orders.onGone();
      }
      return;
    }
    if (this.frozen) return this.draw();
    this.t += deltaMs;
    let desired = this.heading;
    if (this.phaseState === 'gliding') {
      const e = SmoothStep(this.t, 0, this.glideMs);
      this.sprite.setPosition(lerp(this.fromX, this.toX, e), lerp(this.fromY, this.toY, e));
      desired = this.glideHeading;
      if (e >= 1) this.startHold();
    } else {
      if (!this.fired) {
        this.targetIndex = this.orders.pickTarget(this.x, this.y);
        if (this.t >= ENEMY_SHIP.telegraphMs) this.fire();
      }
      if (this.targetIndex >= 0) {
        const p = this.orders.targetPoint(this.targetIndex);
        desired = Math.atan2(p.y - this.y, p.x - this.x);
      }
      if (this.t >= ENEMY_SHIP.holdMs) this.startGlide();
    }
    this.turnToward(desired, deltaMs);
    this.draw();
  }

  /** A hit dealing `damage`. A bubble soaks the first point; whatever's left
   *  kills the 1-hp hull. Returns points on a kill, else 0. */
  takeHit(damage: number): number {
    if (!this.isActive) return 0;
    let left = damage;
    if (this.shieldUp) {
      this.shieldUp = false;
      left -= 1;
      this.orders.boom(this.x, this.y, ENEMY_SHIP.shield.r * 0.4);
    }
    if (left <= 0) {
      this.draw();
      return 0;
    }
    this.pop();
    return this.woreShield ? SCORE.shieldedShip : SCORE.ship;
  }

  /** Off the field at once, no burst (a wave jump, or the wave's end). */
  vanish(): void {
    this.park();
  }

  /** DEV/test: field it at (x, y), holding still, never firing on its own. */
  debugPlace(x: number, y: number, shielded: boolean): void {
    this.reset(shielded);
    this.frozen = true;
    this.phaseState = 'holding';
    this.fired = true; // a placed ship fires only through debugFire
    this.sprite.setPosition(x, y);
    this.draw();
  }

  /** DEV/test: fire now at the nearest live fleet ship (what the hold's shot does). */
  debugFire(): void {
    if (!this.isActive) return;
    this.targetIndex = this.orders.pickTarget(this.x, this.y);
    this.fire();
  }

  private reset(shielded: boolean): void {
    this.shieldUp = shielded;
    this.woreShield = shielded;
    this.targetIndex = -1;
    this.fired = false;
    this.t = 0;
    this.heading = Math.PI; // nose left, into the lane
    this.sprite.setVisible(true).setScale(1).setAlpha(1);
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
  }

  private fire(): void {
    this.fired = true;
    if (this.targetIndex < 0) return; // nothing left to shoot at
    const r = this.radius;
    this.orders.fire(this.x + Math.cos(this.heading) * r, this.y + Math.sin(this.heading) * r, this.targetIndex);
  }

  /** Ease toward a new spot at most hopMax away, inside the roam box. */
  private startGlide(): void {
    const { roam, hopMax } = ENEMY_SHIP;
    this.phaseState = 'gliding';
    this.t = 0;
    this.fromX = this.x;
    this.fromY = this.y;
    const a = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    const d = Phaser.Math.FloatBetween(hopMax * 0.4, hopMax);
    this.toX = Phaser.Math.Clamp(this.x + Math.cos(a) * d, roam.minX, roam.maxX);
    this.toY = Phaser.Math.Clamp(this.y + Math.sin(a) * d, roam.minY, roam.maxY);
    this.glideHeading = Math.atan2(this.toY - this.fromY, this.toX - this.fromX);
  }

  private startHold(): void {
    this.phaseState = 'holding';
    this.t = 0;
    this.fired = false;
    this.targetIndex = this.orders.pickTarget(this.x, this.y); // warning starts on a target
  }

  private turnToward(angle: number, deltaMs: number): void {
    const step = Phaser.Math.DegToRad(ENEMY_SHIP.turnRateDeg) * (deltaMs / 1000);
    this.heading = Phaser.Math.Angle.RotateTo(this.heading, angle, step);
  }

  /** The hull's rotation, the bubble ring and the warning glow at the nose. */
  private draw(): void {
    this.sprite.setRotation(this.heading + Math.PI / 2); // the texture's nose points up
    const g = this.art.clear();
    if (!this.isActive) return;
    if (this.shieldUp) {
      const { r, width, alpha } = ENEMY_SHIP.shield;
      g.lineStyle(width, COLORS.danger, alpha);
      g.strokeCircle(this.x, this.y, r);
    }
    if (this.warning) {
      const frac = Math.min(1, this.t / ENEMY_SHIP.telegraphMs);
      const { r, alpha } = ENEMY_SHIP.glow;
      const nx = this.x + Math.cos(this.heading) * this.radius * 0.8;
      const ny = this.y + Math.sin(this.heading) * this.radius * 0.8;
      g.fillStyle(COLORS.danger, alpha * frac * 0.6);
      g.fillCircle(nx, ny, r * (0.6 + 0.6 * frac));
      g.fillStyle(COLORS.white, alpha * frac);
      g.fillCircle(nx, ny, r * (0.3 + 0.4 * frac));
    }
  }

  private pop(): void {
    this.phaseState = 'popping';
    this.t = 0;
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.art.clear();
    this.orders.boom(this.x, this.y, this.radius);
  }

  private park(): void {
    this.phaseState = 'parked';
    this.shieldUp = false;
    this.targetIndex = -1;
    this.frozen = false;
    this.art.clear();
    this.sprite.setVisible(false).setScale(1).setAlpha(1);
    this.sprite.setPosition(ENEMY_SHIP.entryX, ENEMY_SHIP.roam.minY);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
