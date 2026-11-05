/**
 * Jelly (#28) — one of act 3's space jellies, owned by the JellySwarm: a wave
 * jelly (waves 7–8) or one of the mother jelly's babies (wave 9).
 *
 *   parked → swimming → popping → parked
 *
 * It enters just off the right edge and swims in PULSES (a quick surge, then a
 * long glide; JELLY_LAYOUT) at the NEAREST live fleet ship, re-picked every
 * frame, so it turns for another ship the moment its own is lost. It crosses
 * sublanes to get there and stays inside the lane. Its leading edge reaching
 * that ship's contact line (the bubble's front, or the bare hull's nose) hits
 * it like a rock: the fleet pops the shield or loses the ship, and the jelly
 * pops without scoring.
 *
 * Health and healing (#28 D2): every hit counts as its damage (plain 1,
 * charged 2, missile 1, blast 2). After a hit it waits healPauseMs, then its
 * hp climbs smoothly back, empty → full in healFullMs; every hit restarts the
 * wait (HealingHp, shared with the mother jelly). hp is fractional while it
 * heals, so the health bar (#23) refills smoothly; a green halo shows it's
 * healing (the swarm draws it). A baby has 1 hp and no heal.
 *
 * Every timer runs on update()'s delta (no tweens), so it steps in lockstep
 * with the e2e fixed clock. Motion is kinematic: it sets its hit sprite's
 * position each frame and the Arcade body follows (EnemyShip's pattern). The
 * hit sprite is an invisible circle on the dome, built ONCE (parked) so the
 * scene's rocket↔jelly collider never points at a recreated body; what the
 * players see is a separate image that squashes with the swim without
 * resizing the body.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, JELLY_LAYOUT, LANE } from '../layout';
import { COLORS } from '../tokens';
import type { FleetHit } from './Fleet';
import { HealingHp } from './HealingHp';
import type { HomingTarget } from './HomingTarget';
import { fitJellyBody, JELLY_TEX, TEX } from './textures';

export type JellyPhase = 'parked' | 'swimming' | 'popping';

/** What a jelly is: its size, health, speed, heal timing and kill score. */
export interface JellyKind {
  radius: number;
  maxHp: number;
  speed: number; // px/s averaged over a pulse
  healPauseMs: number;
  healFullMs: number; // 0 = never heals (a baby)
  score: number;
}

/** What a jelly asks of its swarm. */
export interface JellyOrders {
  /** The live fleet ship (index) nearest (x, y), or -1 if the fleet is lost. */
  pickTarget(x: number, y: number): number;
  /** Fleet ship i's centre: what it swims at. */
  targetPoint(i: number): { x: number; y: number };
  /** The x its leading edge hits fleet ship i at (Fleet.contactX). */
  contactX(i: number): number;
  /** It reached fleet ship i: the fleet takes the hit. */
  reached(i: number): FleetHit;
  /** It has left play (popped, or reached the fleet): refill its place. */
  onGone(): void;
  /** The shared burst (B29). */
  boom(x: number, y: number, r: number): void;
}

/** The swim's speed through one pulse (u in 0..1): it surges up to surgeMul in
 *  the first surgeFrac, then eases back down to glideMul. Raw, before PULSE_MEAN. */
function pulseRaw(u: number): number {
  const { surgeFrac, surgeMul, glideMul } = JELLY_LAYOUT;
  const span = surgeMul - glideMul;
  if (u < surgeFrac) return glideMul + span * Math.sin((Math.PI / 2) * (u / surgeFrac));
  const v = 1 - (u - surgeFrac) / (1 - surgeFrac);
  return glideMul + span * v * v;
}

/** pulseRaw's mean over a pulse, so `speed` is exactly the pulse's average. */
const PULSE_MEAN = (() => {
  const n = 200;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += pulseRaw((k + 0.5) / n);
  return sum / n;
})();

export class Jelly implements HomingTarget {
  /** The hit circle: invisible, on the dome (the collider's sprite). */
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  /** What the players see: the jelly texture, rotated and squashed. */
  private readonly image: Phaser.GameObjects.Image;
  private phaseState: JellyPhase = 'parked';
  private kind: JellyKind = { radius: JELLY_LAYOUT.radius, maxHp: 1, speed: 0, healPauseMs: 0, healFullMs: 0, score: 0 };
  private readonly life = new HealingHp(1, 0, 0);
  private flashMs = 0;
  private heading = Math.PI; // its direction of travel (radians, 0 = right)
  private t = 0; // ms swimming (the pulse clock), or into its pop
  private targetIndex = -1;
  /** DEV/test: a placed jelly holds still (its heal still runs). */
  private frozen = false;

  constructor(
    scene: Phaser.Scene,
    private readonly orders: JellyOrders
  ) {
    this.sprite = scene.physics.add.sprite(0, 0, TEX.jelly(JELLY_LAYOUT.radius)).setVisible(false).setOrigin(JELLY_TEX.originX, JELLY_TEX.originY);
    this.sprite.setData('ref', this); // collision callback reaches the wrapper
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    this.image = scene.add.image(0, 0, TEX.jelly(JELLY_LAYOUT.radius)).setDepth(2).setOrigin(JELLY_TEX.originX, JELLY_TEX.originY);
    this.park();
  }

