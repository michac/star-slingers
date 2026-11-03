/**
 * SandboxScene — game orchestrator. Wires together stars, the station +
 * shield, two seats of TwoThumbControls (multitouch; seat options from
 * controlsVariant.ts: ?lefty mirrors a seat, ?players=1 builds only the bottom
 * seat, P2), the rocket pool, the WaveDirector
 * (which owns the asteroids and the 10-wave run), the command-ship boss
 * encounter, per-player HUDs, the wave banner, and the fail/victory overlays.
 * All logic lives in objects/.
 */
import Phaser from 'phaser';
import { COLORS, CSS } from '../tokens';
import { CONTROLS_V2, GAME_HEIGHT, GAME_WIDTH, HOMING, P1_ANCHOR, P2_ANCHOR, STARS, STATION } from '../layout';
import { controlsVariant, isLefty, playerCount } from '../controlsVariant';
import { generateTextures, TEX } from '../objects/textures';
import { TwoThumbControl } from '../objects/TwoThumbControl';
import { RocketPool, type PlayerId } from '../objects/Rocket';
import { Explosions } from '../objects/Explosions';
import { Asteroid } from '../objects/Asteroid';
import { PlayerHud } from '../objects/PlayerHud';
import { ScoreKeeper } from '../objects/Score';
import { Station } from '../objects/Station';
import { FAIL_CONFIG, Overlay, VICTORY_CONFIG } from '../objects/Overlay';
import { WaveBanner } from '../objects/WaveBanner';
import { NO_INTERLUDES, WaveDirector } from '../objects/WaveDirector';
import { BossEncounter } from '../objects/BossEncounter';
import { Boss } from '../objects/Boss';
import { Escort } from '../objects/Escort';
import type { HomingTarget } from '../objects/HomingTarget';
import { COMMAND_SHIP_WAVE, DAMAGE, startWaveFromQuery } from '../waves';
import { shotBuzz } from '../haptics';

/** Sort an overlap pair into rocket + other: Phaser does NOT guarantee arg
 *  order for group-vs-array overlaps, so go by the rocket flag. */
function splitPair(a: unknown, b: unknown): { rocket: Phaser.Physics.Arcade.Sprite; other: Phaser.Physics.Arcade.Sprite } | null {
  const first = a as Phaser.Physics.Arcade.Sprite;
  const second = b as Phaser.Physics.Arcade.Sprite;
  if (first.getData('isRocket')) return { rocket: first, other: second };
  if (second.getData('isRocket')) return { rocket: second, other: first };
  return null;
}

/** One seat's fixed wiring (P1 top edge, P2 bottom). */
interface SeatDef {
  player: PlayerId;
  anchor: { x: number; y: number };
  color: number;
  colorCss: string;
  edge: 'top' | 'bottom';
  tex: string;
}

/** A seat in play: its fixed wiring plus the HUD built for it. */
interface Seat extends SeatDef {
  hud: PlayerHud;
}

const SEAT_DEFS: readonly SeatDef[] = [
  { player: 'p1', anchor: P1_ANCHOR, color: COLORS.p1, colorCss: CSS.p1, edge: 'top', tex: TEX.rocketP1 },
  { player: 'p2', anchor: P2_ANCHOR, color: COLORS.p2, colorCss: CSS.p2, edge: 'bottom', tex: TEX.rocketP2 },
];

/** DEV seat lookups take the player number: 1 = P1 (top), 2 = P2 (bottom);
 *  any other number is no seat. */
const seatId = (player: number): PlayerId | undefined => (player === 1 ? 'p1' : player === 2 ? 'p2' : undefined);

/** Homing lock cone (B14), as tan(half-angle) for the perpendicular test. */
const HOMING_MAX_TAN = Math.tan(Phaser.Math.DegToRad(HOMING.coneHalfAngleDeg));

