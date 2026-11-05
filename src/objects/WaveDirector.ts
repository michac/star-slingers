/**
 * WaveDirector — owns the run: 10 waves in 4 acts, played in order from the
 * `RUN` table (src/waves.ts). It dispatches each wave by how it plays: a wave
 * with a `field` fields a finite asteroid quota (the solver's output) and
 * clears once the quota is spent and the field drains; a boss wave hands the
 * field to its encounter (the scene's startEncounter, by BossId). The command
 * ship reports itself down (onEncounterDefeated); the giant asteroid bursts
 * into one-hit rocks (burstBoss), and its wave then clears like a drained
 * field. State machine:
 *
 *   live | boss → between → (next wave) live | boss … → won
 *   boss → live (the giant's burst: no field, quota 0, clears on field-empty)
 *
 * Between waves (`between`): the fleet is restored (lost ships rebuilt, every
 * shield back), the star-shower plays, then the interlude hooks run in order:
 * `bossDrop` after a boss wave (#26), then `actTransition` when the act
 * changes (#29: the fleet's flyby). Each calls `done()` when it's finished, so
 * the flyby starts only once the drop is over. Then the banner announces the
 * next wave. After wave 10 the run is won. The starting wave (wave 1, a
 * `?wave`/`?boss` shortcut, or a Try again retry) starts directly with no
 * banner, so play begins within seconds.
 *
 * Spawns: every (re)spawn draws its y from a shuffle bag over the 4 sublanes
 * (pickY), so each sublane gets an equal share of a wave's rocks whichever
 * stream fields them, and every ship is threatened. A lost ship's sublane
 * stays in the bag: its rocks fly past.
 *
 * A lost run restarts via scene.restart() (the fail overlay), which rebuilds
 * this object from constants, so no reset logic lives here; the scene picks
 * the wave that restart begins at.
 */
import Phaser from 'phaser';
import { GIANT_LAYOUT, LANE, SPLITTER_CHILDREN, SUBLANE_H, sublaneCenterY, type ChildMotion } from '../layout';
import {
  asteroidsFor,
  BREATHER,
  DIFFICULTY_MODEL,
  GIANT,
  isWaveNumber,
  paceFor,
  ROCK_STREAMS,
  ASTEROID_KIND,
  RUN,
  type Act,
  type BossId,
  type RunWave,
} from '../waves';
import { Asteroid } from './Asteroid';
import { Fleet } from './Fleet';
import { PlayerHud } from './PlayerHud';
import { WaveBanner } from './WaveBanner';

type WaveState = 'live' | 'boss' | 'between' | 'won';

/** The between-wave seams later act issues fill in. Each must call `done()`
 *  exactly once when it has finished. */
export interface RunHooks {
  /** A boss wave just ended (#26: the boss's upgrade pods). Call `done` only
   *  once every pod is collected or gone: the act transition runs after it. */
  bossDrop(wave: RunWave, done: () => void): void;
  /** The last wave of act `from` just ended (#29: the colony-ship flyby,
   *  ActTransition.ts). Never runs after the last act: the run is won instead. */
  actTransition(from: Act, to: Act, done: () => void): void;
}

export interface RunOptions {
  /** 1-based wave the run starts at (no banner). */
  startWave: number;
  hooks: RunHooks;
  /** Start a boss wave's encounter: the command ship reports back through
   *  onEncounterDefeated(), the giant asteroid through burstBoss(). */
  startEncounter: (boss: BossId) => void;
  /** Stop the encounter (a wave jump away from it). */
  stopEncounter: () => void;
  /** Stop the interludes' own work if one is still playing (a wave jump
   *  during it): the act transition's flyby and the boss drop's pods (#26).
   *  Its `done` is dropped by the run token anyway. */
  stopInterludes: () => void;
  /** Wave 10 is cleared: the scene shows the victory card. */
  onRunWon: () => void;
  /** A wave (1-based) just started, the starting wave included (#26: the
   *  scene snapshots each seat's specials at an act's start for Try again). */
  onWaveStart: (wave: number) => void;
}

export class WaveDirector {
  /** One wrapper per rock stream PLUS the splitter-child pool, all alive for the
   *  whole run (see Asteroid's header: the overlap collider depends on these
   *  never being recreated). The child wrappers are the tail of this array. */
  readonly asteroids: Asteroid[];

  /** The child pool — the tail of `asteroids` (indices ≥ stream count): a
   *  splitter's children and the giant asteroid's burst rocks. */
  private readonly childPool: Asteroid[];
  /** A splitter's children's motion at this seat count: solo cruises them at SOLO.pace. */
  private readonly splitterMotion: ChildMotion;