  get radius(): number {
    return this.kind.radius;
  }
  get hp(): number {
    return this.life.hp;
  }
  get maxHp(): number {
    return this.life.maxHp;
  }
  get phase(): JellyPhase {
    return this.phaseState;
  }
  get isActive(): boolean {
    return this.phaseState === 'swimming';
  }
  get isPopping(): boolean {
    return this.phaseState === 'popping';
  }
  /** One of the mother jelly's babies (no heal). */
  get isBaby(): boolean {
    return this.kind.healFullMs === 0;
  }
  /** The fleet ship it's swimming at, -1 for none. */
  get target(): number {
    return this.targetIndex;
  }
  /** Climbing back toward full: damaged, and its last hit is healPauseMs old. */
  get healing(): boolean {
    return this.isActive && this.life.healing;
  }

  /** Field it at (x, y) as `kind`, at full hp, swimming left. */
  field(x: number, y: number, kind: JellyKind): void {
    this.kind = kind;
    this.life.reset(kind.maxHp, kind.healPauseMs, kind.healFullMs);
    this.flashMs = 0;
    this.heading = Math.PI;
    this.t = 0;
    this.targetIndex = -1;
    this.frozen = false;
    this.phaseState = 'swimming';
    const key = TEX.jelly(kind.radius);
    this.sprite.setTexture(key);
    this.image.setTexture(key).setVisible(true).setAlpha(1).setScale(1).clearTint();
    fitJellyBody(this.sprite, kind.radius).enable = true;
    this.placeAt(x, y);
  }

  /** Advance it; returns what it did to the fleet if it reached a ship this frame. */
  update(deltaMs: number): FleetHit | null {
    if (this.phaseState === 'parked') return null;
    if (this.phaseState === 'popping') {
      this.t += deltaMs;
      const u = Math.min(1, this.t / JELLY_LAYOUT.popMs);
      this.image.setScale(1 + 0.6 * u).setAlpha(1 - u);
      if (u >= 1) {
        this.park();
        this.orders.onGone();
      }
      return null;
    }
    this.life.tick(deltaMs);
    if (this.flashMs > 0) {
      this.flashMs -= deltaMs;
      if (this.flashMs <= 0) this.image.clearTint();
    }
    if (this.frozen) return null;
    this.t += deltaMs;
    // Steer at the nearest live fleet ship (re-picked every frame).
    this.targetIndex = this.orders.pickTarget(this.sprite.x, this.sprite.y);
    let desired = Math.PI;
    if (this.targetIndex >= 0) {
      const p = this.orders.targetPoint(this.targetIndex);
      desired = Math.atan2(p.y - this.sprite.y, p.x - this.sprite.x);
    }
    const step = Phaser.Math.DegToRad(JELLY_LAYOUT.turnRateDeg) * (deltaMs / 1000);
    // RotateTo's short way needs both angles in −π..π; wrap what it returns.
    this.heading = Phaser.Math.Angle.Wrap(Phaser.Math.Angle.RotateTo(this.heading, desired, step));
    const raw = pulseRaw((this.t % JELLY_LAYOUT.pulseMs) / JELLY_LAYOUT.pulseMs);
    const dist = ((this.kind.speed * raw) / PULSE_MEAN) * (deltaMs / 1000);
    const r = this.kind.radius;
    const x = this.sprite.x + Math.cos(this.heading) * dist;
    const y = Phaser.Math.Clamp(this.sprite.y + Math.sin(this.heading) * dist, LANE.top + r, LANE.bottom - r);
    this.placeAt(x, y);
    // The surge stretches it along its heading, the glide relaxes it.
    const { surgeMul, glideMul, squash } = JELLY_LAYOUT;
    const stretch = squash * ((raw - glideMul) / (surgeMul - glideMul));
    this.image.setScale(1 - 0.7 * stretch, 1 + stretch);
    const i = this.targetIndex;
    if (i >= 0 && x - r <= this.orders.contactX(i)) {
      const hit = this.orders.reached(i);
      this.pop();
      return hit;
    }
    if (x < -2 * r) {
      // No live ship left to swim at (the fleet is lost): gone off the left edge.
      this.park();
      this.orders.onGone();
    }
    return null;
  }

  /** A hit dealing `damage`: restarts the heal's wait. Returns points on a kill, else 0. */
  takeHit(damage: number): number {
    if (!this.isActive) return 0;
    if (!this.life.hit(damage)) {
      this.image.setTintFill(COLORS.white);
      this.flashMs = JELLY_LAYOUT.hitFlashMs;
      return 0;
    }
    this.pop();
    return this.kind.score;
  }

  /** Pop it now, as a kill (the mother jelly's pop takes her babies with
   *  her). Returns its points, or 0 if it wasn't in play. */
  popNow(): number {
    return this.takeHit(Infinity);
  }

  /** Off the field at once, no burst (a wave jump, or a forced clear). */
  vanish(): void {
    this.park();
  }

  /** DEV/test: field it at (x, y) as `kind`, holding still (it heals, never swims). */
  debugPlace(x: number, y: number, kind: JellyKind): void {
    this.field(x, y, kind);
    this.frozen = true;
  }

  private placeAt(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.image.setPosition(x, y).setRotation(this.heading + Math.PI / 2); // the texture's dome points up
  }

  private pop(): void {
    this.phaseState = 'popping';
    this.t = 0;
    this.flashMs = 0;
    this.image.clearTint().setScale(1);
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.orders.boom(this.sprite.x, this.sprite.y, this.kind.radius);
  }

  private park(): void {
    this.phaseState = 'parked';
    this.targetIndex = -1;
    this.frozen = false;
    this.flashMs = 0;
    this.image.setVisible(false).clearTint().setScale(1).setAlpha(1);
    this.placeAt(GAME_WIDTH + 2 * JELLY_LAYOUT.entryGapMax, LANE.top);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
