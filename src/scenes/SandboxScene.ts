/**
 * SandboxScene — game orchestrator. Wires together stars, the station +
 * shield, two SlingControls (multitouch), the rocket pool, the WaveDirector
 * (which owns the asteroids and the 4-wave run), per-player HUDs, the wave
 * banner, and the fail/victory overlays. All logic lives in objects/.
 */
import Phaser from 'phaser';
import { COLORS, CSS } from '../tokens';
import { HOMING, HUD_P1, HUD_P2, P1_ANCHOR, P2_ANCHOR, STARS, STATION } from '../layout';
import { generateTextures, TEX } from '../objects/textures';
import { SlingControl } from '../objects/SlingControl';
import { HomingToggle } from '../objects/HomingToggle';
import { RocketPool } from '../objects/Rocket';
import { Asteroid } from '../objects/Asteroid';
import { PlayerHud } from '../objects/PlayerHud';
import { Station } from '../objects/Station';
import { FAIL_CONFIG, Overlay, VICTORY_CONFIG } from '../objects/Overlay';
import { WaveBanner } from '../objects/WaveBanner';
import { WaveDirector } from '../objects/WaveDirector';
import { BossEncounter } from '../objects/BossEncounter';
import type { HomingTarget } from '../objects/HomingTarget';

export class SandboxScene extends Phaser.Scene {
  private controls: SlingControl[] = [];
  private homingToggles: HomingToggle[] = [];
  private asteroids: Asteroid[] = [];
  private rockets!: RocketPool;
  private station!: Station;
  private waveDirector!: WaveDirector;
  private bossEncounter!: BossEncounter;
  private failOverlay!: Overlay;
  private victoryOverlay!: Overlay;
  /** Cumulative rocket→asteroid hits — a deterministic signal for smoke.mjs. */
  private hitCount = 0;

  constructor() {
    super('Sandbox');
  }

  create(): void {
    generateTextures(this);
    this.drawStars();
    this.station = new Station(this); // under the asteroids/rockets

    this.rockets = new RocketPool(this);
    const hud1 = new PlayerHud(this, { ...HUD_P1, colorCss: CSS.p1 });
    const hud2 = new PlayerHud(this, { ...HUD_P2, colorCss: CSS.p2 });
    const banner = new WaveBanner(this);
    this.failOverlay = new Overlay(this, FAIL_CONFIG);
    this.victoryOverlay = new Overlay(this, VICTORY_CONFIG);

    // The boss (B5) creates its boss + escort sprites up front (parked); the
    // run hands off to it after wave 4 (replacing the old victory seam).
    this.bossEncounter = new BossEncounter(
      this,
      this.station,
      this.failOverlay,
      this.victoryOverlay
    );

    // The director creates the asteroid wrappers and starts wave 1 live.
    this.waveDirector = new WaveDirector(
      this,
      this.station,
      [hud1, hud2],
      banner,
      () => this.bossEncounter.start()
    );
    this.asteroids = this.waveDirector.asteroids;

    // Homing toggles (B14) — one per seat, beside each sling; state persists
    // across scene.restart() via the registry keys.
    const homing1 = new HomingToggle(this, {
      anchor: P1_ANCHOR,
      color: COLORS.p1,
      edge: 'top',
      registryKey: 'homingP1',
    });
    const homing2 = new HomingToggle(this, {
      anchor: P2_ANCHOR,
      color: COLORS.p2,
      edge: 'bottom',
      registryKey: 'homingP2',
    });
    this.homingToggles = [homing1, homing2];

    this.controls = [
      new SlingControl(this, {
        anchor: P1_ANCHOR,
        color: COLORS.p1,
        edge: 'top',
        rocketTexture: TEX.rocketP1,
        canFire: () => hud1.canFire(),
        onFire: (x, y, vx, vy) => {
          hud1.spend();
          this.fireRocket(TEX.rocketP1, x, y, vx, vy, homing1.enabled);
        },
        isHoming: () => homing1.enabled,
        homingTargetAt: (ox, oy, dx, dy) => this.homingMarker(ox, oy, dx, dy),
      }),
      new SlingControl(this, {
        anchor: P2_ANCHOR,
        color: COLORS.p2,
        edge: 'bottom',
        rocketTexture: TEX.rocketP2,
        canFire: () => hud2.canFire(),
        onFire: (x, y, vx, vy) => {
          hud2.spend();
          this.fireRocket(TEX.rocketP2, x, y, vx, vy, homing2.enabled);
        },
        isHoming: () => homing2.enabled,
        homingTargetAt: (ox, oy, dx, dy) => this.homingMarker(ox, oy, dx, dy),
      }),
    ];

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
      this.handleBossHit
    );

    // Deterministic handle for headless tests (smoke/wave scripts).
    if (import.meta.env.DEV) {
      (this as unknown as { __debug: object }).__debug = {
        clearWave: () => this.waveDirector.forceClear(),
        state: () => this.waveDirector.stateName,
        wave: () => this.waveDirector.waveNumber,
        hits: () => this.hitCount,
        setHoming: (player: number, on: boolean) => this.homingToggles[player - 1]?.set(on),
        startBoss: () => {
          this.waveDirector.endRunNow();
          this.bossEncounter.start();
        },
        bossPhase: () => this.bossEncounter.phase,
        killEscort: (i: number) => this.bossEncounter.killEscort(i),
        bossHp: () => this.bossEncounter.bossHp,
        escortsAlive: () => this.bossEncounter.aliveEscorts,
      };
    }

