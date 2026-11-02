/**
 * SeatControl — the shape every per-seat control scheme shares (today's
 * SlingControl, the controls-v2 TwoThumbControl), so the scene's input fan-out
 * and update loop stay mode-agnostic. The scene forwards EVERY pointer event to
 * EVERY seat; each seat claims pointers by id on down (hit-testing its own
 * regions) and ignores ids it didn't claim.
 */
import type Phaser from 'phaser';

export interface SeatControl {
  handleDown(pointer: Phaser.Input.Pointer): void;
  handleMove(pointer: Phaser.Input.Pointer): void;
  /** Wired to BOTH pointerup and pointerupoutside. */
  handleUp(pointer: Phaser.Input.Pointer): void;
  /** Per-frame, on game time (so the e2e stepper drives it). */
  update(deltaMs: number): void;
}
