/**
 * MotherJelly (#28) — act 3's boss, wave 9. A big jelly that slides in from
 * the right edge to the lane's right end, then bobs slowly up and down it,
 * releasing MOTHER.babiesPerRelease baby jellies every MOTHER.releaseEveryMs
 * (through the JellySwarm, so they swim at the fleet like any jelly).
 *
 *   parked → entering → live → popping → parked
 *
 * Every weapon hurts her (plain 1, charged 2, missile 1, blast 2), and
 * missiles can take her as well as her babies. She heals like a jelly
 * (#28 D6, the same HealingHp): MOTHER.healPauseMs after her last hit she
 * climbs back toward full, empty → full in MOTHER.healFullMs, so given time
 * she recovers completely.
 * The scene's HealthBars shows her hp (she has the HealthBarTarget shape) and
 * a green halo shows her healing. At 0 hp she pops (`onPopped`: the scene pops
 * every baby still in flight and ends the wave; the boss drop follows). She
 * never touches the fleet herself: her babies do the damage.
 *
 * Every timer runs on update()'s delta (no tweens), so she steps in lockstep
 * with the e2e fixed clock. Motion is kinematic, like a jelly's. Her hit
 * sprite is built ONCE (parked) so the scene's rocket↔mother collider never
 * points at a recreated body.
 */
import Phaser from 'phaser';
import { JELLY_LAYOUT, MOTHER_LAYOUT } from '../layout';
import { COLORS } from '../tokens';
import { MOTHER } from '../waves';
import type { Fleet } from './Fleet';
import { HealingHp } from './HealingHp';
import type { HomingTarget } from './HomingTarget';
import { fitJellyBody, JELLY_TEX, TEX } from './textures';

export type MotherPhase = 'parked' | 'entering' | 'live' | 'popping';