export class SandboxScene extends Phaser.Scene {
  /** The live seats' controls (both seats, or just P2 in solo). */
  private controls: TwoThumbControl[] = [];
  private asteroids: Asteroid[] = [];
  private rockets!: RocketPool;
  private explosions!: Explosions;
  private station!: Station;
  private scoreKeeper!: ScoreKeeper;
  private waveDirector!: WaveDirector;
  private bossEncounter!: BossEncounter;
  private failOverlay!: Overlay;
  private victoryOverlay!: Overlay;
  /** Cumulative rocket→asteroid hits — a deterministic signal for the e2e suite. */
  private hitCount = 0;

  constructor() {
    super('Sandbox');
  }

  /** `data.startWave`: a Try again retry's wave (the fail card passes it);
   *  absent on a fresh load or a win's restart, which start from the query. */
  create(data: { startWave?: number } = {}): void {
    generateTextures(this);
    this.drawStars();
    this.station = new Station(this); // under the asteroids/rockets

    this.rockets = new RocketPool(this);
    this.explosions = new Explosions(this); // one shared burst system (B29)
    const variant = controlsVariant();
    const players = playerCount(variant);
    // Each HUD sits in the centre column under its launcher, between HOME and
    // the aim pad (P1's rotated 180° about the field centre).
    const hudAt = (player: 'p1' | 'p2') => {
      const at = isLefty(variant.lefty, player) ? CONTROLS_V2.hudLefty : CONTROLS_V2.hud;
      return player === 'p2'
        ? { x: at.x, y: at.y, angle: 0 }
        : { x: GAME_WIDTH - at.x, y: GAME_HEIGHT - at.y, angle: 180 };
    };
    // Per-seat wiring: P1 sits at the top edge, P2 at the bottom. Solo
    // (?players=1) builds only P2 (its HUD here, its control below), so nothing
    // claims touches in P1's old regions.
    const seats: readonly Seat[] = SEAT_DEFS.filter((d) => players === 2 || d.player === 'p2').map((d) => ({
      ...d,
      hud: new PlayerHud(this, { ...hudAt(d.player), colorCss: d.colorCss }),
    }));
    const huds = seats.map((seat) => seat.hud);
    this.scoreKeeper = new ScoreKeeper(this, huds); // shared score (B6)
    // Solo draws no banner/end-card copy toward the empty top seat either.
    const banner = new WaveBanner(this, players);
    // Try again restarts at the director's retry wave (AC5: the lost act's
    // first wave, or a shortcut's wave); a win's tap starts a fresh run.
    this.failOverlay = new Overlay(this, FAIL_CONFIG, players, () => ({
      startWave: this.waveDirector.retryWave,
    }));
    this.victoryOverlay = new Overlay(this, VICTORY_CONFIG, players);

    // The command-ship boss (B5) creates its boss + escort sprites up front
    // (parked); the run hands it the field for wave 6.
    this.bossEncounter = new BossEncounter(
      this,
      this.station,
      this.failOverlay,
      () => this.waveDirector.onEncounterDefeated(),
      players
    );

    // Shortcut: ?wave=N (or ?boss, the command ship) boots at that wave, and
    // Try again retries it, so a tester can re-run one wave. Survives the
    // restart (the query string sticks). Harmless in normal play — nobody
    // types it by accident.
    const queryWave = startWaveFromQuery(window.location.search);
    // The director creates the asteroid wrappers and starts the first wave live.
    this.waveDirector = new WaveDirector(
      this,
      this.station,
      huds,
      banner,
      {
        startWave: data.startWave ?? queryWave,
        retryWave: queryWave > 1 ? queryWave : undefined,
        hooks: NO_INTERLUDES, // #26 boss drops, #29 act transitions
        startEncounter: () => this.bossEncounter.start(),
        stopEncounter: () => this.bossEncounter.stop(),
        onRunWon: () => this.victoryOverlay.show(),
      },
      (x, y, r) => this.explosions.boom(x, y, r),
      () => this.explosions.starShower(), // B7: wave-clear celebration
      players
    );
    this.asteroids = this.waveDirector.asteroids;

    this.controls = seats.map(
      ({ player, anchor, color, edge, tex, hud }) =>
        new TwoThumbControl(this, {
          anchor,
          color,
          edge,
          lefty: isLefty(variant.lefty, player),
          rocketTexture: tex,
          canFire: () => hud.canFire(),
          onFire: (x, y, vx, vy, { charged, homing }) => {
            hud.spend();
            this.fireRocket(tex, player, x, y, vx, vy, homing, charged);
          },
          homingTargetAt: (ox, oy, dx, dy) => this.homingMarker(ox, oy, dx, dy),
        })
    );
    this.wireInput();

    // Built ONCE over the wrappers' sprites — the wrappers are mutated in
    // place between waves and never recreated, BECAUSE recreating them
    // would leave this collider pointing at dead sprites (hits would
    // silently stop registering). See Asteroid's header comment.
    this.physics.add.overlap(
      this.rockets.group,
      this.asteroids.map((a) => a.sprite),
      this.handleHit
    );

    // Second collider, also built ONCE over the boss + escort sprites (created
    // up front in BossEncounter, never recreated — same discipline).
    this.physics.add.overlap(
      this.rockets.group,
      this.bossEncounter.sprites,
      this.handleBossHit,
      this.processBossHit
    );

    // Deterministic handle for the headless e2e suite (e2e/).
    if (import.meta.env.DEV) {
      // Seat lookups take the player number (1 = top, 2 = bottom). controls is
      // index-aligned with seats; a seat absent in solo (or a number that names
      // no seat) is -1, which reads as undefined.
      const seatIndex = (player: number) => seats.findIndex((seat) => seat.player === seatId(player));
      (this as unknown as { __debug: object }).__debug = {
        clearWave: () => this.waveDirector.forceClear(),
        state: () => this.waveDirector.stateName,
        wave: () => this.waveDirector.waveNumber,
        act: () => this.waveDirector.wave.act,
        waveKind: () => this.waveDirector.wave.boss ?? this.waveDirector.wave.kind,
        jumpToWave: (n: number) => this.waveDirector.jumpTo(n),
        interludes: () => [...this.waveDirector.interludes],
        defeatBoss: () => this.bossEncounter.debugDefeat(),
        hits: () => this.hitCount,
        score: () => this.scoreKeeper.value,
        childrenAlive: () => this.asteroids.filter((a) => a.isChild && a.isActive).length,
        splitCount: () => this.waveDirector.splitCount,
        asteroidHp: (slot: number) => this.asteroids[slot]?.hp,
        lefty: () => variant.lefty,
        players: () => variant.players,
        seats: () => seats.map((seat) => seat.player),
        // Seat aim (seat-frame degrees) + world-space control layout.
        aimDeg: (player: number) => this.controls[seatIndex(player)]?.aimDegrees,
        v2Layout: (player: number) => this.controls[seatIndex(player)]?.worldLayout() ?? null,
        startBoss: () => this.waveDirector.jumpTo(COMMAND_SHIP_WAVE),
        bossPhase: () => this.bossEncounter.phase,
        snapBossIn: () => this.bossEncounter.snapBossIn(),
        killEscort: (i: number) => this.bossEncounter.killEscort(i),
        hitEscort: (i: number, player: PlayerId) => this.bossEncounter.hitEscort(i, player),
        escortLocks: () => this.bossEncounter.escortLocks,
        bossHp: () => this.bossEncounter.bossHp,
        escortsAlive: () => this.bossEncounter.aliveEscorts,
        shieldLinks: () => this.bossEncounter.shieldLinkCount,
        bossCharge: () => this.bossEncounter.chargeFraction,
        webBlocks: (ax: number, ay: number, bx: number, by: number) => this.bossEncounter.debugWebBlocks(ax, ay, bx, by),
        webLinks: () => this.bossEncounter.debugWebLinks(),
        stationShield: () => this.station.shieldHitsLeft,
      };
    }
  }

