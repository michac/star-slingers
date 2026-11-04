/**
 * SandboxScene — game orchestrator. Wires together the scrolling starfield,
 * the enemy lane, the colony fleet (#19), a TwoThumbControl per joined seat (multitouch; the seats and their
 * Easy/Normal come from the join screen via lineup.ts; each seat's lefty swap
 * mirrors it and is remembered in controlsVariant.ts), the rocket pool, the WaveDirector
 * (which owns the asteroids and the 10-wave run), the two boss encounters
 * (the giant asteroid, #25, and the command ship), the between-acts fleet flyby (#29), per-player HUDs, the wave
 * banner, damaged enemies' health bars, and the fail/victory overlays. It
 * also owns the shot rules (#22): FIRE rounds and SPECIAL missiles (fireShot,
 * pickMissileTarget) and what each does on a hit (handleHit, handleBossHit,
 * handleGiantHit), and what an enemy reaching the fleet does
 * (checkFleetContacts; the giant wipes the fleet itself). Everything
 * else lives in objects/.
 */
import Phaser from 'phaser';
import { CONTROLS_V2, GAME_WIDTH, MISSILE, seatPoint, SLING, sublaneOf, type SeatEdge } from '../layout';
import { isLefty, leftySetting, setSeatLefty } from '../controlsVariant';
import { liveSeats, SEAT_DEFS, type Lineup, type SeatDef } from '../lineup';
import { generateTextures } from '../objects/textures';
import { drawLane, rejectSpark } from '../objects/draw';
import { Starfield } from '../objects/Starfield';
import { TwoThumbControl, type ShotKind } from '../objects/TwoThumbControl';
import { RocketPool, type PlayerId } from '../objects/Rocket';
import { Explosions } from '../objects/Explosions';
import { Asteroid } from '../objects/Asteroid';
import { PlayerHud } from '../objects/PlayerHud';
import { ScoreKeeper } from '../objects/Score';
import { Fleet } from '../objects/Fleet';
import { FAIL_CONFIG, Overlay, VICTORY_CONFIG } from '../objects/Overlay';
import { WaveBanner } from '../objects/WaveBanner';
import { NO_INTERLUDES, WaveDirector } from '../objects/WaveDirector';
import { BossEncounter } from '../objects/BossEncounter';
import { GiantAsteroid } from '../objects/GiantAsteroid';
import { ActTransition } from '../objects/ActTransition';
import { Boss } from '../objects/Boss';
import { Escort } from '../objects/Escort';
import { HealthBars, type HealthBarTarget } from '../objects/HealthBars';
import type { HomingTarget } from '../objects/HomingTarget';
import type { SpecialKind } from '../objects/specials';
import { actStartWave, COMMAND_SHIP_WAVE, DAMAGE, GIANT, RUN, startWaveFromQuery } from '../waves';
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

/** A seat in play: its fixed wiring plus the HUD built for it. */
interface Seat extends SeatDef {
  hud: PlayerHud;
}

/** DEV seat lookups take the player number: 1 = P1 (top), 2 = P2 (bottom);
 *  any other number is no seat. */
const seatId = (player: number): PlayerId | undefined => (player === 1 ? 'p1' : player === 2 ? 'p2' : undefined);

/** The missile's targeting cone (#22), as tan(half-angle) for the perpendicular test. */
const MISSILE_CONE_TAN = Math.tan(Phaser.Math.DegToRad(MISSILE.coneHalfAngleDeg));

