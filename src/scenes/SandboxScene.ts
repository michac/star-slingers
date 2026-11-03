/**
 * SandboxScene — game orchestrator. Wires together stars, the station +
 * shield, two seats of TwoThumbControls (multitouch; seat options from
 * controlsVariant.ts: ?lefty mirrors a seat, ?players=1 builds only the bottom
 * seat, P2), the rocket pool, the WaveDirector
 * (which owns the asteroids and the 10-wave run), the command-ship boss
 * encounter, per-player HUDs, the wave banner, damaged enemies' health bars,
 * and the fail/victory overlays. It also owns the shot rules (#22): FIRE
 * rounds and SPECIAL missiles (fireShot, pickMissileTarget) and what each does
 * on a hit (handleHit, handleBossHit). Everything else lives in objects/.
 */
import Phaser from 'phaser';
import { COLORS, CSS } from '../tokens';
import { CONTROLS_V2, GAME_HEIGHT, GAME_WIDTH, MISSILE, P1_ANCHOR, P2_ANCHOR, SLING, STARS, STATION } from '../layout';
import { controlsVariant, isLefty, playerCount } from '../controlsVariant';
import { generateTextures, TEX } from '../objects/textures';
import { TwoThumbControl, type ShotKind } from '../objects/TwoThumbControl';
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
import { HealthBars } from '../objects/HealthBars';
import type { HomingTarget } from '../objects/HomingTarget';
import type { SpecialKind } from '../objects/specials';
import { actStartWave, COMMAND_SHIP_WAVE, DAMAGE, startWaveFromQuery } from '../waves';
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

/** The missile's targeting cone (#22), as tan(half-angle) for the perpendicular test. */
const MISSILE_CONE_TAN = Math.tan(Phaser.Math.DegToRad(MISSILE.coneHalfAngleDeg));

