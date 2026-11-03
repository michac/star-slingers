/**
 * Starfield (#19) — the backdrop streaming right to left behind everything:
 * three parallax layers (STARFIELD in layout.ts), each ONE TileSprite over a
 * seeded star tile (TEX.starLayer), so a frame costs three quads and no
 * per-star objects or postFX. Scrolled from update(delta), not a tween, so it
 * moves under the e2e suite's stepped clock too. Both scenes build one and
 * call update(); create it first so it sits under everything.
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, STARFIELD } from '../layout';
import { TEX } from './textures';

export class Starfield {
  private readonly layers: Phaser.GameObjects.TileSprite[];
  private speedScale: number = STARFIELD.speedScale;

  constructor(scene: Phaser.Scene) {
    this.layers = STARFIELD.layers.map((_layer, i) =>
      scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, TEX.starLayer(i)).setOrigin(0, 0)
    );
  }

  /** The speed dial for later work (#29's act transitions): 1 is the steady
   *  cruise, 0 stops the stars, above 1 is a rush. */
  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  /** Each layer's scroll offset in px (the e2e suite reads it). */
  get offsets(): number[] {
    return this.layers.map((layer) => layer.tilePositionX);
  }

  update(deltaMs: number): void {
    const seconds = (deltaMs / 1000) * this.speedScale;
    this.layers.forEach((layer, i) => {
      // Advancing the texture offset moves the stars LEFT on screen. Kept
      // within one tile width so the float never grows without bound.
      layer.tilePositionX = (layer.tilePositionX + STARFIELD.layers[i].speed * seconds) % STARFIELD.tile.width;
    });
  }
}
