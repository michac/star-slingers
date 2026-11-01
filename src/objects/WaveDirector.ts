/**
 * WaveDirector — owns the run: which wave is live, its finite asteroid
 * quota, the wave-clear check, the breather (shield restore + banner), and
 * the hand-off to the final boss after the last wave. State machine:
 *
 *   live → breather → (next wave) live … → done (boss takes over)
 *
 * Wave 1 starts directly in `live` with no banner — a banner before the
 * very first wave adds nothing, and play should start within seconds of boot.
 * A run lost mid-wave restarts via scene.restart() (the fail overlay), which
 * rebuilds this object from constants — so no reset logic lives here.
 */
import Phaser from 'phaser';
import { SPLITTER_CHILDREN } from '../layout';
import {
  asteroidsFor,
  BREATHER,
  DIFFICULTY_MODEL,
  LANE_SLOTS,
  ASTEROID_KIND,
  WAVES,
} from '../waves';
import { Asteroid } from './Asteroid';
import { Station } from './Station';
import { PlayerHud } from './PlayerHud';
import { WaveBanner } from './WaveBanner';

type WaveState = 'live' | 'breather' | 'done';

export class WaveDirector {
  /** One wrapper per lane slot PLUS the splitter-child pool, all alive for the
   *  whole run (see Asteroid's header: the overlap collider depends on these
   *  never being recreated). The child wrappers are the tail of this array. */
  readonly asteroids: Asteroid[];

  /** The splitter-child pool — the tail of `asteroids` (indices ≥ lane count). */
  private readonly childPool: Asteroid[];

  private waveIndex = 0;
  private quotaRemaining = 0;
  private state: WaveState = 'live';
  /** Cumulative split events (B30) — a deterministic signal for the e2e suite. */
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
            kind: 'standard',
            radius: ASTEROID_KIND.standard.radius,
            y: slot.y,
            speed: slot.baseSpeed * DIFFICULTY_MODEL.minSpeedScale,
          },
          DIFFICULTY_MODEL.spawnGapMax,
          () => this.grantRespawn(),
          this.boom
        )
    );
    // Append dedicated child wrappers to the SAME array, parked. They
    // join here (before SandboxScene builds the rocket→asteroid collider once
    // over this.asteroids), so they get the collider + update loop + station
    // contact + homing + field-empty checks for free. They differ from lane
    // rocks in exactly two ways: onWantRespawn returns false (one-shot — they
    // park rather than respawn off the right edge), and they're fielded via
    // spawnChild() at a scatter position. Their indices are ≥ lane count, so
    // startWave's specs[i] is undefined for them and waves never field them.
    this.childPool = Array.from(
      { length: SPLITTER_CHILDREN.poolSize },
      () =>
        new Asteroid(
          this.scene,
          { kind: 'standard', radius: ASTEROID_KIND.standard.radius, y: 0, speed: SPLITTER_CHILDREN.childSpeed },
          DIFFICULTY_MODEL.spawnGapMax,
          () => false, // one-shot: never respawns off the right edge
          this.boom
        )
    );
    this.asteroids.push(...this.childPool);
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
    this.popField();
  }

  /** Split a rocket-killed splitter into standard children. Standards never
   *  split; the child-pool exhaustion path degrades gracefully.
   *  Read the origin position synchronously (the caller invokes this right at
   *  the kill; the pop tween only scales/fades the sprite, never moves it). */
  spawnChildren(origin: Asteroid): void {
    if (origin.spec.kind !== 'splitter') return;
    const free = this.childPool.filter((child) => !child.isActive);
    if (free.length === 0) return; // pool exhausted — degrade gracefully
    const n = Math.min(SPLITTER_CHILDREN.count, free.length);
    const { x, y } = origin.sprite;
    const half = Phaser.Math.DegToRad(SPLITTER_CHILDREN.scatterConeDeg) / 2;
    const center = Phaser.Math.DegToRad(SPLITTER_CHILDREN.scatterCenterDeg);
    for (let i = 0; i < n; i++) {
      // Spread n children evenly across the cone (single child → dead center).
      const t = n > 1 ? i / (n - 1) : 0.5;
      const angle = center - half + 2 * half * t;
      const vx = Math.cos(angle) * SPLITTER_CHILDREN.launchSpeed;
      const vy = Math.sin(angle) * SPLITTER_CHILDREN.launchSpeed;
      free[i].spawnChild(x, y, vx, vy);
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
    this.popField();
  }

  /** Pop every live asteroid (DEV/test shortcuts; never scores or splits). */
  private popField(): void {
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