export class SandboxScene extends Phaser.Scene {
  /** The live seats' controls (both seats, or the one joined seat in solo). */
  private controls: TwoThumbControl[] = [];
  /** HUDs, index-aligned with `controls` (each seat's two ammo pools live here). */
  private huds: PlayerHud[] = [];
  private asteroids: Asteroid[] = [];
  private rockets!: RocketPool;
  private explosions!: Explosions;
  private starfield!: Starfield;
  private fleet!: Fleet;
  private scoreKeeper!: ScoreKeeper;
  private waveDirector!: WaveDirector;
  private bossEncounter!: BossEncounter;
  private giant!: GiantAsteroid;
  private actTransition!: ActTransition;
  private healthBars!: HealthBars;
  private failOverlay!: Overlay;
  private victoryOverlay!: Overlay;
  /** Cumulative rocket→asteroid hits — a deterministic signal for the e2e suite. */
  private hitCount = 0;

  constructor() {
    super('Sandbox');
  }

  /** `data.lineup`: the join screen's seats + difficulties (#20); Try again
   *  passes it back unchanged. `data.startWave`: a Try again retry's wave (the
   *  fail card passes it); absent on a run from the join screen, which starts
   *  from the query. */
  create(data: { lineup: Lineup; startWave?: number }): void {
    generateTextures(this);
    // Backdrop first (construction order = depth): stars, the lane band, then
    // the fleet, all under the asteroids and rockets (rockets fly over ships).
    this.starfield = new Starfield(this);
    drawLane(this);
    this.fleet = new Fleet(this, (x, y, r) => this.explosions.boom(x, y, r));

    this.rockets = new RocketPool(this);
    this.explosions = new Explosions(this); // one shared burst system (B29)
    const run = data.lineup;
    const live = liveSeats(run);
    const players = live.length === 1 ? 1 : 2;
    // Each HUD sits in the centre column under its launcher, between SPECIAL and
    // the aim pad (P1's rotated 180° about the field centre); a lefty seat's
    // shifts to clear its mirrored buttons.
    const hudAt = (edge: SeatEdge, lefty: boolean) => ({
      ...seatPoint(edge, lefty ? CONTROLS_V2.hudLefty : CONTROLS_V2.hud),
      angle: edge === 'top' ? 180 : 0,
    });
    // Per-seat wiring: P1 sits at the top edge, P2 at the bottom. Only joined
    // seats are built (their HUD here, their control below), so in solo nothing
    // claims touches in the empty seat's region. An Easy seat never runs dry.
    const seats: readonly Seat[] = SEAT_DEFS.filter((d) => live.includes(d.player)).map((d) => {
      const hud = new PlayerHud(this, { ...hudAt(d.edge, isLefty(leftySetting(), d.player)), colorCss: d.colorCss, color: d.color });
      hud.setUnlimitedAmmo(run[d.player] === 'easy');
      return { ...d, hud };
    });
    const huds = seats.map((seat) => seat.hud);
    this.huds = huds;
    this.scoreKeeper = new ScoreKeeper(this, huds); // shared score (B6)
    // Solo draws no banner/end-card copy toward the empty seat either.
    const banner = new WaveBanner(this, live);
    // Shortcut: ?wave=N (or ?boss, the command ship) boots at that wave, and
    // Try again retries it, so a tester can re-run one wave. Survives the
    // restart (the query string sticks). Harmless in normal play — nobody
    // types it by accident. Without a shortcut this is 1.
    const queryWave = startWaveFromQuery(window.location.search);
    // Try again restarts at the lost act's first wave (AC5), but never before
    // a shortcut's wave, so a shortcut's wave retries itself until the players
    // pass it. It keeps the lineup (#20).
    this.failOverlay = new Overlay(this, FAIL_CONFIG, live, () =>
      this.scene.restart({ lineup: run, startWave: Math.max(queryWave, actStartWave(this.waveDirector.waveNumber)) })
    );
    // A win ends the run and goes back to the join screen for a fresh lineup
    // (#20), which starts the next run with new data.
    this.victoryOverlay = new Overlay(this, VICTORY_CONFIG, live, () => this.scene.start('Join'));

    // The command-ship boss (B5) creates its boss + escort sprites up front
    // (parked); the run hands it the field for wave 6.
    this.bossEncounter = new BossEncounter(
      this,
      this.fleet,
      this.failOverlay,
      () => this.waveDirector.onEncounterDefeated(),
      players
    );

    // The giant asteroid (#25), act 1's boss: its sprite is built once,
    // parked, like the command ship's. Popping it bursts it through the
    // director; reaching the fleet loses the whole fleet.
    this.giant = new GiantAsteroid(
      this,
      players === 1,
      () => {
        this.fleet.loseAll();
        this.showFail();
      },
      (x, y) => {
        this.explosions.boom(x, y, this.giant.radius);
        this.waveDirector.burstBoss(x, y);
      }
    );

    // Between acts the fleet flies across (#29), on the scene's update clock.
    this.actTransition = new ActTransition(this.fleet, this.starfield);

    // The director creates the asteroid wrappers and starts the first wave live.
    this.waveDirector = new WaveDirector(
      this,
      this.fleet,
      huds,
      banner,
      {
        startWave: data.startWave ?? queryWave,
        hooks: {
          ...NO_INTERLUDES, // #26 boss drops
          actTransition: (from, to, done) => this.actTransition.start(from, to, done),
        },
        startEncounter: (boss) => {
          if (boss !== 'giantAsteroid') return this.bossEncounter.start();
          this.fleet.setShieldRegenMs(GIANT.shieldRegenMs);
          this.giant.start();
        },
        stopEncounter: () => {
          this.bossEncounter.stop();
          this.giant.stop();
        },
        stopInterludes: () => this.actTransition.cancel(),
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
    const barTargets: HealthBarTarget[] = [...this.asteroids, this.giant];
    const drawHealthBars = () => this.healthBars.draw(barTargets);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, drawHealthBars);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.POST_UPDATE, drawHealthBars));