  private waveIndex = 0;
  private quotaRemaining = 0;
  private state: WaveState = 'live';
  /** Bumped by every wave start, so a deferred callback from an earlier wave
   *  (a breather timer, a hook's done) can't start a second wave after a jump. */
  private runToken = 0;
  /** Cumulative split events (B30) — a deterministic signal for the e2e suite. */
  splitCount = 0;
  /** Sublanes still to deal this round of the spawn bag (pickY). */
  private sublaneBag: number[] = [];
  /** Interludes that ran, in order ('drop:3', 'act:1-2') — the e2e suite's
   *  signal that the hooks fire at the right seams. */
  readonly interludes: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fleet: Fleet,
    private readonly huds: PlayerHud[],
    private readonly banner: WaveBanner,
    private readonly run: RunOptions,
    /** The shared asteroid burst (B29), forwarded into every Asteroid. */
    private readonly boom: (x: number, y: number, radius: number) => void,
    /** Wave-clear celebration (B7) — fires the star-shower on every clear. */
    private readonly celebrate: () => void,
    /** Live seats (the join screen's lineup): solo drifts each field and its
     *  splitters' children at SOLO.pace (asteroidsFor, splitterMotion). */
    private readonly players: 1 | 2
  ) {
    this.splitterMotion = { ...SPLITTER_CHILDREN, childSpeed: SPLITTER_CHILDREN.childSpeed * paceFor(players) };
    // One wrapper per rock stream, alive for the whole run, built parked with
    // a weak default; each field wave reconfigures the streams it fields
    // (startWave), and the rest stay parked.
    this.asteroids = ROCK_STREAMS.map(
      (stream) =>
        new Asteroid(
          this.scene,
          {
            kind: 'standard',
            radius: ASTEROID_KIND.standard.radius,
            speed: stream.baseSpeed * DIFFICULTY_MODEL.minSpeedScale,
          },
          DIFFICULTY_MODEL.spawnGapMax,
          () => this.grantRespawn(),
          this.pickY,
          this.boom
        )
    );
    // Append dedicated child wrappers to the SAME array, parked. They
    // join here (before SandboxScene builds the rocket→asteroid collider once
    // over this.asteroids), so they get the collider + update loop + fleet
    // contact + missile + field-empty checks for free. They differ from stream
    // rocks in exactly two ways: onWantRespawn returns false (one-shot — they
    // park rather than respawn off the right edge), and they're fielded via
    // spawnChild() at a scatter position. Their indices are ≥ stream count, so
    // startWave's specs[i] is undefined for them and waves never field them.
    this.childPool = Array.from(
      { length: Math.max(SPLITTER_CHILDREN.poolSize, GIANT.burstCount) },
      () =>
        new Asteroid(
          this.scene,
          { kind: 'standard', radius: ASTEROID_KIND.standard.radius, speed: SPLITTER_CHILDREN.childSpeed },
          DIFFICULTY_MODEL.spawnGapMax,
          () => false, // one-shot: never respawns off the right edge
          this.pickY, // unused: a child never respawns
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
    this.run.stopInterludes();
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
    const { x, y } = origin.sprite;
    const half = Phaser.Math.DegToRad(SPLITTER_CHILDREN.scatterConeDeg) / 2;
    const center = Phaser.Math.DegToRad(SPLITTER_CHILDREN.scatterCenterDeg);
    const fielded = this.fieldChildren(x, y, SPLITTER_CHILDREN.count, this.splitterMotion, (t) => {
      const angle = center - half + 2 * half * t; // evenly across the leftward cone
      return [Math.cos(angle) * SPLITTER_CHILDREN.launchSpeed, Math.sin(angle) * SPLITTER_CHILDREN.launchSpeed];
    });
    if (fielded > 0) {
      this.splitCount += 1;
    }
  }

  /** The giant asteroid popped at (x, y) (#25): it bursts into
   *  GIANT.burstCount one-hit rocks fanned evenly up and down the lane (on
   *  the burst's own motion, GIANT_LAYOUT.burst), and its wave
   *  turns into a drained field: it clears (then the boss drop runs) once
   *  they're gone. */
  burstBoss(x: number, y: number): void {
    if (this.state !== 'boss') return;
    const { burst } = GIANT_LAYOUT;
    const spreadSec = (burst.scatterMs - burst.spawnGraceMs) / 1000; // they're still during the grace
    this.fieldChildren(x, y, GIANT.burstCount, burst, (t) => [-burst.driftX / spreadSec, ((2 * t - 1) * burst.spreadY) / spreadSec]);
    this.quotaRemaining = 0;
    this.state = 'live';
  }

  /** Field up to n one-hit children at (x, y) on `motion`, each launched at
   *  `velocityAt(t)` for its place t in 0..1 across the spread (a single child
   *  is t = 0.5, dead centre). Returns how many went out: fewer if the pool
   *  runs short, which degrades gracefully. */
  private fieldChildren(x: number, y: number, n: number, motion: ChildMotion, velocityAt: (t: number) => [number, number]): number {
    const free = this.childPool.filter((child) => !child.isActive);
    const count = Math.min(n, free.length);
    for (let i = 0; i < count; i++) {
      const [vx, vy] = velocityAt(count > 1 ? i / (count - 1) : 0.5);
      free[i].spawnChild(x, y, vx, vy, motion);
    }
    return count;
  }

  /** A spawn's y: the next sublane from the shuffle bag (refilled + reshuffled
   *  when empty), at a uniform height inside it that keeps a rock of this
   *  radius within the sublane. An arrow property: every Asteroid calls it. */
  readonly pickY = (radius: number): number => {
    if (this.sublaneBag.length === 0) {
      this.sublaneBag = Phaser.Utils.Array.Shuffle(Array.from({ length: LANE.sublanes }, (_, i) => i));
    }
    const sublane = this.sublaneBag.pop()!;
    const spread = Math.max(0, SUBLANE_H / 2 - radius);
    return sublaneCenterY(sublane) + Phaser.Math.FloatBetween(-spread, spread);
  };

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
    this.run.onWaveStart(this.waveNumber);
    const { field } = this.wave;
    if (!field) {
      // A boss with its own encounter: no stream rocks; the encounter owns the
      // field (and the fleet's shield regen) until the boss is down.
      this.quotaRemaining = 0;
      this.state = 'boss';
      this.run.startEncounter(this.wave.boss ?? 'commandShip');
      return;
    }
    const specs = asteroidsFor(field, this.players);
    this.quotaRemaining = field.quota;
    this.fleet.setShieldRegenMs(field.shieldRegenMs);
    this.asteroids.forEach((asteroid, i) => {
      const spec = specs[i];
      if (!spec) return; // stream not live this wave; stays parked
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
    this.fleet.restoreAll(); // celebration: lost ships rebuilt, shields back, one by one
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
