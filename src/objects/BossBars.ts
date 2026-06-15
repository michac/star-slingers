/**
 * BossBars (B5) — the boss fight's readout, moved OUT of the boss's space into
 * the empty band to its right. Two vertical gauges: HEALTH (green) and CHARGE
 * (magenta), each filling bottom-up and capped at both ends by an icon (a heart
 * for health, a bolt for charge) so either seat can tell them apart. The top
 * icon copy is rotated 180° to read right-side-up from the top seat — the same
 * trick the old mirrored HP numbers used.
 *
 * This is pure presentation: the BossEncounter owns the numbers and pushes them
 * here each frame via `update()`. Hidden until the boss has entered, and again
 * once the fight ends.
 */
import Phaser from 'phaser';
import { COLORS } from '../tokens';
import { BOSS_LAYOUT, DEPTHS } from '../layout';
import { TEX } from './textures';

const BARS = BOSS_LAYOUT.bars;

export interface BossBarsState {
  hp: number;
  maxHp: number;
  chargeFrac: number; // 0..1
  visible: boolean;
}

export class BossBars {
  private readonly g: Phaser.GameObjects.Graphics;
  /** Heart ×2 + bolt ×2 end caps; placed once, only toggled after that. */
  private readonly icons: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTHS.banner);

    const cap = (tex: string, x: number, top: boolean, tint: number) =>
      scene.add
        .image(x, top ? BARS.top - BARS.labelPad : BARS.bottom + BARS.labelPad, tex)
        .setAngle(top ? 180 : 0) // top copy reads right-side-up from the top seat
        .setTint(tint)
        .setDepth(DEPTHS.banner)
        .setVisible(false);
    this.icons = [
      cap(TEX.heart, BARS.health.x, true, COLORS.health),
      cap(TEX.heart, BARS.health.x, false, COLORS.health),
      cap(TEX.bolt, BARS.charge.x, true, COLORS.danger),
      cap(TEX.bolt, BARS.charge.x, false, COLORS.danger),
    ];
  }

  update({ hp, maxHp, chargeFrac, visible }: BossBarsState): void {
    this.g.clear();
    for (const i of this.icons) i.setVisible(visible);
    if (!visible) return;
    const hpFrac = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    this.drawBar(BARS.health.x, hpFrac, COLORS.health);
    this.drawBar(BARS.charge.x, Phaser.Math.Clamp(chargeFrac, 0, 1), COLORS.danger);
  }

  /** Dim full-height track + a bottom-anchored fill grown to `frac`. */
  private drawBar(cx: number, frac: number, color: number): void {
    const g = this.g;
    const w = BARS.width;
    const h = BARS.bottom - BARS.top;
    const x = cx - w / 2;
    // Track.
    g.fillStyle(COLORS.lineDim, 0.25);
    g.fillRoundedRect(x, BARS.top, w, h, w / 2);
    g.lineStyle(2, COLORS.lineDim, 0.8);
    g.strokeRoundedRect(x, BARS.top, w, h, w / 2);
    // Fill (bottom-up).
    if (frac <= 0) return;
    const fh = frac * h;
    g.fillStyle(color, 0.95);
    g.fillRoundedRect(x, BARS.bottom - fh, w, fh, Math.min(w / 2, fh / 2));
  }
}