  update(_time: number, delta: number): void {
    // Freeze game logic behind either end-card; tweens still finish.
    if (this.failOverlay.visible || this.victoryOverlay.visible) return;
    for (const control of this.controls) control.update(delta);
    for (const asteroid of this.asteroids) asteroid.update(delta);
    // Steer in-flight homing shots toward their locked targets (B14), then
    // advance + redraw their exhaust trails (the shot-trail polish item).
    this.rockets.steer(delta);
    this.rockets.update(delta);
    this.station.update(delta); // shield regen clock
    this.waveDirector.update(delta); // wave-clear check
    this.bossEncounter.update(delta); // boss fight (no-op until the run clears)
    // Global web line collision (B34): a shot crossing a live link is spent.
    this.rockets.recycleWhere((rocket) => this.bossEncounter.blocksRocket(rocket));
    this.checkStationContacts();
  }

  /** Anything that gets within the shield's reach is consumed and costs a
   *  ring; once the shield is gone, reaching the hull ends the round. */
  private checkStationContacts(): void {
    for (const asteroid of this.asteroids) {
      if (!asteroid.isActive || asteroid.isPopping) continue;
      const s = asteroid.sprite;
      const reach = this.station.contactRadius + asteroid.spec.radius; // edge touch
      if (Phaser.Math.Distance.Between(s.x, s.y, STATION.cx, STATION.cy) > reach) continue;
      const result = this.station.onEnemyReached();
      asteroid.consume();
      if (result === 'destroyed') {
        this.physics.pause(); // freeze the field behind the overlay
        this.failOverlay.show();
        return;
      }
    }
  }