    this.controls = seats.map(
      ({ player, anchor, color, edge, tex, hud }) =>
        new TwoThumbControl(this, {
          anchor,
          color,
          edge,
          lefty: isLefty(leftySetting(), player),
          // The swap (#21) mirrored this seat: remember it, move its HUD.
          onLeftyChange: (lefty) => {
            setSeatLefty(player, lefty);
            const at = hudAt(edge, lefty);
            hud.setPosition(at.x, at.y);
          },
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

    // Third, built ONCE over the giant asteroid's sprite (#25).
    this.physics.add.overlap(this.rockets.group, this.giant.sprite, this.handleGiantHit);

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
        // Defeat the current wave's boss: the giant pops (and bursts), the command ship goes down.
        defeatBoss: () => (this.waveDirector.wave.boss === 'giantAsteroid' ? this.giant.debugDefeat() : this.bossEncounter.debugDefeat()),
        hits: () => this.hitCount,
        score: () => this.scoreKeeper.value,
        childrenAlive: () => this.asteroids.filter((a) => a.isChild && a.isActive).length,
        splitCount: () => this.waveDirector.splitCount,
        asteroidHp: (slot: number) => this.asteroids[slot]?.hp,
        healthBars: () => this.healthBars.lastDrawn,
        // The phone's lefty setting (kept current by the seats' swaps, #21).
        lefty: () => leftySetting(),
        hudPos: (player: number) => hud(player)?.position,
        seats: () => seats.map((seat) => seat.player),
        // The lineup's pick for a seat: 'easy' | 'normal', or null if it didn't join.
        difficulty: (player: number) => {
          const id = seatId(player);
          return id ? run[id] : undefined;
        },
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
        // The giant asteroid (#25): its state, a hit through its real rule, and a move.
        giant: () => ({
          active: this.giant.isActive,
          hp: this.giant.hp,
          maxHp: this.giant.maxHp,
          lock: this.giant.lock,
          x: this.giant.sprite.x,
          y: this.giant.sprite.y,
          r: this.giant.radius,
          visible: this.giant.sprite.visible,
        }),
        hitGiant: (player: PlayerId, charged: boolean) => this.giant.takeHit(player, charged),
        setGiantX: (x: number) => this.giant.debugSetX(x),
        giantWave: () => RUN.findIndex((w) => w.boss === 'giantAsteroid') + 1,
        // The fleet, top to bottom: 'shielded' | 'exposed' | 'lost' per ship (#19).
        fleet: () => this.fleet.states(),
        starOffsets: () => this.starfield.offsets,
        // The act transition (#29): its phase, the fleet's shift, the star
        // speed scale, and every flyby so far ('1-2', …).
        transition: () => ({
          phase: this.actTransition.phase,
          offsetX: this.fleet.offsetX,
          starScale: this.starfield.speedScaleNow,
          flights: [...this.actTransition.flights],
        }),
        skipTransition: () => this.actTransition.skip(),
      };
    }
  }