export class SandboxScene extends Phaser.Scene {
  /** The live seats' controls (both seats, or just P2 in solo). */
  private controls: TwoThumbControl[] = [];
  /** HUDs, index-aligned with `controls` (each seat's two ammo pools live here). */
  private huds: PlayerHud[] = [];
  private asteroids: Asteroid[] = [];
  private rockets!: RocketPool;
  private explosions!: Explosions;
  private station!: Station;
  private scoreKeeper!: ScoreKeeper;
  private waveDirector!: WaveDirector;
  private bossEncounter!: BossEncounter;
  private healthBars!: HealthBars;
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
    // Each HUD sits in the centre column under its launcher, between SPECIAL and
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
      hud: new PlayerHud(this, { ...hudAt(d.player), colorCss: d.colorCss, color: d.color }),
    }));
    const huds = seats.map((seat) => seat.hud);
    this.huds = huds;
    this.scoreKeeper = new ScoreKeeper(this, huds); // shared score (B6)
    // Solo draws no banner/end-card copy toward the empty top seat either.
    const banner = new WaveBanner(this, players);
    // Shortcut: ?wave=N (or ?boss, the command ship) boots at that wave, and
    // Try again retries it, so a tester can re-run one wave. Survives the
    // restart (the query string sticks). Harmless in normal play — nobody
    // types it by accident. Without a shortcut this is 1.
    const queryWave = startWaveFromQuery(window.location.search);
    // Try again restarts at the lost act's first wave (AC5), but never before
    // a shortcut's wave, so a shortcut's wave retries itself until the players
    // pass it.
    this.failOverlay = new Overlay(this, FAIL_CONFIG, players, () => ({
      startWave: Math.max(queryWave, actStartWave(this.waveDirector.waveNumber)),
    }));
    // A win's tap starts a fresh run. It passes an explicit empty object:
    // restart(undefined) would keep the previous restart's data (Phaser's
    // Systems.start only replaces settings.data when given some), so a win after
    // a Try again would restart at the retry wave.
    this.victoryOverlay = new Overlay(this, VICTORY_CONFIG, players, () => ({}));

    // The command-ship boss (B5) creates its boss + escort sprites up front
    // (parked); the run hands it the field for wave 6.
    this.bossEncounter = new BossEncounter(
      this,
      this.station,
      this.failOverlay,
      () => this.waveDirector.onEncounterDefeated(),
      players
    );

    // The director creates the asteroid wrappers and starts the first wave live.
    this.waveDirector = new WaveDirector(
      this,
      this.station,
      huds,
      banner,
      {
        startWave: data.startWave ?? queryWave,
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

    // Health bars (#23) redraw after Arcade's postUpdate has synced each sprite
    // to its body (registered on scene START, so it runs before this listener),
    // so a bar sits on its rock's current-frame position.
    this.healthBars = new HealthBars(this);
    const drawHealthBars = () => this.healthBars.draw(this.asteroids);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, drawHealthBars);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.POST_UPDATE, drawHealthBars));

    this.controls = seats.map(
      ({ player, anchor, color, edge, tex, hud }) =>
        new TwoThumbControl(this, {
          anchor,
          color,
          edge,
          lefty: isLefty(variant.lefty, player),
          rocketTexture: tex,
          canFire: (button) => hud.canFire(button),
          onFire: (x, y, dirx, diry, kind) => {
            hud.spend(kind.button);
            this.fireShot(tex, player, x, y, dirx, diry, kind);
          },
          specialTargetAt: (ox, oy, dx, dy) => this.missileMarker(ox, oy, dx, dy),
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
      const hud = (player: number) => this.huds[seatIndex(player)];
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
        healthBars: () => this.healthBars.lastDrawn,
        lefty: () => variant.lefty,
        players: () => variant.players,
        seats: () => seats.map((seat) => seat.player),
        // Seat aim (seat-frame degrees) + world-space control layout.
        aimDeg: (player: number) => this.controls[seatIndex(player)]?.aimDegrees,
        // Ammo pools (#22): FIRE's and SPECIAL's counts, the seat's current
        // special (control + HUD), and the per-seat unlimited switch (#20).
        ammo: (player: number) => hud(player)?.ammoCount,
        specialAmmo: (player: number) => hud(player)?.specialCount,
        special: (player: number) => {
          const i = seatIndex(player);
          return i < 0 ? undefined : { control: this.controls[i].special, hud: this.huds[i].special };
        },
        setSpecial: (player: number, kind: SpecialKind) => this.setSpecial(seatIndex(player), kind),
        setUnlimitedAmmo: (player: number, on: boolean) => hud(player)?.setUnlimitedAmmo(on),
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
    // Steer in-flight missiles (#22; they re-acquire through the same picker),
    // then advance + redraw every shot's exhaust trail.
    this.rockets.steer(delta, this.pickMissileTarget);
    this.rockets.update(delta);
    this.station.update(delta); // shield regen clock
    this.waveDirector.update(delta); // wave-clear check
    this.bossEncounter.update(delta); // boss fight (no-op outside wave 6)
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

  /** Fire one seat's shot along the unit direction (dirx, diry). FIRE sends a
   *  round at SLING.maxSpeed, charged if FIRE was held to a full charge (the
   *  bright trail tier; its hit rule is in handleHit). SPECIAL sends the seat's
   *  current special (the homing missile) at MISSILE.speed, taking the enemy
   *  pickMissileTarget finds along the aim; with none it flies straight and
   *  keeps looking (Rocket.steer). Only FIRE charges, so a shot is never both. */
  private fireShot(tex: string, player: PlayerId, x: number, y: number, dirx: number, diry: number, kind: ShotKind): void {
    const charged = kind.charged;
    const special = kind.button === 'special';
    const speed = special ? MISSILE.speed : SLING.maxSpeed;
    const opts = special ? { missile: true, target: this.pickMissileTarget(x, y, dirx, diry) } : { charged };
    // Every seat's shot lands here, so this one buzz (#3) covers them all.
    if (this.rockets.fire(tex, x, y, dirx * speed, diry * speed, player, opts)) shotBuzz({ charged, special });
  }

  /** Change a seat's current special (#26 upgrades): the SPECIAL button and
   *  the HUD's special row change together. `seat` indexes controls/huds. */
  private setSpecial(seat: number, kind: SpecialKind): void {
    this.controls[seat]?.setSpecial(kind);
    this.huds[seat]?.setSpecial(kind);
  }

  /** The missile's target (#22): the live enemy nearest the line from
   *  (ox, oy) along (dirx, diry), inside MISSILE's wide forward cone and range.
   *  Used at launch, for the aim preview while SPECIAL is held (missileMarker),
   *  and by an in-flight missile re-acquiring along its heading. Null when
   *  nothing qualifies. An arrow property so Rocket.steer can call it unbound. */
  private readonly pickMissileTarget = (ox: number, oy: number, dirx: number, diry: number): HomingTarget | null => {
    const len = Math.hypot(dirx, diry);
    if (len === 0) return null;
    const ux = dirx / len;
    const uy = diry / len;
    let best: HomingTarget | null = null;
    let bestPerp = Infinity;
    // Asteroids during the field waves, plus the escorts during the boss.
    // Two plain loops — this runs every frame while a seat holds SPECIAL and
    // for every target-less missile, so no merged array.
    const consider = (cand: HomingTarget) => {
      if (!cand.isActive || cand.isPopping) return;
      const s = cand.sprite;
      // A lane rock is fielded (active) just off the right edge before it
      // drifts in: never take one the players can't see yet.
      if (s.x - cand.radius >= GAME_WIDTH) return;
      const dx = s.x - ox;
      const dy = s.y - oy;
      const proj = dx * ux + dy * uy; // distance along the line (forward only)
      if (proj <= 0 || proj > MISSILE.maxRange) return;
      const perp = Math.abs(dx * uy - dy * ux); // perpendicular distance to the line
      if (perp > proj * MISSILE_CONE_TAN) return; // inside the cone
      if (perp < bestPerp) {
        bestPerp = perp;
        best = cand;
      }
    };
    for (const cand of this.asteroids) consider(cand);
    for (const cand of this.bossEncounter.missileTargets()) consider(cand);
    return best;
  };

  /** Aim-preview ring for the enemy a missile would take (position + ring radius), or null. */
  private missileMarker(ox: number, oy: number, dirx: number, diry: number): { x: number; y: number; r: number } | null {
    const target = this.pickMissileTarget(ox, oy, dirx, diry);
    if (!target) return null;
    return { x: target.sprite.x, y: target.sprite.y, r: target.radius + MISSILE.ringPad };
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

    // Shot rules (#22): a plain FIRE round or a missile deals its damage; a
    // charged round deals double. Read the shot type BEFORE spendShot (recycle
    // clears the rocket's flags).
    const charged = rocket.getData('charged') === true;
    const damage = charged ? DAMAGE.charged : rocket.getData('missile') ? DAMAGE.missile : DAMAGE.fire;
    const pts = asteroid.takeHit(damage);
    this.spendShot(rocket, charged, pts > 0);
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
   *  means: escorts take the firing seat's identity from any shot (B33); the
   *  boss takes 1 HP from a charged round that got through a web gap (B34) and
   *  nothing from a plain round or a missile (#22). A charged round that downs
   *  an escort (its second lock) carries on along its line, so it can go on
   *  through the gap it just opened into the boss; every other hit spends it. */
  private readonly handleBossHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    const ref = pair?.other.getData('ref') as Boss | Escort | undefined;
    if (!pair || !ref) return;
    const { rocket } = pair;
    const charged = rocket.getData('charged') === true;
    const player = rocket.getData('player') as PlayerId;
    if (ref instanceof Boss) {
      this.rockets.recycle(rocket);
      ref.takeHit(charged);
      return;
    }
    this.spendShot(rocket, charged, ref.takeHit(player));
  };

  /** The charged round's pass-through rule (#22), for rocks and escorts alike:
   *  it carries on along its line only past a target this hit killed; every
   *  other hit spends the shot. A killed target turns its body off in the same
   *  call, so the round carrying on can't overlap it again. */
  private spendShot(rocket: Phaser.Physics.Arcade.Sprite, charged: boolean, killed: boolean): void {
    if (!(charged && killed)) this.rockets.recycle(rocket);
  }

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