    // Test shortcut: visiting with ?boss boots straight into the final boss,
    // skipping the 4 waves (testing the fight via the waves is slow). Survives
    // the tap-to-restart (the query string sticks), so you can re-run it. Harm-
    // less in normal play — nobody types ?boss by accident.
    if (new URLSearchParams(window.location.search).has('boss')) {
      this.waveDirector.endRunNow(); // pop wave 1's just-spawned rocks, stop respawns
      this.bossEncounter.start();
    }
  }

  update(_time: number, delta: number): void {
    // Freeze game logic behind either end-card; tweens still finish.
    if (this.failOverlay.visible || this.victoryOverlay.visible) return;
    for (const control of this.controls) control.update();
    for (const asteroid of this.asteroids) asteroid.update();
    // Steer in-flight homing shots toward their locked targets (B14).
    this.rockets.steer(delta);
    this.station.update(delta); // shield regen clock
    this.waveDirector.update(delta); // wave-clear check
    this.bossEncounter.update(delta); // boss fight (no-op until the run clears)
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

  /** Fire a rocket. It homes ONLY if this seat's toggle is on AND it locks a
   *  target at fire (the highlighted rock); otherwise it's an ordinary straight
   *  shot. A locked shot is meant to connect (see HOMING.turnRateDeg). */
  private fireRocket(tex: string, x: number, y: number, vx: number, vy: number, homing: boolean): void {
    const rocket = this.rockets.fire(tex, x, y, vx, vy);
    if (!rocket || !homing) return;
    const target = this.pickHomingTarget(x, y, vx, vy);
    if (!target) return; // no lock → leave it a straight shot
    rocket.setData('homing', true);
    rocket.setData('target', target);
    rocket.setData('speed', Math.hypot(vx, vy));
    rocket.setData('dist', 0); // travelled distance, for the arm/ramp curve
    // Cap the straight arming run so it can't sail past a closer target.
    const toTarget = Phaser.Math.Distance.Between(x, y, target.sprite.x, target.sprite.y);
    rocket.setData('armAt', Math.min(HOMING.armDistancePx, toTarget * HOMING.armFraction));
  }

  /** The asteroid closest to the launch ray (origin + direction), within a
   *  forward cone and range — the homing lock (B14). Used at fire and, via
   *  homingMarker, for the aim preview. Returns null when nothing qualifies. */
  private pickHomingTarget(ox: number, oy: number, dirx: number, diry: number): HomingTarget | null {
    const len = Math.hypot(dirx, diry);
    if (len === 0) return null;
    const ux = dirx / len;
    const uy = diry / len;
    const maxTan = Math.tan(Phaser.Math.DegToRad(HOMING.coneHalfAngleDeg));

    let best: HomingTarget | null = null;
    let bestPerp = Infinity;
    // Asteroids during the waves, plus the boss/escorts during the finale, so
    // homing keeps working all the way through (B14 × B5).
    for (const cand of [...this.asteroids, ...this.bossEncounter.homingTargets()]) {
      if (!cand.isActive || cand.isPopping) continue;
      const s = cand.sprite;
      const dx = s.x - ox;
      const dy = s.y - oy;
      const proj = dx * ux + dy * uy; // distance along the ray (forward only)
      if (proj <= 0 || proj > HOMING.maxRange) continue;
      const perp = Math.abs(dx * uy - dy * ux); // perpendicular distance to the ray
      if (perp > HOMING.maxPerp) continue; // must pass close to the target's center
      if (perp > proj * maxTan) continue; // and within the cone
      if (perp < bestPerp) {
        bestPerp = perp;
        best = cand;
      }
    }
    return best;
  }

  /** Aim-preview marker for the locked target (position + ring radius), or null. */
  private homingMarker(ox: number, oy: number, dirx: number, diry: number): { x: number; y: number; r: number } | null {
    const target = this.pickHomingTarget(ox, oy, dirx, diry);
    if (!target) return null;
    return { x: target.sprite.x, y: target.sprite.y, r: target.radius + HOMING.ringPad };
  }

  /** Scene-level pointer events fanned out to both controls; each control
   *  claims its own pointer by id, so two fingers work simultaneously. */
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
    // without it the sling sticks mid-pull.
    this.input.on('pointerupoutside', release);
  }

  private readonly handleHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    // Phaser does NOT guarantee arg order for group-vs-array overlaps, so
    // sort out which sprite is which by the rocket flag.
    const first = a as Phaser.Physics.Arcade.Sprite;
    const second = b as Phaser.Physics.Arcade.Sprite;
    const rocket = first.getData('isRocket') ? first : second;
    const target = rocket === first ? second : first;
    const asteroid = target.getData('ref') as Asteroid | undefined;
    if (!rocket.getData('isRocket') || !asteroid) return;
    this.rockets.recycle(rocket);
    asteroid.takeHit();
    this.hitCount += 1;
  };

  /** Rocket vs boss/escort (B5). Same arg-order trick as handleHit; the
   *  wrapper's takeHit() decides what a hit means (the boss ignores hits while
   *  invulnerable). */
  private readonly handleBossHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (a, b) => {
    const first = a as Phaser.Physics.Arcade.Sprite;
    const second = b as Phaser.Physics.Arcade.Sprite;
    const rocket = first.getData('isRocket') ? first : second;
    const target = rocket === first ? second : first;
    const ref = target.getData('ref') as { takeHit: () => void } | undefined;
    if (!rocket.getData('isRocket') || !ref) return;
    this.rockets.recycle(rocket);
    ref.takeHit();
  };

  private drawStars(): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.star, 1);
    for (const star of STARS) {
      g.fillCircle(star.x, star.y, star.r);
    }
  }
}
