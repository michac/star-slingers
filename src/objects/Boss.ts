/**
 * Boss (B5) — the run's finale. Slides in from the right, parks at center, and
 * holds stationary. The fight is a repeating CYCLE driven by the BossEncounter:
 * while shielded (`shield()`) the boss is invulnerable and shows a plain shield
 * ring; clear the escorts in time and the encounter `expose()`s it for a window
 * to take hits; otherwise the charge fills and the encounter calls `fireBeam()`
 * (it shatters a shield ring).
 *
 * HP and the charge countdown are read off the two off-boss gauges (BossBars,
 * owned by the encounter), so the center stays uncluttered. Satisfies
 * HomingTarget (hittable while exposed).
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { BOSS_LAYOUT, STATION } from '../layout';
import { BOSS } from '../waves';
import { TEX } from './textures';

export class Boss {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = BOSS_LAYOUT.radius;
  /** The plain "invulnerable" shield ring, under the boss sprite. */
  private readonly fx: Phaser.GameObjects.Graphics;

  private hp = BOSS.hp;
  private active = false;
  private entering = false;
  private vulnerable = false;
  private popping = false;
  private dead = false;

  constructor(
    private readonly scene: Phaser.Scene,
    /** HP reached 0. */
    private readonly onDefeated: () => void
  ) {
    const { x, y } = BOSS_LAYOUT.park;
    this.fx = scene.add.graphics().setDepth(1);
    this.sprite = scene.physics.add.sprite(x, y, TEX.boss).setDepth(2);
    this.sprite.setData('ref', this);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(this.radius);

    this.park();
  }

  // HomingTarget: hittable once it has finished entering and isn't dead.
  get isActive(): boolean {
    return this.active && !this.entering && !this.dead;
  }
  get isPopping(): boolean {
    return this.popping;
  }
  get isEntered(): boolean {
    return this.active && !this.entering;
  }
  get currentHp(): number {
    return this.hp;
  }

  /** Slide in from the right; the encounter starts charging once entered. */
  activate(): void {
    this.active = true;
    this.entering = true;
    this.vulnerable = false;
    this.dead = false;
    this.popping = false;
    this.hp = BOSS.hp;
    const { x, y } = BOSS_LAYOUT.park;
    this.sprite
      .setVisible(true)
      .setScale(1)
      .setAlpha(1)
      .setTint(0x8a78c8) // muted = shielded / locked
      .setPosition(BOSS_LAYOUT.enterFromX, y);
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
    this.scene.tweens.add({
      targets: this.sprite,
      x,
      duration: BOSS_LAYOUT.enterMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.entering = false;
      },
    });
  }

  /** Per-frame render (timing is the encounter's; this just paints). */
  update(): void {
    this.drawFx();
  }

  /** Open the damage window: drop the shield, full color, takes hits. */
  expose(): void {
    this.vulnerable = true;
    this.sprite.clearTint();
  }

  /** Re-shield between cycles: invulnerable again, muted. */
  shield(): void {
    this.vulnerable = false;
    if (!this.dead) this.sprite.setTint(0x8a78c8);
  }

  takeHit(): void {
    if (!this.vulnerable || this.dead) return;
    this.hp -= 1;
    if (this.hp > 0) return;
    this.dead = true;
    this.active = false;
    this.popping = true;
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.fx.clear();
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.8,
      alpha: 0,
      duration: 280,
      onComplete: () => {
        this.popping = false;
        this.onDefeated();
      },
    });
  }

  /** A bright beam flashes boss → station when a charge fires. */
  fireBeam(): void {
    const g = this.scene.add.graphics().setDepth(1);
    g.lineStyle(6, COLORS.danger, 0.9);
    g.lineBetween(this.sprite.x, this.sprite.y, STATION.cx, STATION.cy);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** The plain "invulnerable" shield ring while shielded; nothing while
   *  exposed (plain, clearly hittable). The charge urgency now lives in the
   *  off-boss CHARGE bar (BossBars), keeping the center uncluttered. */
  private drawFx(): void {
    const g = this.fx;
    g.clear();
    if (!this.active || this.dead || this.entering || this.vulnerable) return;
    const { x, y } = this.sprite;
    g.lineStyle(STROKES.shield.width, COLORS.shieldOuter, 0.8);
    g.strokeCircle(x, y, this.radius + BOSS_LAYOUT.shieldRingPad);
  }

  private park(): void {
    this.active = false;
    this.entering = false;
    this.dead = false;
    this.popping = false;
    this.vulnerable = false;
    this.sprite.setVisible(false);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.fx.clear();
  }
}
