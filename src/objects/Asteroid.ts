/**
 * Asteroid — a drifting target: physics Sprite + a separate centered
 * hit-count Text synced every frame (NOT a Container body — Arcade Container
 * bodies have offset traps). Pops when its hits run out, then asks the
 * WaveDirector for respawn permission (the wave's finite quota); denied
 * respawns park it inactive instead. The wrapper itself is NEVER destroyed
 * or recreated — the scene's rocket→asteroid overlap collider is built once
 * over these sprites, and recreating them would silently kill hit detection.
 * Between waves the director reconfigure()s the same wrappers in place.
 */
import Phaser from 'phaser';
import { CSS, FONTS } from '../tokens';
import { APPROACH_X, GAME_WIDTH, SCORE, SPLIT, STATION } from '../layout';
import { type AsteroidSpec } from '../waves';
import { TEX } from './textures';

export class Asteroid {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private _spec: AsteroidSpec;
  private spawnGapMax: number;
  private hitsLeft: number;
  private popping = false;
  private active = false;
  /** True once the final-approach turn toward the station has happened. */
  private funnelling = false;
  /** Split fragment (B30): a one-shot 1-hit chunk, not a lane rock. */
  private fragment = false;
  /** Fragment lifetime clock — pauses for free behind overlays (update is
   *  frozen then). A hard cap (SPLIT.lifetimeMs) guarantees the wave clears. */
  private aliveMs = 0;
  /** Fragment spawn grace: body stays off until aliveMs passes this. */
  private graceUntilMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    spec: AsteroidSpec,
    spawnGapMax: number,
    /** Asks the wave for quota: true = respawn granted (and spent). */
    private readonly onWantRespawn: () => boolean,
    /** Fires the shared burst (B29) at a pop position. */
    private readonly boom: (x: number, y: number, radius: number) => void
  ) {
    this._spec = spec;
    this.spawnGapMax = spawnGapMax;
    this.hitsLeft = spec.hits;
    this.sprite = scene.physics.add.sprite(0, spec.y, TEX.asteroid(spec.radius));
    this.sprite.setData('ref', this); // collision callback reaches the wrapper
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(spec.radius); // texture is exactly 2r x 2r, so no offset

    this.label = scene.add
      .text(0, spec.y, '', { fontFamily: FONTS.display, fontSize: '14px', color: CSS.ink })
      .setOrigin(0.5);

    this.park(); // starts parked; the director spawn()s it when fielded
  }

  /** Read-only view kept for the scene's contact math and smoke.mjs. */
  get spec(): AsteroidSpec {
    return this._spec;
  }

  /** HomingTarget: the collision radius (mirrors spec.radius). */
  get radius(): number {
    return this._spec.radius;
  }

  /** Mid-pop asteroids are out of play (no station contact, no rocket hits). */
  get isPopping(): boolean {
    return this.popping;
  }

  /** Parked wrappers don't move, collide, or count toward field-empty. */
  get isActive(): boolean {
    return this.active;
  }

  /** Split fragments (B30) move fast on spawn — smoke selectors skip them. */
  get isFragment(): boolean {
    return this.fragment;
  }

  /** Swap this wrapper to a new wave's lane values (texture, body, tuning),
   *  parked — the director spawn()s it against the new wave's quota. */
  reconfigure(spec: AsteroidSpec, spawnGapMax: number): void {
    this.scene.tweens.killTweensOf(this.sprite); // a mid-pop tween would respawn it
    this._spec = spec;
    this.spawnGapMax = spawnGapMax;
    this.fragment = false; // defensive: lane reconfigure clears any fragment identity
    this.aliveMs = 0;
    this.sprite.setTexture(TEX.asteroid(spec.radius));
    (this.sprite.body as Phaser.Physics.Arcade.Body).setCircle(spec.radius);
    this.park();
  }

  /** Field this asteroid off the right edge (director-controlled; the
   *  director spends quota BEFORE calling this). */
  spawn(): void {
    this.respawn();
  }

  /** Field this wrapper as a scatter FRAGMENT (B30) at (x,y) with velocity
   *  (vx,vy) — a one-shot 1-hit chunk. Sibling to spawn(): same wrapper, but
   *  positioned in-field with a scatter burst rather than off the right edge,
   *  and its onWantRespawn returns false so pop/exit/expire just parks it. The
   *  funnel re-aim (update) later snaps it from the fast launchSpeed scatter to
   *  the calmer fragmentSpeed toward the station. */
  spawnFragment(x: number, y: number, vx: number, vy: number): void {
    this._spec = {
      radius: SPLIT.fragmentRadius,
      hits: 1,
      y, // unused for fragments (never respawns off the right edge), kept honest
      speed: SPLIT.fragmentSpeed, // the funnel re-aim cruises in at this calmer speed
    };
    this.fragment = true;
    this.active = true;
    this.popping = false;
    this.funnelling = false;
    this.hitsLeft = 1;
    this.aliveMs = 0;
    this.graceUntilMs = SPLIT.spawnGraceMs;
    this.sprite.setVisible(true).setScale(1).setAlpha(1).setPosition(x, y);
    this.label.setPosition(x, y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y); // resets position AND zeroes velocity — set velocity AFTER
    body.enable = false; // grace: re-enabled in update() once aliveMs passes graceUntilMs
    body.setVelocity(vx, vy);
    this.refreshLabel();
  }

  update(delta: number): void {
    if (!this.active) return;
    this.label.setPosition(this.sprite.x, this.sprite.y);
    if (this.popping) return;
    if (this.fragment) {
      this.aliveMs += delta;
      // Spawn grace: keep the body off briefly so an in-flight railgun (whose
      // per-rocket hitSet predates this fragment) can't chip it the instant it
      // spawns. The aliveMs clock pauses for free behind overlays.
      const body = this.sprite.body as Phaser.Physics.Arcade.Body;
      if (!body.enable && this.aliveMs >= this.graceUntilMs) body.enable = true;
      // Hard lifetime cap: a fragment counts toward field-empty, so this
      // guarantees the wave can always clear even if one never reaches the
      // station or an edge. Parks (onWantRespawn is false).
      if (this.aliveMs >= SPLIT.lifetimeMs) {
        this.respawnOrPark();
        return;
      }
    }
    // Funnel: one-time velocity re-aim at the station on final approach.
    // A straight-line redirect (single kink), not a curve — upgrade to
    // per-frame Angle.RotateTo steering only if the kink reads badly.
    if (!this.funnelling && this.sprite.x <= APPROACH_X) {
      this.funnelling = true;
      const dir = new Phaser.Math.Vector2(
        STATION.cx - this.sprite.x,
        STATION.cy - this.sprite.y
      ).setLength(this._spec.speed);
      (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dir.x, dir.y);
    }
    if (this.sprite.x < -this._spec.radius) {
      this.respawnOrPark(); // safety net; station contact catches funnelled ones first
    }
  }

  /** The station consumed this asteroid (it reached the shield). */
  consume(): void {
    this.pop();
  }

  /** A rocket hit. Returns the points earned: 0 while it only chips (or is
   *  already popping/inactive), spec.hits × SCORE.perHit on the pop. Scoring is
   *  driven purely from here — consume() (station-reached) calls pop() directly
   *  and never scores. */
  takeHit(): number {
    if (this.popping || !this.active) return 0;
    if (this.fragment && this.aliveMs < this.graceUntilMs) return 0; // spawn grace (B30)
    this.hitsLeft -= 1;
    if (this.hitsLeft <= 0) {
      this.pop();
      return this._spec.hits * SCORE.perHit;
    }
    this.refreshLabel();
    return 0;
  }

  private pop(): void {
    this.popping = true;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.label.setText('');
    // The composed burst (B29) lives independently and self-cleans; the rock
    // itself just snaps bigger and vanishes under the flash, then recycles.
    this.boom(this.sprite.x, this.sprite.y, this._spec.radius);
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.35,
      alpha: 0,
      duration: 110,
      ease: 'Quad.Out',
      onComplete: () => this.respawnOrPark(),
    });
  }

  /** Quota gate: respawn if the wave still has asteroids to field. */
  private respawnOrPark(): void {
    if (this.onWantRespawn()) {
      this.respawn();
    } else {
      this.park();
    }
  }

  private respawn(): void {
    const { radius, y, speed, hits } = this._spec;
    this.active = true;
    this.popping = false;
    this.funnelling = false; // back to lane phase
    this.hitsLeft = hits;
    const x = GAME_WIDTH + radius + Phaser.Math.Between(0, this.spawnGapMax);
    this.sprite.setVisible(true).setScale(1).setAlpha(1).setPosition(x, y);
    // Move the label too — update() syncs it each frame, but update() is
    // frozen while an overlay shows, which left labels stranded.
    this.label.setPosition(x, y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    body.enable = true;
    body.setVelocityX(-speed);
    this.refreshLabel();
  }

  /** Strictly inactive: invisible, body off, label cleared, flags reset —
   *  the wave-clear check relies on this being unambiguous. */
  private park(): void {
    this.active = false;
    this.popping = false;
    this.funnelling = false;
    this.fragment = false; // B30: a parked wrapper is a plain free slot again
    this.aliveMs = 0;
    this.graceUntilMs = 0;
    this.sprite.setVisible(false);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.label.setText('');
  }

  /** Mock convention: only multi-hit rocks show a number. */
  private refreshLabel(): void {
    this.label.setText(this._spec.hits > 1 ? String(this.hitsLeft) : '');
  }
}
