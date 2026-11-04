/**
 * Starfield (#19) — the backdrop streaming right to left behind everything:
 * three parallax layers (STARFIELD in layout.ts), each ONE TileSprite over a
 * seeded star tile (TEX.starLayer), so a frame costs three quads and no
 * per-star objects or postFX. Scrolled from update(delta), not a tween, so it
 * moves under the e2e suite's stepped clock too. Both scenes build one and
 * call update(); create it first so it sits under everything. The scroll
 * offsets live in the game registry, so the stars carry on where they were
 * when the join screen hands over to the game or a run restarts.
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, STARFIELD } from '../layout';
import { TEX } from './textures';

/** Registry key for the layers' scroll offsets, shared by every scene's Starfield. */
const OFFSETS_KEY = 'starfieldOffsets';

export class Starfield {
  private readonly layers: Phaser.GameObjects.TileSprite[];
  /** The registry's offsets array, written in place each frame (no per-frame
   *  registry events). */
  private readonly saved: number[];
  private speedScale: number = STARFIELD.speedScale;

  constructor(scene: Phaser.Scene) {
    let saved = scene.registry.get(OFFSETS_KEY) as number[] | undefined;
    if (!saved) {
      saved = STARFIELD.layers.map(() => 0);
      scene.registry.set(OFFSETS_KEY, saved);
    }
    this.saved = saved;
    this.layers = STARFIELD.layers.map((_layer, i) => {
      const layer = scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, TEX.starLayer(i)).setOrigin(0, 0);
      layer.tilePositionX = saved[i];
      return layer;
    });
  }

  /** The speed dial (the act transition's rush, #29): 1 is the steady
   *  cruise, 0 stops the stars, above 1 is a rush. */
  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  /** The current speed scale (1 = cruise). */
  get speedScaleNow(): number {
    return this.speedScale;
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
      this.saved[i] = layer.tilePositionX;
    });
  }
}
