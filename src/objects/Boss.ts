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
import { COLORS } from '../tokens';
import { BOSS_LAYOUT, STATION } from '../layout';
import { BOSS } from '../waves';
import { TEX } from './textures';

export class Boss {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = BOSS_LAYOUT.radius;
  private hp = BOSS.hp;
  private active = false;
  private entering = false;
  private popping = false;
  private dead = false;

  constructor(
    private readonly scene: Phaser.Scene,
    /** HP reached 0. */
    private readonly onDefeated: () => void
  ) {
    const { x, y } = BOSS_LAYOUT.park;
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
    this.dead = false;
    this.popping = false;
    this.hp = BOSS.hp;
    const { x, y } = BOSS_LAYOUT.park;
    this.sprite
      .setVisible(true)
      .setScale(1)
      .setAlpha(1)
      .clearTint()
      .setPosition(BOSS_LAYOUT.enterFromX, y)
      .setRotation(Math.atan2(STATION.cy - y, STATION.cx - x) + Math.PI / 2);
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

  /** DEV/test: finish the slide-in instantly. The entrance is a wall-clock
   *  tween (Phaser's TweenManager ignores the fixed-timestep delta), so the
   *  headless test harness can't advance it by stepping; this snaps to the
   *  parked, entered state the tween's onComplete would otherwise reach. */
  snapEntered(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setPosition(BOSS_LAYOUT.park.x, BOSS_LAYOUT.park.y);
    this.entering = false;
  }

  takeHit(charged: boolean): void {
    // B34: the web, not a boss ring/state gate, protects the command ship.
    // A railgun that reaches it through a missing link can always chip HP.
    if (!charged || !this.isActive) return;
    this.hp -= 1;
    if (this.hp > 0) return;
    this.dead = true;
    this.active = false;
    this.popping = true;
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
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

  private park(): void {
    this.active = false;
    this.entering = false;
    this.dead = false;
    this.popping = false;
    this.sprite.setVisible(false);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
