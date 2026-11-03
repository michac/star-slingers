/**
 * WaveDirector — owns the run: 10 waves in 4 acts, played in order from the
 * `RUN` table (src/waves.ts). It dispatches each wave by how it plays: a wave
 * with a `field` fields a finite asteroid quota (the solver's output) and
 * clears once the quota is spent and the field drains; the command ship hands
 * the field to the BossEncounter until it reports the boss down. State machine:
 *
 *   live | boss → between → (next wave) live | boss … → won
 *
 * Between waves (`between`): the shield restores, the star-shower plays, then
 * the interlude hooks run in order: `bossDrop` after a boss wave (#26), then
 * `actTransition` when the act changes (#29). Each calls `done()` when it's
 * finished. Then the banner announces the next wave. After wave 10 the run is
 * won. The starting wave (wave 1, a `?wave`/`?boss` shortcut, or a Try again
 * retry) starts directly with no banner, so play begins within seconds.
 *
 * A lost run restarts via scene.restart() (the fail overlay), which rebuilds
 * this object from constants, so no reset logic lives here; the scene picks
 * the wave that restart begins at.
 */
import Phaser from 'phaser';
import { SPLITTER_CHILDREN } from '../layout';
import {
  asteroidsFor,
  BREATHER,
  DIFFICULTY_MODEL,
  isWaveNumber,
  LANE_SLOTS,
  ASTEROID_KIND,
  RUN,
  type Act,
  type RunWave,
} from '../waves';
import { Asteroid } from './Asteroid';
import { Station } from './Station';
import { PlayerHud } from './PlayerHud';
import { WaveBanner } from './WaveBanner';

type WaveState = 'live' | 'boss' | 'between' | 'won';

/** The between-wave seams later act issues fill in. Each must call `done()`
 *  exactly once when it has finished (straight away by default). */
export interface RunHooks {
  /** A boss wave just ended (#26: the boss's upgrade pods). */
  bossDrop(wave: RunWave, done: () => void): void;
  /** The last wave of act `from` just ended (#29: the colony-ship flyby). */
  actTransition(from: Act, to: Act, done: () => void): void;
}

export const NO_INTERLUDES: RunHooks = {
  bossDrop: (_wave, done) => done(),
  actTransition: (_from, _to, done) => done(),
};

