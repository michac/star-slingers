/**
 * PlayerHud — one player's HUD column, anchored at the mock HUD GROUP
 * origin with rows at the mock's local offsets: WAVE (y=0), SCORE (y=20), and
 * AMMO (y=40). P1's container is rotated 180° so the whole column reads
 * right-side-up from the top edge.
 */
import Phaser from 'phaser';
import { CSS, FONTS } from '../tokens';
import { AMMO, AMMO_REGEN_MS, HUD_ROWS } from '../layout';

export interface PlayerHudConfig {
  x: number;
  y: number;
  angle: number; // 180 for P1, 0 for P2
  colorCss: string;
}

export class PlayerHud {
  private ammo: number = AMMO.max;
  private readonly ammoValue: Phaser.GameObjects.Text;
  private readonly waveValue: Phaser.GameObjects.Text;
  private readonly scoreValue: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, cfg: PlayerHudConfig) {
    const labelStyle = { fontFamily: FONTS.body, fontSize: '11px', color: CSS.chromeMuted };
    const row = (label: string, y: number, valueColor: string) => {
      const labelText = scene.add
        .text(AMMO.labelOffsetX, y, label, labelStyle)
        .setOrigin(0, 0.5);
      const valueText = scene.add
        .text(AMMO.valueOffsetX, y, '', {
          fontFamily: FONTS.display,
          fontSize: '16px',
          color: valueColor,
        })
        .setOrigin(0, 0.5);
      return [labelText, valueText] as const;
    };

    const [waveLabel, waveValue] = row('WAVE', HUD_ROWS.wave, CSS.ink);
    const [scoreLabel, scoreValue] = row('SCORE', HUD_ROWS.score, CSS.accent);
    const [ammoLabel, ammoValue] = row('AMMO', HUD_ROWS.ammo, cfg.colorCss);
    this.waveValue = waveValue;
    this.scoreValue = scoreValue;
    this.ammoValue = ammoValue;
    this.scoreValue.setText('0');
    this.ammoValue.setText(String(this.ammo));

    scene.add
      .container(cfg.x, cfg.y, [waveLabel, waveValue, scoreLabel, scoreValue, ammoLabel, ammoValue])
      .setAngle(cfg.angle);

    scene.time.addEvent({
      delay: AMMO_REGEN_MS,
      loop: true,
      callback: () => {
        if (this.ammo < AMMO.max) {
          this.ammo += 1;
          this.refresh();
        }
      },
    });
  }

  setWave(n: number): void {
    this.waveValue.setText(String(n));
  }

  setScore(n: number): void {
    this.scoreValue.setText(String(n));
  }

  canFire(): boolean {
    return this.ammo > 0;
  }

  spend(): void {
    if (this.ammo === 0) return;
    this.ammo -= 1;
    this.refresh();
  }

  private refresh(): void {
    this.ammoValue.setText(String(this.ammo));
  }
}