export class MotherJelly implements HomingTarget {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = MOTHER_LAYOUT.radius;
  private readonly image: Phaser.GameObjects.Image;
  private readonly halo: Phaser.GameObjects.Graphics;
  private phaseState: MotherPhase = 'parked';
  private readonly life = new HealingHp(MOTHER.hp, MOTHER.healPauseMs, MOTHER.healFullMs);
  private flashMs = 0;
  private t = 0; // ms into her entry, bob or pop
  private releaseInMs = 0;
  /** Babies released so far this fight (the e2e suite reads it). */
  released = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly fleet: Fleet,
    /** Release n babies from (x, y): the JellySwarm's releaseBabies. Returns how many it fielded. */
    private readonly release: (x: number, y: number, n: number) => number,
    /** Her last hp went at (x, y). */
    private readonly onPopped: (x: number, y: number) => void
  ) {
    const key = TEX.jelly(MOTHER_LAYOUT.radius);
    this.sprite = scene.physics.add.sprite(0, MOTHER_LAYOUT.y, key).setVisible(false).setOrigin(JELLY_TEX.originX, JELLY_TEX.originY);
    this.sprite.setData('ref', this);
    fitJellyBody(this.sprite, this.radius).setAllowGravity(false);
    // Dome to the left, at the fleet: her tentacles trail off to the right.
    this.image = scene.add.image(0, MOTHER_LAYOUT.y, key).setDepth(2).setOrigin(JELLY_TEX.originX, JELLY_TEX.originY).setRotation(-Math.PI / 2);
    this.halo = scene.add.graphics().setDepth(2.2);
    this.stop();
  }

  get hp(): number {
    return this.life.hp;
  }
  get maxHp(): number {
    return this.life.maxHp;
  }
  get phase(): MotherPhase {
    return this.phaseState;
  }
  /** In the fight (sliding in or bobbing): a rocket, missile and health-bar target. */
  get isActive(): boolean {
    return this.phaseState === 'entering' || this.phaseState === 'live';
  }
  get isPopping(): boolean {
    return this.phaseState === 'popping';
  }
  get healing(): boolean {
    return this.isActive && this.life.healing;
  }

  /** The wave starts: slide in from off the right edge at full hp, with the
   *  boss's shield regen on the fleet. */
  start(): void {
    this.fleet.setShieldRegenMs(MOTHER.shieldRegenMs);
    this.phaseState = 'entering';
    this.life.reset(MOTHER.hp, MOTHER.healPauseMs, MOTHER.healFullMs);
    this.flashMs = 0;
    this.t = 0;
    this.released = 0;
    this.releaseInMs = MOTHER.firstReleaseMs;
    this.image.setVisible(true).setAlpha(1).setScale(1).clearTint();
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
    this.placeAt(MOTHER_LAYOUT.enterFromX, MOTHER_LAYOUT.y);
  }

  /** Off the field, parked (a wave jump away from her, and at build). */
  stop(): void {
    this.phaseState = 'parked';
    this.flashMs = 0;
    this.halo.clear();
    this.image.setVisible(false).clearTint();
    this.placeAt(MOTHER_LAYOUT.enterFromX, MOTHER_LAYOUT.y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }

  update(deltaMs: number): void {
    if (this.phaseState === 'parked') return;
    if (this.phaseState === 'popping') {
      this.t += deltaMs;
      const u = Math.min(1, this.t / MOTHER_LAYOUT.popMs);
      this.image.setScale(1 + 0.5 * u).setAlpha(1 - u);
      if (u >= 1) this.stop();
      return;
    }
    this.life.tick(deltaMs);
    if (this.flashMs > 0) {
      this.flashMs -= deltaMs;
      if (this.flashMs <= 0) this.image.clearTint();
    }
    this.t += deltaMs;
    if (this.phaseState === 'entering') {
      const e = Phaser.Math.SmoothStep(this.t, 0, MOTHER_LAYOUT.enterMs);
      this.placeAt(Phaser.Math.Linear(MOTHER_LAYOUT.enterFromX, MOTHER_LAYOUT.x, e), MOTHER_LAYOUT.y);
      if (e >= 1) {
        this.phaseState = 'live';
        this.t = 0;
      }
    } else {
      const bob = Math.sin((this.t / MOTHER_LAYOUT.bobMs) * Math.PI * 2);
      this.placeAt(MOTHER_LAYOUT.x, MOTHER_LAYOUT.y + bob * MOTHER_LAYOUT.bobAmp);
      this.releaseInMs -= deltaMs;
      if (this.releaseInMs <= 0) {
        this.releaseInMs += MOTHER.releaseEveryMs;
        this.released += this.release(this.sprite.x - this.radius - JELLY_LAYOUT.babyRadius, this.sprite.y, MOTHER.babiesPerRelease);
      }
    }
    this.drawHalo();
  }

  /** A hit dealing `damage` (any weapon): restarts her heal's wait. She's a
   *  boss, so a hit never scores (the command ship's fight is unscored too);
   *  returns 0. */
  takeHit(damage: number): number {
    if (!this.isActive) return 0;
    if (this.life.hit(damage)) this.pop();
    else {
      this.image.setTintFill(COLORS.white);
      this.flashMs = MOTHER_LAYOUT.hitFlashMs;
    }
    return 0;
  }

  /** DEV/test: pop her now, through the real pop path. */
  debugDefeat(): void {
    if (!this.isActive) return;
    this.pop();
  }

  /** DEV/test: set her hp (clamped to 0..max), her heal's wait restarted. */
  debugSetHp(hp: number): void {
    if (this.isActive) this.life.set(hp);
  }

  private placeAt(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.image.setPosition(x, y);
  }

  private drawHalo(): void {
    const g = this.halo.clear();
    if (!this.healing) return;
    const { pad, width, alpha } = JELLY_LAYOUT.halo;
    g.lineStyle(width + 1, COLORS.health, alpha);
    g.strokeCircle(this.sprite.x, this.sprite.y, this.radius + pad);
  }

  private pop(): void {
    const { x, y } = this.sprite;
    this.life.set(0);
    this.phaseState = 'popping';
    this.t = 0;
    this.flashMs = 0;
    this.halo.clear();
    this.image.clearTint();
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.onPopped(x, y);
  }
}
