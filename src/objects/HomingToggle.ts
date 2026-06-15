/**
 * HomingToggle (B14) — one player's visible on/off switch for homing mode,
 * sitting next to their sling. A pill + sliding knob in the player's color;
 * ON = knob slid across + bright, OFF = knob back + dim. No text (kid
 * no-reading rule) — it reads by color, knob position, and brightness.
 *
 * State persists in the scene registry (game-global), so it survives
 * scene.restart() — a "Try again" never silently turns homing back off on the
 * 5yo. P1 sits at the top edge, so its whole switch is rotated 180° to read
 * right-side-up from that seat (its "right" is screen-left; see layout.HOMING).
 */
import Phaser from 'phaser';
import { HOMING } from '../layout';

export interface HomingToggleConfig {
  /** The player's sling anchor; the toggle sits to the player's right of it. */
  anchor: { x: number; y: number };
  color: number;
  edge: 'top' | 'bottom';
  /** Registry key persisting this seat's state across scene.restart(). */
  registryKey: string;
}

export class HomingToggle {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private on: boolean;

  constructor(private readonly scene: Phaser.Scene, private readonly config: HomingToggleConfig) {
    this.on = scene.registry.get(config.registryKey) === true;

    const { offsetX, width, height, hitPad } = HOMING.toggle;
    // "Player's right": screen +x for the bottom seat, screen -x for the top
    // seat (whose view is flipped). The 180° container rotation handles the
    // knob/pill orientation; the center offset must be mirrored to match.
    const dir = config.edge === 'top' ? -1 : 1;
    const cx = config.anchor.x + dir * offsetX;
    const cy = config.anchor.y;

    this.gfx = scene.add.graphics();
    const container = scene.add.container(cx, cy, [this.gfx]);
    container.setAngle(config.edge === 'top' ? 180 : 0);

    // Interactive hit zone, generously padded for small fingers. Lives in the
    // same rotated container, so local coords match the drawn pill.
    const zone = scene.add
      .zone(0, 0, width + hitPad * 2, height + hitPad * 2)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    container.add(zone);
    zone.on('pointerdown', () => this.flip());

    this.draw();
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Force a state (DEV/test hook; players use the tap-to-flip zone). */
  set(on: boolean): void {
    if (on === this.on) return;
    this.flip();
  }

  private flip(): void {
    this.on = !this.on;
    this.scene.registry.set(this.config.registryKey, this.on);
    this.draw();
  }

  /** Pill track + knob, in local (container) space centered on (0,0). */
  private draw(): void {
    const { color } = this.config;
    const { width, height, knobR } = HOMING.toggle;
    const g = this.gfx;
    g.clear();

    const r = height / 2;
    const halfW = width / 2;
    // Track: bright fill when ON, dim when OFF (alpha carries the brightness).
    g.fillStyle(color, this.on ? 0.5 : 0.16);
    g.fillRoundedRect(-halfW, -r, width, height, r);
    g.lineStyle(2, color, this.on ? 0.95 : 0.4);
    g.strokeRoundedRect(-halfW, -r, width, height, r);

    // Knob slides to the +x (ON) side or -x (OFF) side of the track.
    const travel = halfW - r;
    const knobX = this.on ? travel : -travel;
    g.fillStyle(color, this.on ? 1 : 0.55);
    g.fillCircle(knobX, 0, knobR);
  }
}