  /** Fire a rocket. It homes ONLY if it was fired from HOME AND it locks a
   *  target at fire (the highlighted rock); otherwise it's an ordinary straight
   *  shot. A locked shot is meant to connect (see HOMING.turnRateDeg). */
  private fireRocket(
    tex: string,
    player: PlayerId,
    x: number,
    y: number,
    vx: number,
    vy: number,
    homing: boolean,
    charged: boolean
  ): void {
    // A charged shot is a railgun (B13): it pierces asteroids (see handleHit)
    // and wears the bright trail tier. Only FIRE charges and HOME never does,
    // so a shot is never both. No lock → a straight shot.
    const target = homing ? this.pickHomingTarget(x, y, vx, vy) : null;
    // Every seat's shot lands here, so this one buzz (#3) covers them all.
    if (this.rockets.fire(tex, x, y, vx, vy, player, { charged, target })) shotBuzz({ charged, homing });
  }

  /** The asteroid closest to the launch ray (origin + direction), within a
   *  forward cone and range — the homing lock (B14). Used at fire and, via
   *  homingMarker, for the aim preview. Returns null when nothing qualifies. */
  private pickHomingTarget(ox: number, oy: number, dirx: number, diry: number): HomingTarget | null {
    const len = Math.hypot(dirx, diry);
    if (len === 0) return null;
    const ux = dirx / len;
    const uy = diry / len;
    let best: HomingTarget | null = null;
    let bestPerp = Infinity;
    // Asteroids during the waves, plus the escorts during the finale, so
    // homing keeps working all the way through (B14 × B5). Two plain loops —
    // this runs every frame while a seat holds HOME, so no merged array.
    const consider = (cand: HomingTarget) => {
      if (!cand.isActive || cand.isPopping) return;
      const s = cand.sprite;
      const dx = s.x - ox;
      const dy = s.y - oy;
      const proj = dx * ux + dy * uy; // distance along the ray (forward only)
      if (proj <= 0 || proj > HOMING.maxRange) return;
      const perp = Math.abs(dx * uy - dy * ux); // perpendicular distance to the ray
      if (perp > HOMING.maxPerp) return; // must pass close to the target's center
      if (perp > proj * HOMING_MAX_TAN) return; // and within the cone
      if (perp < bestPerp) {
        bestPerp = perp;
        best = cand;
      }
    };
    for (const cand of this.asteroids) consider(cand);
    for (const cand of this.bossEncounter.homingTargets()) consider(cand);
    return best;
  }