  update(_time: number, delta: number): void {
    this.starfield.update(delta); // space keeps streaming past, even behind a card
    // Freeze game logic behind either end-card; tweens still finish.
    if (this.failOverlay.visible || this.victoryOverlay.visible) return;
    for (const control of this.controls) control.update(delta);
    for (const asteroid of this.asteroids) asteroid.update(delta);
    // Steer in-flight missiles (#22; they re-acquire through the same picker),
    // then advance + redraw every shot's exhaust trail.
    this.rockets.steer(delta, this.pickMissileTarget);
    this.rockets.update(delta);
    this.fleet.update(delta); // bubble pulse + each ship's shield regen
    this.waveDirector.update(delta); // wave-clear check
    this.actTransition.update(delta); // the between-acts flyby (idle otherwise)
    this.giant.update(delta); // act 1's boss (no-op outside wave 3)
    this.bossEncounter.update(delta); // boss fight (no-op outside wave 6)
    // Global web line collision (B34): a shot crossing a live link is spent.
    this.rockets.recycleWhere((rocket) => this.bossEncounter.blocksRocket(rocket));
    this.checkFleetContacts();
  }

  /** A rock threatens the ship of the sublane its centre is in (by sublane,
   *  not by shape, so a rock skimming a sublane's edge still hits its ship).
   *  Its leading edge reaching that ship's bubble front (or the bare hull's
   *  nose) is consumed: it pops the shield, or loses the ship if the shield is
   *  down. A lost ship's sublane is skipped, so its rocks fly past and leave
   *  harmlessly off the left edge. The last ship lost ends the round. */
  private checkFleetContacts(): void {
    for (const asteroid of this.asteroids) {
      if (!asteroid.isActive || asteroid.isPopping) continue;
      const s = asteroid.sprite;
      const ship = sublaneOf(s.y);
      if (!this.fleet.isLive(ship)) continue;
      if (s.x - asteroid.radius > this.fleet.contactX(ship)) continue;
      const result = this.fleet.onEnemyReached(ship);
      asteroid.consume();
      if (result === 'fleetLost') {
        this.showFail();
        return;
      }
    }
  }

  /** The fleet is lost: freeze the field behind the fail card. */
  private showFail(): void {
    this.physics.pause();
    this.failOverlay.show();
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
      // A stream rock is fielded (active) just off the right edge before it
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
      // fleet consume() never scores, so it never splits). Read position
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

  /** Rocket vs the giant asteroid (#25). GiantAsteroid.takeHit holds the rule
   *  (only charged rounds count; paired across seats in two-player); a refused
   *  hit throws a grey spark where the shot landed. Every hit spends the shot,
   *  except a charged round that popped it, which carries on (#22). */
  private readonly handleGiantHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    if (!pair) return;
    const { rocket } = pair;
    const charged = rocket.getData('charged') === true;
    const result = this.giant.takeHit(rocket.getData('player') as PlayerId, charged);
    if (result === 'refused') rejectSpark(this, rocket.x, rocket.y);
    this.spendShot(rocket, charged, result === 'popped');
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
}
