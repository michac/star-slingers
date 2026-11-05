/**
 * HealingHp (#28 D2, D6) — the hp a space jelly and the mother jelly share.
 * Every hit takes its damage off and restarts the heal's wait; pauseMs after
 * the last hit, hp climbs smoothly back, empty → full in fullMs (fullMs 0 =
 * it never heals: a baby). hp is fractional while it heals, so the health bar
 * (#23) refills smoothly. Runs on the owner's update delta (no tweens).
 */
export class HealingHp {
  private hpLeft = 0;
  private max = 0;
  private pauseMs = 0;
  private fullMs = 0;
  private msSinceHit = 0;

  constructor(maxHp: number, pauseMs: number, fullMs: number) {
    this.reset(maxHp, pauseMs, fullMs);
  }

  get hp(): number {
    return this.hpLeft;
  }
  get maxHp(): number {
    return this.max;
  }
  /** Climbing back toward full: it heals, it's damaged, and its last hit is pauseMs old. */
  get healing(): boolean {
    return this.fullMs > 0 && this.hpLeft < this.max && this.msSinceHit >= this.pauseMs;
  }

  /** Back to full as maxHp, healing on this timing. */
  reset(maxHp: number, pauseMs: number, fullMs: number): void {
    this.hpLeft = this.max = maxHp;
    this.pauseMs = pauseMs;
    this.fullMs = fullMs;
    this.msSinceHit = 0;
  }

  /** Advance the wait, and heal once it's over. */
  tick(deltaMs: number): void {
    this.msSinceHit += deltaMs;
    if (this.healing) this.hpLeft = Math.min(this.max, this.hpLeft + (this.max * deltaMs) / this.fullMs);
  }

  /** Take `damage`, restarting the wait. True when it's the kill (hp is then 0). */
  hit(damage: number): boolean {
    this.hpLeft -= damage;
    this.msSinceHit = 0;
    if (this.hpLeft > 1e-6) return false;
    this.hpLeft = 0;
    return true;
  }

  /** DEV/test: set hp (clamped to 0..max), restarting the wait. */
  set(hp: number): void {
    this.hpLeft = Math.min(this.max, Math.max(0, hp));
    this.msSinceHit = 0;
  }
}
