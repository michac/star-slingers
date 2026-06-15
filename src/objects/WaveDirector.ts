/**
 * WaveDirector — owns the run: which wave is live, its finite asteroid
 * quota, the wave-clear check, the breather (shield restore + banner), and
 * the hand-off to the final boss after the last wave. State machine:
 *
 *   live → breather → (next wave) live … → done (boss takes over)
 *
 * Wave 1 starts directly in `live` with no banner — a banner before the
 * very first wave adds nothing, and smoke.mjs needs asteroids on-field
 * within seconds of boot. A run lost mid-wave restarts via scene.restart()
 * (the fail overlay), which rebuilds this object from constants — so no
 * reset logic lives here.
 */
import Phaser from 'phaser';
import { SPLIT } from '../layout';
import {
  asteroidsFor,
  BREATHER,
  DIFFICULTY_MODEL,
  LANE_SLOTS,
  RADIUS_BY_HITS,
  WAVES,
} from '../waves';
import { Asteroid } from './Asteroid';
import { Station } from './Station';
import { PlayerHud } from './PlayerHud';
import { WaveBanner } from './WaveBanner';

type WaveState = 'live' | 'breather' | 'done';

export class WaveDirector {
  /** One wrapper per lane slot PLUS the B30 fragment pool, all alive for the
   *  whole run (see Asteroid's header: the overlap collider depends on these
   *  never being recreated). The fragment wrappers are the tail of this array. */
  readonly asteroids: Asteroid[];

  /** The B30 fragment pool — the tail of `asteroids` (indices ≥ lane count).
   *  Only these are fielded as split fragments; lane wrappers never are. */
  private readonly fragmentPool: Asteroid[];