export interface RunOptions {
  /** 1-based wave the run starts at (no banner). */
  startWave: number;
  hooks: RunHooks;
  /** Start the command-ship encounter; the scene reports back through
   *  onEncounterDefeated(). */
  startEncounter: () => void;
  /** Stop the encounter (a wave jump away from it). */
  stopEncounter: () => void;
  /** Wave 10 is cleared: the scene shows the victory card. */
  onRunWon: () => void;
}

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
  /** Bumped by every wave start, so a deferred callback from an earlier wave
   *  (a breather timer, a hook's done) can't start a second wave after a jump. */
  private runToken = 0;
  /** Cumulative split events (B30) — a deterministic signal for the e2e suite. */
  splitCount = 0;
  /** Interludes that ran, in order ('drop:3', 'act:1-2') — the e2e suite's
   *  signal that the hooks fire at the right seams. */
  readonly interludes: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly station: Station,
    private readonly huds: PlayerHud[],
    private readonly banner: WaveBanner,
    private readonly run: RunOptions,
    /** The shared asteroid burst (B29), forwarded into every Asteroid. */
    private readonly boom: (x: number, y: number, radius: number) => void,
    /** Wave-clear celebration (B7) — fires the star-shower on every clear. */
    private readonly celebrate: () => void,
    /** Live seats (the join screen's lineup): solo scales each wave's target (SOLO in waves.ts). */
    private readonly players: 1 | 2
  ) {
    // One wrapper per physical lane slot, alive for the whole run, built
    // parked with a weak default; each field wave reconfigures the lanes it
    // fields (startWave), and the rest stay parked.
    this.asteroids = LANE_SLOTS.map(
      (slot) =>
        new Asteroid(
          this.scene,
          {
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
    this.startWave(this.run.startWave - 1);
  }

  get stateName(): WaveState {
    return this.state;
  }

  /** 1-based, for HUDs/banner/tests. */
  get waveNumber(): number {
    return this.waveIndex + 1;
  }

  /** The live (or just-ended) wave's row in RUN. */
  get wave(): RunWave {
    return RUN[this.waveIndex];
  }

  /** Per-frame (scene update, frozen while overlays show): the wave clears
   *  when its quota is spent AND the field has drained empty. */
  update(_delta: number): void {
    if (this.state !== 'live') return;
    if (this.quotaRemaining > 0) return;
    if (this.asteroids.some((a) => a.isActive || a.isPopping)) return;
    this.onWaveCleared();
  }

  /** DEV/test hook: end the current field wave now (empties the field at
   *  once; the spent quota + empty field then clear it through the normal path
   *  on the next update). */
  forceClear(): void {
    if (this.state !== 'live') return;
    this.quotaRemaining = 0;
    this.vanishField();
  }

  /** DEV/test hook: jump to wave `n` (1-based) now: empty the field, stop any
   *  boss fight, drop any pending breather, start it with no banner. */
  jumpTo(n: number): void {
    if (!isWaveNumber(n)) return;
    this.vanishField();
    this.run.stopEncounter();
    this.banner.hide();
    this.startWave(n - 1);
  }

  /** The command ship is down: the boss wave ends like a cleared field. */
  onEncounterDefeated(): void {
    if (this.state === 'boss') this.onWaveCleared();
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
    this.runToken += 1;
    this.waveIndex = index;
    for (const hud of this.huds) hud.setWave(this.waveNumber);
    const { field } = this.wave;
    if (!field) {
      // The command ship: no asteroids; the encounter owns the field (and the
      // shield regen) until it reports the boss down.
      this.quotaRemaining = 0;
      this.state = 'boss';
      this.run.startEncounter();
      return;
    }
    const specs = asteroidsFor(field, this.players);
    this.quotaRemaining = field.quota;
    this.station.setShieldRegenMs(field.shieldRegenMs);
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

  /** Remove every rock at once (DEV/test shortcuts; never scores or splits). */
  private vanishField(): void {
    for (const a of this.asteroids) a.vanish();
  }

  /** Wrap a deferred step so it's dropped if another wave started meanwhile. */
  private guarded(step: () => void): () => void {
    const token = this.runToken;
    return () => {
      if (token === this.runToken) step();
    };
  }

  private onWaveCleared(): void {
    this.state = 'between';
    this.station.restoreShield(); // celebration: rings regrow one-by-one
    this.celebrate(); // B7: star-shower across the field on every wave clear
    const ended = this.wave;
    const next = this.waveIndex + 1;
    if (next >= RUN.length) {
      // Short beat so the restore cue lands, then the win.
      this.scene.time.delayedCall(
        BREATHER.bannerMs / 2,
        this.guarded(() => {
          this.state = 'won';
          this.run.onRunWon();
        })
      );
      return;
    }
    const announce = this.guarded(() => {
      this.banner.show(next + 1); // announce the coming wave's number
      this.scene.time.delayedCall(
        BREATHER.bannerMs,
        this.guarded(() => {
          this.banner.hide();
          this.startWave(next);
        })
      );
    });
    const transition = this.guarded(() => {
      const to = RUN[next].act;
      if (to === ended.act) return announce();
      this.interludes.push(`act:${ended.act}-${to}`);
      this.run.hooks.actTransition(ended.act, to, announce);
    });
    if (ended.kind !== 'boss') return transition();
    this.interludes.push(`drop:${this.waveNumber}`);
    this.run.hooks.bossDrop(ended, transition);
  }
}
