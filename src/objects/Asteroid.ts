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
import { APPROACH_X, GAME_WIDTH, STATION } from '../layout';
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

  constructor(
    private readonly scene: Phaser.Scene,
    spec: AsteroidSpec,
    spawnGapMax: number,
    /** Asks the wave for quota: true = respawn granted (and spent). */
    private readonly onWantRespawn: () => boolean
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

  /** Swap this wrapper to a new wave's lane values (texture, body, tuning),
   *  parked — the director spawn()s it against the new wave's quota. */
  reconfigure(spec: AsteroidSpec, spawnGapMax: number): void {
    this.scene.tweens.killTweensOf(this.sprite); // a mid-pop tween would respawn it
    this._spec = spec;
    this.spawnGapMax = spawnGapMax;
    this.sprite.setTexture(TEX.asteroid(spec.radius));
    (this.sprite.body as Phaser.Physics.Arcade.Body).setCircle(spec.radius);
    this.park();
  }

  /** Field this asteroid off the right edge (director-controlled; the
   *  director spends quota BEFORE calling this). */
  spawn(): void {
    this.respawn();
  }

  update(): void {
    if (!this.active) return;
    this.label.setPosition(this.sprite.x, this.sprite.y);
    if (this.popping) return;
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

  takeHit(): void {
    if (this.popping || !this.active) return;
    this.hitsLeft -= 1;
    if (this.hitsLeft <= 0) {
      this.pop();
    } else {
      this.refreshLabel();
    }
  }

  private pop(): void {
    this.popping = true;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.label.setText('');
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.6,
      alpha: 0,
      duration: 160,
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
