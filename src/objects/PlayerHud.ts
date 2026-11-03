/**
 * PlayerHud — one player's HUD column, anchored at the mock HUD GROUP
 * origin with rows at the mock's local offsets: WAVE (y=0), SCORE (y=20),
 * AMMO (y=40) and the SPECIAL ammo row (y=60, #22), whose label is the seat's
 * current special's icon rather than text. P1's container is rotated 180° so
 * the whole column reads right-side-up from the top edge.
 *
 * It owns the seat's two ammo pools: FIRE's (AMMO.max, one back per
 * AMMO_REGEN_MS) and SPECIAL's (SPECIAL.max, one back per SPECIAL.regenMs),
 * each on its own regen clock. A pool's clock restarts when it drops from
 * full, so a full pool's first shot always takes a whole interval to come
 * back (no free refill from a clock that was already mid-tick). An unlimited seat (`setUnlimitedAmmo`, the Easy
 * seat's switch for #20) keeps both pools full: spending never drops them.
 */
import Phaser from 'phaser';
import { CSS, FONTS } from '../tokens';
import { AMMO, AMMO_REGEN_MS, HUD_ROWS, SPECIAL } from '../layout';
import { DEFAULT_SPECIAL, SPECIALS, type SpecialKind } from './specials';
import type { Button } from './TwoThumbControl';

export interface PlayerHudConfig {
  x: number;
  y: number;
  angle: number; // 180 for P1, 0 for P2
  colorCss: string;
  /** The seat colour as a number, for the code-drawn special icon. */
  color: number;
}

/** Each pool's size and regen interval, keyed by the button that spends it. */
const POOLS: Record<Button, { max: number; regenMs: number }> = {
  fire: { max: AMMO.max, regenMs: AMMO_REGEN_MS },
  special: { max: SPECIAL.max, regenMs: SPECIAL.regenMs },
};
const BUTTONS = Object.keys(POOLS) as Button[];

export class PlayerHud {
  private readonly counts: Record<Button, number> = { fire: POOLS.fire.max, special: POOLS.special.max };
  private readonly values: Record<Button, Phaser.GameObjects.Text>;
  private readonly waveValue: Phaser.GameObjects.Text;
  private readonly scoreValue: Phaser.GameObjects.Text;
  /** The special row's label: the current special's icon. */
  private readonly specialIcon: Phaser.GameObjects.Graphics;
  private currentSpecial: SpecialKind = DEFAULT_SPECIAL;
  private unlimited = false;
  /** Each pool's looping regen timer (restarted by spend() from full). */
  private readonly regen = {} as Record<Button, Phaser.Time.TimerEvent>;

  constructor(scene: Phaser.Scene, private readonly cfg: PlayerHudConfig) {
    const labelStyle = { fontFamily: FONTS.body, fontSize: '11px', color: CSS.chromeMuted };
    const value = (y: number, valueColor: string) =>
      scene.add
        .text(AMMO.valueOffsetX, y, '', {
          fontFamily: FONTS.display,
          fontSize: '16px',
          color: valueColor,
        })
        .setOrigin(0, 0.5);
    const row = (label: string, y: number, valueColor: string) => {
      const labelText = scene.add.text(AMMO.labelOffsetX, y, label, labelStyle).setOrigin(0, 0.5);
      return [labelText, value(y, valueColor)] as const;
    };

    const [waveLabel, waveValue] = row('WAVE', HUD_ROWS.wave, CSS.ink);
    const [scoreLabel, scoreValue] = row('SCORE', HUD_ROWS.score, CSS.accent);
    const [ammoLabel, ammoValue] = row('AMMO', HUD_ROWS.ammo, cfg.colorCss);
    const specialValue = value(HUD_ROWS.special, cfg.colorCss);
    this.specialIcon = scene.add.graphics();
    this.waveValue = waveValue;
    this.scoreValue = scoreValue;
    this.values = { fire: ammoValue, special: specialValue };
    this.scoreValue.setText('0');
    this.refresh();
    this.setSpecial(this.currentSpecial);

    scene.add
      .container(cfg.x, cfg.y, [
        waveLabel,
        waveValue,
        scoreLabel,
        scoreValue,
        ammoLabel,
        ammoValue,
        this.specialIcon,
        specialValue,
      ])
      .setAngle(cfg.angle);

    for (const pool of BUTTONS) {
      this.regen[pool] = scene.time.addEvent({
        delay: POOLS[pool].regenMs,
        loop: true,
        callback: () => {
          if (this.counts[pool] < POOLS[pool].max) {
            this.counts[pool] += 1;
            this.refresh();
          }
        },
      });
    }
  }

  setWave(n: number): void {
    this.waveValue.setText(String(n));
  }

  setScore(n: number): void {
    this.scoreValue.setText(String(n));
  }

  /** Does this button's pool have a shot left? */
  canFire(pool: Button): boolean {
    return this.counts[pool] > 0;
  }

  spend(pool: Button): void {
    if (this.unlimited || this.counts[pool] === 0) return;
    if (this.counts[pool] === POOLS[pool].max) this.regen[pool].elapsed = 0; // the interval starts now
    this.counts[pool] -= 1;
    this.refresh();
  }

  /** The per-seat unlimited-ammo switch (#20's Easy seat): on refills both
   *  pools and keeps them full. */
  setUnlimitedAmmo(on: boolean): void {
    this.unlimited = on;
    if (on) {
      for (const pool of BUTTONS) this.counts[pool] = POOLS[pool].max;
      this.refresh();
    }
  }

  /** Change the special shown on the special row: redraws its icon label. */
  setSpecial(kind: SpecialKind): void {
    this.currentSpecial = kind;
    this.specialIcon.clear();
    SPECIALS[kind].drawIcon(this.specialIcon, HUD_ROWS.specialIconX, HUD_ROWS.special, HUD_ROWS.specialIconR, this.cfg.color);
  }

  // ---- read-outs (DEV hooks / tests) ----

  get ammoCount(): number {
    return this.counts.fire;
  }

  get specialCount(): number {
    return this.counts.special;
  }

  get special(): SpecialKind {
    return this.currentSpecial;
  }

  private refresh(): void {
    this.values.fire.setText(String(this.counts.fire));
    this.values.special.setText(String(this.counts.special));
  }
}
