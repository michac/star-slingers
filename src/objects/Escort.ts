/**
 * Escort (B5) — one of the 4 small guards that orbit the final boss. Pure
 * gating target: it doesn't threaten the station, but while any escort lives
 * the boss is invulnerable, and destroying one INTERRUPTS the boss's charge
 * (the defensive payoff). The BossEncounter places it on the orbit each frame
 * (kinematic — we set position, the arcade body follows). Satisfies
 * HomingTarget so the 5yo's homing can lock it.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { BOSS_LAYOUT } from '../layout';
import { BOSS } from '../waves';
import { TEX } from './textures';

export class Escort {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = BOSS_LAYOUT.escort.radius;
  private hitsLeft = BOSS.escortHits;
  private active = false;
  private popping = false;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Fired the instant this escort is destroyed (gate + interrupt). */
    private readonly onDestroyed: () => void
  ) {
    this.sprite = scene.physics.add
      .sprite(BOSS_LAYOUT.park.x, BOSS_LAYOUT.park.y, TEX.escort)
      .setDepth(2);
    this.sprite.setData('ref', this); // collision callback reaches the wrapper
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(this.radius);
    this.park();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isPopping(): boolean {
    return this.popping;
  }

  activate(): void {
    this.active = true;
    this.popping = false;
    this.hitsLeft = BOSS.escortHits;
    this.sprite.setTexture(TEX.escort).setVisible(true).setScale(1).setAlpha(1); // shield ring back on
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
  }

  /** Encounter repositions it on the orbit each frame. */
  place(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  takeHit(): void {
    if (!this.active || this.popping) return;
    this.hitsLeft -= 1;
    if (this.hitsLeft > 0) {
      // Shield ring knocked off → bare core (second hit will kill it).
      this.sprite.setTexture(TEX.escortCore);
      this.shatterRing();
      return;
    }
    // Destroyed: stop being a target/orbiter NOW so the gate fires immediately,
    // then a throwaway pop tween for juice.
    this.active = false;
    this.popping = true;
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.onDestroyed();
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.6,
      alpha: 0,
      duration: 160,
      onComplete: () => this.park(),
    });
  }

  /** Cyan shield ring flying apart on the first hit (same cue as the station
   *  shield shatter), so "it's not dead, hit again" reads clearly. */
  private shatterRing(): void {
    const g = this.scene.add.graphics({ x: this.sprite.x, y: this.sprite.y }).setDepth(2);
    g.lineStyle(STROKES.shield.width, COLORS.shieldOuter, STROKES.shield.alpha);
    g.strokeCircle(0, 0, this.radius);
    this.scene.tweens.add({
      targets: g,
      scale: 1.4,
      alpha: 0,
      duration: 180,
      onComplete: () => g.destroy(),
    });
  }

  private park(): void {
    this.active = false;
    this.popping = false;
    this.sprite.setVisible(false);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
