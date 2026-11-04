/**
 * Escort (B5) — one of the 4 small guards that orbit the command-ship boss. Pure
 * gating target: it doesn't threaten the fleet, but each live escort anchors
 * two links of the shield web (B34); destroying one opens a gap and RESETS the
 * boss's charge (the defensive payoff). The BossEncounter places it on the orbit each frame
 * (kinematic — we set position, the arcade body follows). Satisfies
 * HomingTarget so the 5yo's SPECIAL missile can take it.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import { BOSS_LAYOUT } from '../layout';
import { BOSS } from '../waves';
import { TEX } from './textures';
import type { PlayerId } from './Rocket';

export class Escort {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly radius = BOSS_LAYOUT.escort.radius;
  private contributions = 0;
  private active = false;
  private popping = false;
  private downMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Fired the instant this escort is destroyed (gate + interrupt). */
    private readonly onDestroyed: () => void,
    /** Solo (one joined seat): both hits may come from the one seat (see takeHit). */
    private readonly solo: boolean
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

  /** B33 DEV/test read: 1=p1 cyan contributed, 2=p2 amber contributed. */
  get lockMask(): number {
    return this.contributions;
  }

  activate(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.active = true;
    this.popping = false;
    this.downMs = 0;
    this.contributions = 0;
    this.sprite.setTexture(TEX.escort).setVisible(true).setScale(1).setAlpha(1); // un-locked look back on
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
  }

  /** A downed node returns after B34's fixed shield-web gap window. */
  update(deltaMs: number): void {
    if (this.active || !this.popping) return;
    this.downMs += deltaMs;
    if (this.downMs >= BOSS.escortRegenMs) this.activate();
  }

  /** Encounter repositions it on the orbit each frame. */
  place(x: number, y: number, faceX: number, faceY: number): void {
    this.sprite.setPosition(x, y);
    this.sprite.setRotation(Math.atan2(faceY - y, faceX - x) + Math.PI / 2);
  }

  /** One unique hit from each player is required. Duplicate shots are consumed
   * but leave the lock unchanged, with a small muted reject spark. Solo (a
   * temporary prototype rule until #7's shot-type locks): it still takes two
   * hits, but a repeat from the same seat fills the other lock. Returns true
   * when this hit downed the escort (its second lock). */
  takeHit(player: PlayerId): boolean {
    if (!this.active || this.popping) return false;
    let bit = player === 'p1' ? 1 : 2;
    if (this.solo && this.contributions & bit) bit ^= 3; // credit the absent seat's lock
    if (this.contributions & bit) {
      this.rejectSpark();
      return false;
    }
    this.contributions |= bit;
    if (this.contributions !== 3) {
      this.sprite.setTexture(player === 'p1' ? TEX.escortP2Lock : TEX.escortP1Lock);
      this.pulseRemainingLock(player === 'p1' ? COLORS.p2 : COLORS.p1);
      return false;
    }
    // Destroyed: stop being a target/orbiter NOW so the gate fires immediately,
    // then a throwaway pop tween for juice.
    this.active = false;
    this.popping = true;
    this.downMs = 0;
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.onDestroyed();
    this.scene.tweens.add({
      targets: this.sprite,
      scale: 1.6,
      alpha: 0,
      duration: 160,
      onComplete: () => {
        if (!this.active) this.sprite.setVisible(false);
      },
    });
    return true;
  }

  private pulseRemainingLock(color: number): void {
    const g = this.scene.add.graphics({ x: this.sprite.x, y: this.sprite.y }).setDepth(3);
    g.fillStyle(color, 0.8);
    g.fillCircle(0, 0, this.radius * 0.72);
    this.scene.tweens.add({
      targets: g,
      scale: 1.25,
      alpha: 0,
      duration: 220,
      onComplete: () => g.destroy(),
    });
  }

  private rejectSpark(): void {
    const g = this.scene.add.graphics({ x: this.sprite.x, y: this.sprite.y }).setDepth(3);
    g.lineStyle(2, COLORS.chromeMuted, 0.75);
    g.lineBetween(-5, -5, 5, 5);
    g.lineBetween(-5, 5, 5, -5);
    this.scene.tweens.add({ targets: g, scale: 1.5, alpha: 0, duration: 100, onComplete: () => g.destroy() });
  }

  /** Off the field: invisible, body off (the encounter's end and its skips). */
  park(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.active = false;
    this.popping = false;
    this.sprite.setVisible(false);
    this.sprite.setRotation(0);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
  }
}
