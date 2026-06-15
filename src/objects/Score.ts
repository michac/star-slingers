/**
 * ScoreKeeper (B6) — the shared, live-only score. Holds one running total,
 * mirrored onto both PlayerHuds' SCORE rows, and throws a floating "+N" at each
 * kill site. The popup grows-and-fades IN PLACE (no directional rise) on
 * purpose: a rising number would read upside-down for the top seat, while
 * grow-and-fade reads the same from both ends. The HUD number is the canonical
 * read; the popup is just the kill-feel.
 *
 * No persistence: scene.restart() rebuilds this from scratch, so the score
 * naturally resets to 0 on a fresh run.
 */
import Phaser from 'phaser';
import { CSS, FONTS } from '../tokens';
import { DEPTHS, SCORE } from '../layout';

export class ScoreKeeper {
  private _value = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly huds: { setScore: (n: number) => void }[]
  ) {}

  get value(): number {
    return this._value;
  }

  /** Add points (from a pop) and spawn the floating "+N" at the kill site. */
  add(points: number, x: number, y: number): void {
    this._value += points;
    for (const hud of this.huds) hud.setScore(this._value);
    this.popup(points, x, y);
  }

  private popup(points: number, x: number, y: number): void {
    const text = this.scene.add
      .text(x, y, `+${points}`, {
        fontFamily: FONTS.display,
        fontSize: `${SCORE.popup.fontPx}px`,
        color: CSS.accent,
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.banner);
    this.scene.tweens.add({
      targets: text,
      scale: SCORE.popup.riseScale,
      alpha: 0,
      duration: SCORE.popup.durationMs,
      ease: 'Quad.Out',
      onComplete: () => text.destroy(),
    });
  }
}
