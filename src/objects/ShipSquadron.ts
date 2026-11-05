/**
 * ShipSquadron (#27) — act 2's ship waves (waves 4–5): the enemy ships and
 * their bolts, both pooled and alive for the whole run (the scene's
 * rocket↔ship collider is built once over `ships`).
 *
 * A ship wave (ShipWaveConfig in waves.ts) fields `onScreen` ships at once
 * from a `quota`; each ship destroyed is replaced from what's left of the
 * quota, entering from the right edge. Every `shieldedEvery`th ship fielded
 * wears a bubble. The wave is clear (isClear) once the quota is spent and the
 * last ship has popped; any bolts still flying then fizzle out.
 *
 * Each ship aims at the NEAREST live fleet ship (#19: the target it steers
 * by, re-picked if that one is lost). A bolt that reaches its fleet ship hits
 * it like a rock; the one that takes the fleet's last ship calls onFleetLost
 * (the scene's fail card).
 */
import Phaser from 'phaser';
import { ENEMY_BOLT, ENEMY_SHIP } from '../layout';
import type { ShipWaveConfig } from '../waves';
import { EnemyBolt } from './EnemyBolt';
import { EnemyShip, type ShipOrders } from './EnemyShip';
import type { Fleet } from './Fleet';

export class ShipSquadron {
  /** The ship pool (parked when not in play). The scene's collider, the
   *  missile picker and the detonator's blast all go over this array. */
  readonly ships: EnemyShip[];
  private readonly bolts: EnemyBolt[];
  private config: ShipWaveConfig | null = null;
  private quotaRemaining = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly fleet: Fleet,
    boom: (x: number, y: number, r: number) => void,
    /** A bolt took the fleet's last ship. */
    private readonly onFleetLost: () => void
  ) {
    const orders: ShipOrders = {
      pickTarget: (_x, y) => this.fleet.nearestLive(y),
      targetPoint: (i) => this.fleet.shipPoint(i),
      fire: (x, y, i) => this.fire(x, y, i),
      onGone: () => this.onShipGone(),
      boom,
    };
    this.ships = Array.from({ length: ENEMY_SHIP.poolSize }, () => new EnemyShip(scene, orders));
    this.bolts = Array.from({ length: ENEMY_BOLT.poolSize }, () => new EnemyBolt(scene));
  }

  /** A ship wave starts: field its first ships. */
  start(config: ShipWaveConfig): void {
    this.stop();
    this.config = config;
    this.quotaRemaining = config.quota;
    for (let i = 0; i < config.onScreen; i++) this.spawn();
  }

  /** Off the field at once: every ship and bolt, and no more spawns (a wave
   *  jump, or a forced clear). */
  stop(): void {
    this.config = null;
    this.quotaRemaining = 0;
    for (const ship of this.ships) ship.vanish();
    for (const bolt of this.bolts) bolt.park();
  }

  /** The quota is spent and no ship is in play (or popping). True when idle. */
  get isClear(): boolean {
    return this.quotaRemaining === 0 && this.ships.every((s) => s.phase === 'parked');
  }

  update(deltaMs: number): void {
    for (const ship of this.ships) ship.update(deltaMs);
    for (const bolt of this.bolts) {
      if (bolt.update(deltaMs, this.fleet) === 'fleetLost') {
        this.onFleetLost();
        return;
      }
    }
  }

  /** DEV/test: the bolts in flight (position + the fleet ship each is at). */
  get debugBolts(): { x: number; y: number; target: number }[] {
    return this.bolts.filter((b) => b.isActive).map((b) => ({ x: b.x, y: b.y, target: b.target }));
  }

  private fire(x: number, y: number, i: number): void {
    const bolt = this.bolts.find((b) => !b.isActive);
    if (!bolt) return; // pool exhausted: that shot is skipped
    const p = this.fleet.shipPoint(i);
    bolt.launch(x, y, i, p.x, p.y);
  }

  private spawn(): void {
    const config = this.config;
    if (!config || this.quotaRemaining <= 0) return;
    const ship = this.ships.find((s) => s.phase === 'parked');
    if (!ship) return;
    this.quotaRemaining -= 1;
    const fielded = config.quota - this.quotaRemaining; // this wave's ships so far, this one included
    const shielded = config.shieldedEvery > 0 && fielded % config.shieldedEvery === 0;
    ship.field(shielded, config.fireEveryMs - ENEMY_SHIP.holdMs);
  }

  /** A ship popped: refill its place from the quota; after the last one,
   *  fizzle any bolts still flying. */
  private onShipGone(): void {
    this.spawn();
    if (this.config && this.isClear) for (const bolt of this.bolts) bolt.fizzle();
  }
}
