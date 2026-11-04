/**
 * SandboxScene — game orchestrator. Wires together the scrolling starfield,
 * the enemy lane, the colony fleet (#19), a TwoThumbControl per joined seat (multitouch; the seats and their
 * Easy/Normal come from the join screen via lineup.ts; each seat's lefty swap
 * mirrors it and is remembered in controlsVariant.ts), the rocket pool, the WaveDirector
 * (which owns the asteroids and the 10-wave run), the command-ship boss
 * encounter, the between-acts fleet flyby (#29), per-player HUDs, the wave
 * banner, damaged enemies' health bars, and the fail/victory overlays. It
 * also owns the shot rules (#22): FIRE rounds and SPECIAL missiles (fireShot,
 * pickMissileTarget) and what each does on a hit (handleHit, handleBossHit),
 * and what an enemy reaching the fleet does (checkFleetContacts). And the
 * upgrades (#26): a boss wave's pod drop (UpgradeDrop, taken by FIRE rounds
 * in handlePodHit), the triple missile and the detonator's bomb + blast
 * (fireShot, detonate), and carrying each seat's special modes through Try
 * again (actStartSpecials). Everything else lives in objects/.
 */
import Phaser from 'phaser';
import { BOMB, CONTROLS_V2, GAME_WIDTH, HAPTICS, MISSILE, seatPoint, SLING, sublaneOf, TRIPLE, type SeatEdge } from '../layout';
import { isLefty, leftySetting, setSeatLefty } from '../controlsVariant';
import { liveSeats, SEAT_DEFS, type Lineup, type SeatDef } from '../lineup';
import { generateTextures } from '../objects/textures';
import { drawLane } from '../objects/draw';
import { Starfield } from '../objects/Starfield';
import { TwoThumbControl, type SeatSpecials, type ShotKind } from '../objects/TwoThumbControl';
import { RocketPool, type PlayerId } from '../objects/Rocket';
import { Explosions } from '../objects/Explosions';
import { Asteroid } from '../objects/Asteroid';
import { PlayerHud } from '../objects/PlayerHud';
import { ScoreKeeper } from '../objects/Score';
import { Fleet } from '../objects/Fleet';
import { FAIL_CONFIG, Overlay, VICTORY_CONFIG } from '../objects/Overlay';
import { WaveBanner } from '../objects/WaveBanner';
import { WaveDirector } from '../objects/WaveDirector';
import { BossEncounter } from '../objects/BossEncounter';
import { ActTransition } from '../objects/ActTransition';
import { Boss } from '../objects/Boss';
import { Escort } from '../objects/Escort';
import { HealthBars } from '../objects/HealthBars';
import { inBlast, specialCanHit, type HomingTarget } from '../objects/HomingTarget';
import type { SpecialKind } from '../objects/specials';
import { UpgradeDrop } from '../objects/UpgradeDrop';
import { actStartWave, BOSS_DROPS, COMMAND_SHIP_WAVE, DAMAGE, startWaveFromQuery } from '../waves';
import { buzz, shotBuzz } from '../haptics';

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

/** Each seat's special modes (#26), by seat. */
type SeatSpecialsMap = Partial<Record<PlayerId, SeatSpecials>>;

/** The missile's targeting cone (#22), as tan(half-angle) for the perpendicular test. */
const MISSILE_CONE_TAN = Math.tan(Phaser.Math.DegToRad(MISSILE.coneHalfAngleDeg));