  /** Aim-preview marker for the locked target (position + ring radius), or null. */
  private homingMarker(ox: number, oy: number, dirx: number, diry: number): { x: number; y: number; r: number } | null {
    const target = this.pickHomingTarget(ox, oy, dirx, diry);
    if (!target) return null;
    return { x: target.sprite.x, y: target.sprite.y, r: target.radius + HOMING.ringPad };
  }

  /** Scene-level pointer events fanned out to every live seat's controls; each
   *  claims its own pointers by id, so several fingers work at once. */
  private wireInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      for (const c of this.controls) c.handleDown(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      for (const c of this.controls) c.handleMove(p);
    });
    const release = (p: Phaser.Input.Pointer) => {
      for (const c of this.controls) c.handleUp(p);
    };
    this.input.on('pointerup', release);
    // Fingers lifted over the FIT letterbox fire this instead of pointerup;
    // without it a button sticks held.
    this.input.on('pointerupoutside', release);
  }

  private readonly handleHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    const asteroid = pair?.other.getData('ref') as Asteroid | undefined;
    if (!pair || !asteroid) return;
    const { rocket } = pair;

    // Charged = railgun (B13): pierce every asteroid in the path, hitting each
    // ONCE and railing on instead of recycling. The per-rocket hitSet guards
    // the multi-frame overlap window so one pass never hits the same rock
    // twice; a popped rock disables its body and stops overlapping. The
    // rocket recycles normally on world-bounds.
    const charged = rocket.getData('charged') === true;
    // Read the shot type BEFORE recycling (recycle clears the rocket's flags).
    const damage = charged ? DAMAGE.railgun : rocket.getData('homing') ? DAMAGE.homing : DAMAGE.normal;
    if (charged) {
      const hitSet = rocket.getData('hitSet') as Set<Asteroid>;
      if (hitSet.has(asteroid)) return; // already hit this rock on this pass
      hitSet.add(asteroid);
    } else {
      this.rockets.recycle(rocket);
    }

    const pts = asteroid.takeHit(damage);
    if (pts > 0) {
      this.scoreKeeper.add(pts, asteroid.sprite.x, asteroid.sprite.y);
      // pts > 0 means a rocket-KILL (B30 splits only on a rocket-kill; a
      // station consume() never scores, so it never splits). Read position
      // now — the pop tween only scales/fades the sprite, never moves it.
      this.waveDirector.spawnChildren(asteroid);
    }
    this.hitCount += 1;
  };

  /** Rocket vs boss/escort (B5). The wrapper's takeHit() decides what a hit
   *  means: escorts take the firing seat's identity (B33); the boss takes only
   *  a fully charged railgun that got through a web gap (B34). */
  private readonly handleBossHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    const ref = pair?.other.getData('ref') as Boss | Escort | undefined;
    if (!pair || !ref) return;
    const { rocket } = pair;
    const charged = rocket.getData('charged') === true;
    const player = rocket.getData('player') as PlayerId;
    this.rockets.recycle(rocket);
    if (ref instanceof Boss) ref.takeHit(charged);
    else ref.takeHit(player);
  };

  /** The web is checked before the boss/escort overlap callback, so its line
   * collision consumes a rocket rather than letting Arcade's sprite overlap
   * leak damage through a visible blocker. */
  private readonly processBossHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    if (!pair) return false;
    if (!this.bossEncounter.blocksRocket(pair.rocket)) return true;
    this.rockets.recycle(pair.rocket);
    return false;
  };

  private drawStars(): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.star, 1);
    for (const star of STARS) {
      g.fillCircle(star.x, star.y, star.r);
    }
  }
}