  private waveIndex = 0;
  private quotaRemaining = 0;
  private state: WaveState = 'live';
  /** Cumulative split events (B30) — a deterministic signal for smoke.mjs. */
  splitCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly station: Station,
    private readonly huds: PlayerHud[],
    private readonly banner: WaveBanner,
    /** Called once the last wave clears — the scene starts the boss (B5). */
    private readonly onRunCleared: () => void,
    /** The shared asteroid burst (B29), forwarded into every Asteroid. */
    private readonly boom: (x: number, y: number, radius: number) => void,
    /** Wave-clear celebration (B7) — fires the star-shower on every clear. */
    private readonly celebrate: () => void
  ) {
    const specs1 = asteroidsFor(WAVES[0]);
    // One wrapper per physical lane slot, alive for the whole run (later
    // waves field more lanes than wave 1); slots without a wave-1 spec get a
    // weak default and stay parked until a wave fields them.
    this.asteroids = LANE_SLOTS.map(
      (slot, i) =>
        new Asteroid(
          this.scene,
          specs1[i] ?? {
            radius: RADIUS_BY_HITS[1],
            hits: 1,
            y: slot.y,
            speed: slot.baseSpeed * DIFFICULTY_MODEL.minSpeedScale,
          },
          DIFFICULTY_MODEL.spawnGapMax,
          () => this.grantRespawn(),
          this.boom
        )
    );
    // B30: append dedicated FRAGMENT wrappers to the SAME array, parked. They
    // join here (before SandboxScene builds the rocket→asteroid collider once
    // over this.asteroids), so they get the collider + update loop + station
    // contact + homing + field-empty checks for free. They differ from lane
    // rocks in exactly two ways: onWantRespawn returns false (one-shot — they
    // park rather than respawn off the right edge), and they're fielded via
    // spawnFragment() at a scatter position. Their indices are ≥ lane count, so
    // startWave's specs[i] is undefined for them and waves never field them.
    this.fragmentPool = Array.from(
      { length: SPLIT.poolSize },
      () =>
        new Asteroid(
          this.scene,
          { radius: SPLIT.fragmentRadius, hits: 1, y: 0, speed: SPLIT.fragmentSpeed },
          DIFFICULTY_MODEL.spawnGapMax,
          () => false, // one-shot: never respawns off the right edge
          this.boom
        )
    );
    this.asteroids.push(...this.fragmentPool);
    this.startWave(0);
  }

  get stateName(): WaveState {
    return this.state;
  }

  /** 1-based, for HUDs/banner/tests. */
  get waveNumber(): number {
    return this.waveIndex + 1;
  }

  /** Per-frame (scene update, frozen while overlays show): the wave clears
   *  when its quota is spent AND the field has drained empty. */
  update(_delta: number): void {
    if (this.state !== 'live') return;
    if (this.quotaRemaining > 0) return;
    if (this.asteroids.some((a) => a.isActive || a.isPopping)) return;
    this.onWaveCleared();
  }

  /** DEV/test hook: end the current wave now (pops the field; the spent
   *  quota + empty field then clear it through the normal path). */
  forceClear(): void {
    if (this.state !== 'live') return;
    this.quotaRemaining = 0;
    for (const a of this.asteroids) {
      if (a.isActive && !a.isPopping) a.consume();
    }
  }

  /** Split a rocket-killed tough rock (B30): scatter up to SPLIT.count small
   *  1-hit fragments from the origin's pop site. No-op for 1-hit rocks
   *  (origin._spec.hits is untouched by takeHit, so it still reads the original
   *  toughness). Graceful when the fragment pool is exhausted — never throws.
   *  Read the origin position synchronously (the caller invokes this right at
   *  the kill; the pop tween only scales/fades the sprite, never moves it). */
  spawnFragments(origin: Asteroid): void {
    if (origin.spec.hits < SPLIT.minHitsToSplit) return; // 1-hit rocks never split
    const free = this.fragmentPool.filter((f) => !f.isActive);
    if (free.length === 0) return; // pool exhausted — degrade gracefully
    const n = Math.min(SPLIT.count, free.length);
    const { x, y } = origin.sprite;
    const half = Phaser.Math.DegToRad(SPLIT.scatterConeDeg) / 2;
    const center = Phaser.Math.DegToRad(SPLIT.scatterCenterDeg);
    for (let i = 0; i < n; i++) {
      // Spread n fragments evenly across the cone (single fragment → dead center).
      const t = n > 1 ? i / (n - 1) : 0.5;
      const angle = center - half + 2 * half * t;
      const vx = Math.cos(angle) * SPLIT.launchSpeed;
      const vy = Math.sin(angle) * SPLIT.launchSpeed;
      free[i].spawnFragment(x, y, vx, vy);
    }
    this.splitCount += 1;
  }

  /** An asteroid finished popping and wants back in — spend quota if any. */
  private grantRespawn(): boolean {
    if (this.state !== 'live' || this.quotaRemaining <= 0) return false;
    this.quotaRemaining -= 1;
    return true;
  }

  private startWave(index: number): void {
    this.waveIndex = index;
    const wave = WAVES[index];
    const specs = asteroidsFor(wave);
    this.quotaRemaining = wave.quota;
    this.station.setShieldRegenMs(wave.shieldRegenMs);
    for (const hud of this.huds) hud.setWave(this.waveNumber);
    this.asteroids.forEach((asteroid, i) => {
      const spec = specs[i];
      if (!spec) return; // lane not live this wave; stays parked
      asteroid.reconfigure(spec, DIFFICULTY_MODEL.spawnGapMax);
      if (this.quotaRemaining > 0) {
        this.quotaRemaining -= 1; // initial spawns count against the quota
        asteroid.spawn();
      }
    });
    this.state = 'live';
  }

  /** DEV/test hook: end the run now and hand off to the boss (used by
   *  __debug.startBoss). Pops any live asteroids; state 'done' stops respawns. */
  endRunNow(): void {
    this.quotaRemaining = 0;
    this.state = 'done';
    for (const a of this.asteroids) {
      if (a.isActive && !a.isPopping) a.consume();
    }
  }

  private onWaveCleared(): void {
    this.state = 'breather';
    this.station.restoreShield(); // celebration: rings regrow one-by-one
    this.celebrate(); // B7: star-shower across the field on every wave clear
    if (this.waveIndex + 1 >= WAVES.length) {
      // Short beat so the restore cue lands, then hand off to the final boss
      // (B5) — this replaced the placeholder victory card.
      this.scene.time.delayedCall(BREATHER.bannerMs / 2, () => {
        this.state = 'done';
        this.onRunCleared();
      });
      return;
    }
    const next = this.waveIndex + 1;
    this.banner.show(next + 1); // announce the coming wave's number
    this.scene.time.delayedCall(BREATHER.bannerMs, () => {
      this.banner.hide();
      this.startWave(next);
    });
  }
}