export class SandboxScene extends Phaser.Scene {
  /** The live seats' controls (both seats, or the one joined seat in solo). */
  private controls: TwoThumbControl[] = [];
  /** HUDs, index-aligned with `controls` (each seat's two ammo pools live here). */
  private huds: PlayerHud[] = [];
  /** Each live seat's control, by seat (pod picks and bombs are per seat). */
  private seatControls: Partial<Record<PlayerId, TwoThumbControl>> = {};
  /** A boss wave's upgrade pods (#26). */
  private upgradeDrop!: UpgradeDrop;
  /** Each seat's detonator bomb while it's in flight (#26: one per seat). */
  private bombs: Partial<Record<PlayerId, Phaser.Physics.Arcade.Sprite>> = {};
  /** Each seat's special modes when the current act began: what Try again
   *  restarts the act with (#26). */
  private actStartSpecials: SeatSpecialsMap = {};
  private asteroids: Asteroid[] = [];
  private rockets!: RocketPool;
  private explosions!: Explosions;
  private starfield!: Starfield;
  private fleet!: Fleet;
  private scoreKeeper!: ScoreKeeper;
  private waveDirector!: WaveDirector;
  private bossEncounter!: BossEncounter;
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
   *  from the query. `data.specials`: a Try again retry's special modes per
   *  seat, as they were when the lost act began (#26); absent on a run from
   *  the join screen, so a fresh run has only the missile. */
  create(data: { lineup: Lineup; startWave?: number; specials?: SeatSpecialsMap }): void {
    generateTextures(this);
    // Backdrop first (construction order = depth): stars, the lane band, then
    // the fleet, all under the asteroids and rockets (rockets fly over ships).
    this.starfield = new Starfield(this);
    drawLane(this);
    this.fleet = new Fleet(this, (x, y, r) => this.explosions.boom(x, y, r));

    this.rockets = new RocketPool(this, (bomb) => this.detonate(bomb));
    // Phaser reuses this instance on restart: drop the last run's controls
    // before the director's starting wave reaches onWaveStart below.
    this.controls = [];
    this.seatControls = {};
    this.bombs = {};
    this.actStartSpecials = { ...data.specials };
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
      this.scene.restart({
        lineup: run,
        startWave: Math.max(queryWave, actStartWave(this.waveDirector.waveNumber)),
        specials: this.actStartSpecials,
      })
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

    // Between acts the fleet flies across (#29), on the scene's update clock.
    this.actTransition = new ActTransition(this.fleet, this.starfield);

    // A boss wave's upgrade pods (#26): sprites created once, parked.
    this.upgradeDrop = new UpgradeDrop(this);

    // The director creates the asteroid wrappers and starts the first wave live.
    this.waveDirector = new WaveDirector(
      this,
      this.fleet,
      huds,
      banner,
      {
        startWave: data.startWave ?? queryWave,
        hooks: {
          // #26: the popped boss's two pods; the flyby and banner wait until they're gone.
          bossDrop: (wave, done) => (wave.boss ? this.upgradeDrop.start(BOSS_DROPS[wave.boss], live, done) : done()),
          actTransition: (from, to, done) => this.actTransition.start(from, to, done),
        },
        startEncounter: () => this.bossEncounter.start(),
        stopEncounter: () => this.bossEncounter.stop(),
        stopInterludes: () => {
          this.actTransition.cancel();
          this.upgradeDrop.cancel();
        },
        onRunWon: () => this.victoryOverlay.show(),
        // Try again restarts an act with the specials its seats had when it
        // began (#26). Drops only come between acts, so that is every upgrade
        // picked so far. The starting wave runs before the controls exist; its
        // snapshot is the create data's, set above.
        onWaveStart: (n) => {
          if (n === actStartWave(n) && this.controls.length > 0) this.snapshotSpecials();
        },
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
          specials: data.specials?.[player],
          onSpecialChange: (kind) => hud.setSpecial(kind),
          detonate: () => {
            const bomb = this.bombs[player];
            if (bomb) this.detonate(bomb);
          },
        })
    );
    seats.forEach((seat, i) => (this.seatControls[seat.player] = this.controls[i]));
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

    // Third, also built ONCE over the two pod sprites (#26): a FIRE round from a
    // seat that hasn't picked yet takes the pod; anything else passes through.
    this.physics.add.overlap(this.rockets.group, this.upgradeDrop.sprites, this.handlePodHit, this.processPodHit);

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
        // A seat's special modes (#26), and a direct grant (as if picked).
        modes: (player: number) => this.controls[seatIndex(player)]?.specials,
        setSpecial: (player: number, kind: SpecialKind) => this.controls[seatIndex(player)]?.grant(kind),
        // Upgrade pods (#26): the drop's state, skipping it, and a pick
        // through the same path a FIRE round's pod hit takes.
        pods: () => this.upgradeDrop.state,
        skipDrop: () => this.upgradeDrop.skip(),
        pickPod: (player: number, i: number) => {
          const id = seatId(player);
          return id ? this.pickPod(id, i) : false;
        },
        // The seat's bomb in flight (#26), or null.
        bomb: (player: number) => {
          const id = seatId(player);
          const b = id && this.bombs[id];
          if (!b) return null;
          const v = (b.body as Phaser.Physics.Arcade.Body).velocity;
          return { x: b.x, y: b.y, vx: v.x, vy: v.y };
        },
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
    this.upgradeDrop.update(delta); // pods bob, time out and leave (#26)
    // Steer in-flight missiles (#22; they re-acquire through the same picker),
    // then advance + redraw every shot's exhaust trail.
    this.rockets.steer(delta, this.pickMissileTarget);
    this.rockets.update(delta);
    this.fleet.update(delta); // bubble pulse + each ship's shield regen
    this.waveDirector.update(delta); // wave-clear check
    this.actTransition.update(delta); // the between-acts flyby (idle otherwise)
    this.bossEncounter.update(delta); // boss fight (no-op outside wave 6)
    // Global web line collision (B34): a shot crossing a live link is spent
    // (a bomb blows up there, #26: RocketPool.end).
    this.rockets.endWhere((rocket) => this.bossEncounter.blocksRocket(rocket));
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
        this.physics.pause(); // freeze the field behind the overlay
        this.failOverlay.show();
        return;
      }
    }
  }

  /** Fire one seat's shot along the unit direction (dirx, diry). FIRE sends a
   *  round at SLING.maxSpeed, charged if FIRE was held to a full charge (the
   *  bright trail tier; its hit rule is in handleHit). SPECIAL sends the seat's
   *  current special (#26): the homing missile at MISSILE.speed, taking the
   *  enemy pickMissileTarget finds along the aim (with none it flies straight
   *  and keeps looking, Rocket.steer); the triple, three of them fanned
   *  ±TRIPLE.fanDeg, each taking a different enemy where there are enough; or
   *  the detonator's bomb, straight at BOMB.speed. Only FIRE charges, so a
   *  shot is never both. The HUD has already spent one round of the pool. */
  private fireShot(tex: string, player: PlayerId, x: number, y: number, dirx: number, diry: number, kind: ShotKind): void {
    const charged = kind.charged;
    let sent = false;
    if (kind.button === 'fire') {
      sent = !!this.rockets.fire(tex, x, y, dirx * SLING.maxSpeed, diry * SLING.maxSpeed, player, { charged });
    } else {
      const special = this.seatControls[player]?.special ?? 'missile';
      if (special === 'detonator') {
        const bomb = this.rockets.fire(tex, x, y, dirx * BOMB.speed, diry * BOMB.speed, player, { bomb: true });
        if (bomb) {
          this.bombs[player] = bomb;
          this.seatControls[player]?.setBombInFlight(true);
        }
        sent = !!bomb;
      } else {
        const fan = special === 'triple' ? [0, -TRIPLE.fanDeg, TRIPLE.fanDeg] : [0];
        const taken = new Set<HomingTarget>();
        for (const deg of fan) {
          const a = Phaser.Math.DegToRad(deg);
          const dx = dirx * Math.cos(a) - diry * Math.sin(a);
          const dy = dirx * Math.sin(a) + diry * Math.cos(a);
          const target = this.pickMissileTarget(x, y, dx, dy, taken);
          if (target) taken.add(target);
          if (this.rockets.fire(tex, x, y, dx * MISSILE.speed, dy * MISSILE.speed, player, { missile: true, target })) sent = true;
        }
      }
    }
    // Every seat's shot lands here, so this one buzz (#3) covers them all.
    if (sent) shotBuzz({ charged, special: kind.button === 'special' });
  }

  /** Blow up a seat's detonator bomb where it is (#26): its next SPECIAL
   *  press, touching an enemy or the shield web, or the world bounds. Every
   *  enemy a SPECIAL can hurt (specialCanHit) whose body reaches inside
   *  BOMB.blastRadius takes DAMAGE.blast: rocks through takeHit (score + splits
   *  exactly as a shot's kill), escorts that seat's lock
   *  (BossEncounter.blastEscorts). The boss is never hurt by it. */
  private detonate(bomb: Phaser.Physics.Arcade.Sprite): void {
    const player = bomb.getData('player') as PlayerId;
    const { x, y } = bomb;
    if (this.bombs[player] === bomb) {
      delete this.bombs[player];
      this.seatControls[player]?.setBombInFlight(false);
    }
    this.rockets.recycle(bomb);
    const r = BOMB.blastRadius;
    this.explosions.boom(x, y, r);
    buzz(HAPTICS.blastMs);
    for (const asteroid of this.asteroids) {
      const s = asteroid.sprite;
      // A rock still waiting off the right edge isn't in play yet (the
      // missile picker's rule too): a blast at the edge can't reach it.
      if (s.x - asteroid.radius >= GAME_WIDTH || !inBlast(asteroid, x, y, r)) continue;
      const pts = asteroid.takeHit(DAMAGE.blast);
      if (pts > 0) {
        this.scoreKeeper.add(pts, s.x, s.y);
        this.waveDirector.spawnChildren(asteroid);
      }
    }
    this.bossEncounter.blastEscorts(x, y, r, player);
  }

  /** Record each live seat's special modes as the act's starting point (Try again, #26). */
  private snapshotSpecials(): void {
    const snap: SeatSpecialsMap = {};
    for (const [player, control] of Object.entries(this.seatControls) as [PlayerId, TwoThumbControl][]) snap[player] = control.specials;
    this.actStartSpecials = snap;
  }

  /** `player` takes pod `i` (#26): the upgrade joins that seat's modes and
   *  becomes its current one. False if the seat can't pick it now. */
  private pickPod(player: PlayerId, i: number): boolean {
    const kind = this.upgradeDrop.pick(player, i);
    if (!kind) return false;
    this.seatControls[player]?.grant(kind);
    return true;
  }

  /** The missile's target (#22): the live enemy nearest the line from
   *  (ox, oy) along (dirx, diry), inside MISSILE's wide forward cone and range.
   *  Used at launch, for the aim preview while SPECIAL is held (missileMarker),
   *  and by an in-flight missile re-acquiring along its heading. Null when
   *  nothing qualifies. An arrow property so Rocket.steer can call it unbound. */
  private readonly pickMissileTarget = (ox: number, oy: number, dirx: number, diry: number, exclude?: ReadonlySet<HomingTarget>): HomingTarget | null => {
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
      if (!specialCanHit(cand) || exclude?.has(cand)) return;
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
    this.hitCount += 1;
    // A bomb touching a rock blows up there (#26); the blast does the damage.
    if (rocket.getData('bomb')) return this.detonate(rocket);

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
    // A bomb touching the boss or an escort blows up there (#26); the blast
    // locks escorts and never hurts the boss.
    if (rocket.getData('bomb')) return this.detonate(rocket);
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
    this.rockets.end(pair.rocket);
    return false;
  };

  /** Rocket vs pod (#26): only a FIRE round (plain or charged, never a missile
   *  or a bomb) from a seat that hasn't picked this drop takes a pod; anything
   *  else flies on through. */
  private readonly processPodHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    if (!pair) return false;
    const { rocket, other } = pair;
    if (rocket.getData('missile') || rocket.getData('bomb')) return false;
    return this.upgradeDrop.canPick(rocket.getData('player') as PlayerId, other.getData('podIndex') as number);
  };

  /** A FIRE round took a pod: the seat gets the upgrade, the round is spent. */
  private readonly handlePodHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const pair = splitPair(a, b);
    if (!pair) return;
    if (this.pickPod(pair.rocket.getData('player') as PlayerId, pair.other.getData('podIndex') as number)) this.rockets.recycle(pair.rocket);
  };
}
