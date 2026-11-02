/**
 * WaveBanner — the between-waves announcement: a small "WAVE" label + big
 * numeral, shown once per live seat (P1's copy rotated 180°; solo shows only
 * P2's) at field center.
 * Numeral-forward by design: number recognition is fine, reading isn't.
 */
import Phaser from 'phaser';
import { CSS, FONTS } from '../tokens';
import { BANNER, DEPTHS } from '../layout';

export class WaveBanner {
  private readonly container: Phaser.GameObjects.Container;
  private readonly numerals: Phaser.GameObjects.Text[];

  constructor(scene: Phaser.Scene, players: 1 | 2) {
    const seat = (sign: 1 | -1, angle: 0 | 180) => {
      const group = scene.add.container(
        BANNER.center.x,
        BANNER.center.y + sign * BANNER.numeralOffsetY
      );
      const label = scene.add
        .text(0, -30, 'WAVE', { fontFamily: FONTS.body, fontSize: '12px', color: CSS.chromeMuted })
        .setOrigin(0.5);
      const numeral = scene.add
        .text(0, 4, '', { fontFamily: FONTS.display, fontSize: '40px', color: CSS.ink })
        .setOrigin(0.5);
      group.add([label, numeral]).setAngle(angle);
      return { group, numeral };
    };

    const p2 = seat(1, 0); // bottom seat, below center
    const p1 = players === 2 ? seat(-1, 180) : null; // top seat, above center, flipped
    const copies = p1 ? [p1, p2] : [p2];
    this.numerals = copies.map((c) => c.numeral);
    this.container = scene.add
      .container(0, 0, copies.map((c) => c.group))
      .setDepth(DEPTHS.banner)
      .setVisible(false)
      .setAlpha(0);
  }

  show(waveNumber: number): void {
    for (const n of this.numerals) n.setText(String(waveNumber));
    this.container.setVisible(true);
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: BANNER.fadeMs,
    });
  }

  hide(): void {
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: BANNER.fadeMs,
      onComplete: () => this.container.setVisible(false),
    });
  }
}
