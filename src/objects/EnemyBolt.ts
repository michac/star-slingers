/**
 * EnemyBolt (#27) — an enemy ship's shot: a big, slow, glowing magenta ball
 * flying straight at one fleet ship. Nothing can shoot it down (#27 D10), so
 * it's a plain image with no physics body and no collider.
 *
 * When its leading edge reaches that ship's contact line (the bubble's front,
 * or the bare hull's nose) it acts like a rock: the fleet pops the shield, or
 * loses the ship. If that ship was lost while the bolt flew, the bolt flies
 * on past and leaves off the left edge harmlessly. Moved on update()'s delta,
 * so it steps with the e2e fixed clock. Pooled by the ShipSquadron.
 */
import Phaser from 'phaser';
import { ENEMY_BOLT } from '../layout';
import type { Fleet, FleetHit } from './Fleet';
import { TEX } from './textures';

export class EnemyBolt {
  private readonly image: Phaser.GameObjects.Image;
  private active = false;
  private fizzleMs = -1; // ≥ 0 while it fades out (the wave was won)
  private targetIndex = -1;
  private vx = 0;
  private vy = 0;

  constructor(scene: Phaser.Scene) {
    this.image = scene.add.image(0, 0, TEX.enemyBolt).setDepth(2.5).setVisible(false);
  }

  get isActive(): boolean {
    return this.active;
  }
  get target(): number {
    return this.targetIndex;
  }
  get x(): number {
    return this.image.x;
  }
  get y(): number {
    return this.image.y;
  }

  /** Fly from (x, y) toward (toX, toY), at fleet ship `target`. */
  launch(x: number, y: number, target: number, toX: number, toY: number): void {
    const len = Math.hypot(toX - x, toY - y) || 1;
    this.vx = ((toX - x) / len) * ENEMY_BOLT.speed;
    this.vy = ((toY - y) / len) * ENEMY_BOLT.speed;
    this.targetIndex = target;
    this.active = true; // fizzleMs is already -1: only a parked bolt launches
    this.image.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
  }

  /** Advance it; returns what it did to the fleet if it hit a ship this frame. */
  update(deltaMs: number, fleet: Fleet): FleetHit | null {
    if (!this.active) return null;
    if (this.fizzleMs >= 0) {
      this.fizzleMs += deltaMs;
      const u = Math.min(1, this.fizzleMs / ENEMY_BOLT.fizzleMs);
      this.image.setAlpha(1 - u).setScale(1 - 0.5 * u);
      if (u >= 1) this.park();
      return null;
    }
    const dt = deltaMs / 1000;
    const x = this.image.x + this.vx * dt;
    const y = this.image.y + this.vy * dt;
    this.image.setPosition(x, y);
    const r = ENEMY_BOLT.radius;
    const i = this.targetIndex;
    if (fleet.isLive(i) && x - r <= fleet.contactX(i)) {
      this.park();
      return fleet.onEnemyReached(i);
    }
    if (x < -2 * r) this.park(); // its ship was lost on the way: gone, harmlessly
    return null;
  }

  /** Fade out where it is (the wave's last ship is down). */
  fizzle(): void {
    if (this.active && this.fizzleMs < 0) this.fizzleMs = 0;
  }

  park(): void {
    this.active = false;
    this.fizzleMs = -1;
    this.targetIndex = -1;
    this.image.setVisible(false);
  }
}
