/**
 * GiantAsteroid (#25) — act 1's boss, wave 3. A boulder that enters just off
 * the right edge, centred on the lane, and drifts straight left at the fleet
 * (GIANT.travelMs from the right edge to the bubble fronts). It comes alone.
 *
 *   parked → drifting → popped | reachedFleet
 *
 * Only charged FIRE rounds hurt it (the scene's handleGiantHit routes every
 * rocket here; plain rounds and missiles are refused with a grey spark, and
 * it's never a missile target). Solo: each charged hit is one point. Two
 * seats: a charged hit from one seat lights a ring round it in that seat's
 * colour for GIANT.pairWindowMs; the OTHER seat's charged hit while it's lit
 * is the point (the escorts' two-lock idea, in time). The same seat again
 * just relights its own ring. A damaging hit flashes it white, and the
 * scene's HealthBars shows what's left once it's damaged (it has the
 * HealthBarTarget shape).
 *
 * At 0 hp it pops (`onPopped(x, y)`: the WaveDirector bursts it into
 * GIANT.burstCount one-hit rocks); reaching the fleet calls `onReachedFleet`
 * (the scene loses the whole fleet). Every timer runs on update()'s delta, so
 * it steps in lockstep with the e2e fixed clock; the only tween is the
 * cosmetic pop fade, after the logic has already moved on.
 *
 * The sprite is created ONCE (parked) so the scene's rocket↔giant overlap
 * collider, built once over it, never points at a recreated body.
 */
import Phaser from 'phaser';
import { FLEET, GAME_WIDTH, GIANT_LAYOUT } from '../layout';
import { COLORS } from '../tokens';
import { GIANT } from '../waves';
import { TEX } from './textures';
import type { PlayerId } from './Rocket';

/** What a rocket hit did: refused (not a charged round), lit this seat's lock
 *  ring, took a point, or popped it. */
export type GiantHit = 'refused' | 'locked' | 'damaged' | 'popped';

/** Drift speed (px/s): the leading edge's trip from the right edge to the bubble fronts in travelMs. */
const SPEED = (GAME_WIDTH - FLEET.bubbleFrontX) / (GIANT.travelMs / 1000);

export class GiantAsteroid {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = GIANT_LAYOUT.radius;
  readonly maxHp: number = GIANT.hp;
  private hpLeft: number = GIANT.hp;
  private active = false;
  private flashMs = 0;
  /** The seat whose charged hit is waiting for the other seat's (two-player). */
  private lockSeat: PlayerId | null = null;
  private lockMs = 0;
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    /** One joined seat: every charged hit counts on its own. */
    private readonly solo: boolean,
    /** Its leading edge reached the fleet's bubble fronts. */
    private readonly onReachedFleet: () => void,
    /** Its last point went: burst it here. */
    private readonly onPopped: (x: number, y: number) => void
  ) {
    this.sprite = scene.physics.add.sprite(0, GIANT_LAYOUT.y, TEX.giantAsteroid);
    this.sprite.setData('ref', this);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(this.radius); // the texture is exactly 2r × 2r
    this.ring = scene.add.graphics().setDepth(1);
    this.park();
  }

  get hp(): number {
    return this.hpLeft;
  }

  /** In play (drifting): a rocket target and a health-bar target. */
  get isActive(): boolean {
    return this.active;
  }

  /** HealthBarTarget: it pops in one frame, so it's never mid-pop in play. */
  get isPopping(): boolean {
    return false;
  }

  /** The seat whose lock ring is lit, or null (the e2e giant() hook). */
  get lock(): PlayerId | null {
    return this.lockSeat;
  }

  /** The wave starts: enter just off the right edge, at full hp, drifting left. */
  start(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.active = true;
    this.hpLeft = GIANT.hp;
    this.clearLock();
    this.flashMs = 0;
    const x = GAME_WIDTH + this.radius;
    this.sprite.setVisible(true).setScale(1).setAlpha(1).clearTint().setPosition(x, GIANT_LAYOUT.y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, GIANT_LAYOUT.y); // zeroes velocity: set it after
    body.enable = true;
    body.setVelocityX(-SPEED);
  }

  /** Off the field (a wave jump away from it). */
  stop(): void {
    this.park();
  }

  update(delta: number): void {
    if (!this.active) return;
    if (this.flashMs > 0) {
      this.flashMs -= delta;
      if (this.flashMs <= 0) this.sprite.clearTint();
    }
    if (this.lockSeat) {
      this.lockMs -= delta;
      if (this.lockMs <= 0) this.clearLock();
    }
    this.drawRing();
    if (this.sprite.x - this.radius <= FLEET.bubbleFrontX) {
      // It got there: freeze it where it hit and hand over to the scene.
      this.active = false;
      this.clearLock();
      const body = this.sprite.body as Phaser.Physics.Arcade.Body;
      body.stop();
      body.enable = false;
      this.onReachedFleet();
    }
  }

  /** A rocket from `player` hit it. Only a charged round can count (see the header). */
  takeHit(player: PlayerId, charged: boolean): GiantHit {
    if (!this.active || !charged) return 'refused';
    if (!this.solo && this.lockSeat !== (player === 'p1' ? 'p2' : 'p1')) {
      // First of a pair (or the same seat again): light/relight this seat's ring.
      this.lockSeat = player;
      this.lockMs = GIANT.pairWindowMs;
      this.drawRing();
      return 'locked';
    }
    this.clearLock();
    this.hpLeft -= 1;
    if (this.hpLeft > 0) {
      this.sprite.setTintFill(COLORS.white);
      this.flashMs = GIANT_LAYOUT.hitFlashMs;
      return 'damaged';
    }
    this.pop();
    return 'popped';
  }

  /** DEV/test: pop it now, through the real pop path. */
  debugDefeat(): void {
    if (!this.active) return;
    this.hpLeft = 0;
    this.pop();
  }

  /** DEV/test: put it at x (its centre), still drifting. */
  debugSetX(x: number): void {
    if (!this.active) return;
    this.sprite.setPosition(x, this.sprite.y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, this.sprite.y);
    body.setVelocityX(-SPEED);
  }

  private pop(): void {
    const { x, y } = this.sprite;
    this.active = false;
    this.clearLock();
    this.flashMs = 0;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.sprite.clearTint();
    this.onPopped(x, y);
    // Cosmetic only: the boulder swells and fades under the burst.
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.3,
      alpha: 0,
      duration: 160,
      ease: 'Quad.Out',
      onComplete: () => {
        if (!this.active) this.sprite.setVisible(false);
      },
    });
  }

  private clearLock(): void {
    this.lockSeat = null;
    this.lockMs = 0;
    this.ring.clear();
  }

  /** The waiting seat's ring, fading as its window runs out. */
  private drawRing(): void {
    this.ring.clear();
    if (!this.lockSeat) return;
    const { pad, width, alpha } = GIANT_LAYOUT.ring;
    const color = this.lockSeat === 'p1' ? COLORS.p1 : COLORS.p2;
    this.ring.lineStyle(width, color, alpha * Math.max(0.25, this.lockMs / GIANT.pairWindowMs));
    this.ring.strokeCircle(this.sprite.x, this.sprite.y, this.radius + pad);
  }

  private park(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.active = false;
    this.clearLock();
    this.flashMs = 0;
    this.sprite.setVisible(false).clearTint();
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
