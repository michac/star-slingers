/**
 * Fleet (#19) — what both players defend: four colony ships at the left edge,
 * one per sublane of the enemy lane, nose right. Each ship has ONE shield
 * bubble:
 *
 *   shielded → (hit) exposed → (hit) lost
 *        ↑______ regrows after shieldRegenMs without a hit
 *
 * A lost ship stays lost for the rest of the wave (its sublane's rocks then fly
 * past harmlessly — the scene's contact check skips it). Between waves
 * restoreAll() rebuilds every lost ship and returns every shield. All four lost
 * is the fleet lost: the scene shows "Try again?".
 *
 * The bubbles carry the locked shield look (SHIELD_FX): a colour-brightness
 * pulse that flows down the fleet, one shared ambient glow, a flare-then-fade
 * pop and a settle-in regrow. State changes are immediate; restoreAll's
 * staggered reveal is counted on update()'s delta, so the logic stays in
 * lockstep with the e2e suite's stepped clock (only the cue tweens are
 * wall-clock).
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { DEPTHS, FLEET, LANE, REGROW, SHAKE, SHIELD_FX, sublaneCenterY } from '../layout';
import { BREATHER } from '../waves';
import { FLEET_TEX, TEX } from './textures';
import { sfx } from '../sfx';

export type ShipState = 'shielded' | 'exposed' | 'lost';
/** What an enemy reaching a ship did: popped its shield, lost the ship, or
 *  lost the ship and with it the whole fleet. */
export type FleetHit = 'shieldPopped' | 'shipLost' | 'fleetLost';

interface Ship {
  readonly cy: number;
  state: ShipState;
  /** ms since this ship was last hit — drives its own shield regen. */
  msSinceHit: number;
  /** restoreAll's staggered reveal: the fleet clock (ms) when this ship's
   *  restored hull/bubble appears, or null when nothing is pending. */
  revealAtMs: number | null;
  /** The bubble's outline points in world space, built once: the per-frame
   *  stroke/fill reuse them instead of re-tessellating an ellipse each frame. */
  readonly bubble: Phaser.Geom.Point[];
  readonly image: Phaser.GameObjects.Image;
  readonly lostImage: Phaser.GameObjects.Image;
}

/** 0→1 brightness for ship `i` at time `elapsed`. The per-ship phase offset is
 *  the "flow": the crest sweeps down the fleet. (Locked: shield-pulse.ts) */
function brightness(elapsed: number, i: number): number {
  const flow = i * Math.PI * 0.5;
  return (Math.sin((elapsed / SHIELD_FX.periodMs) * Math.PI * 2 - flow) + 1) / 2;
}

/** Scale a packed 0xRRGGBB color's brightness by f (0..1), kept fully opaque.
 *  The pulse darkens the colour rather than lowering alpha: a thick
 *  semi-transparent stroke overlaps itself at its tessellation joins, and the
 *  doubled alpha there reads as faint radial "grid" spokes. */
function dim(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

const BUBBLE_W = FLEET.shield.rx * 2;
const BUBBLE_H = FLEET.shield.ry * 2;
/** Points per bubble outline: Graphics.strokeEllipse's default smoothness. */
const BUBBLE_POINTS = 32;

export class Fleet {
  private readonly ships: Ship[];
  /** Shield bubbles, cleared + redrawn every frame (pulse + flow). */
  private readonly bubbles: Phaser.GameObjects.Graphics;
  /** Bloom shapes behind the ships, carrying the one shared glow FX. */
  private readonly glowDisc: Phaser.GameObjects.Graphics;
  private readonly ambientGlow?: Phaser.FX.Glow;
  /** Which ships' bubbles glowDisc holds (bit i = ship i), so it's refilled
   *  only when that set changes; -1 forces the first fill. */
  private glowMask = -1;
  /** The fleet clock: drives the pulse and restoreAll's staggered reveal. */
  private elapsed = 0;
  /** Per-wave knob; the WaveDirector (or the boss) sets it at each wave start. */
  private shieldRegenMs = 0;
  /** How far the whole fleet is shifted right of its slots (the act
   *  transition's flyby, #29); 0 in play. */
  private offset = 0;
  /** Fleet clock time when the last restored ship's regrow cue ends; its
   *  bubble copy is drawn where the ship was, so the flyby waits for it. */
  private settledAtMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** The shared burst (B29), fired where a ship is lost. */
    private readonly boom: (x: number, y: number, radius: number) => void
  ) {
    // The glow goes under everything, starfield included (DEPTHS.fleetGlow);
    // then construction order: ships → bubbles. postFX is guarded so headless
    // software WebGL can't crash; the glow is just absent.
    this.glowDisc = scene.add.graphics().setDepth(DEPTHS.fleetGlow);
    this.ambientGlow = this.glowDisc.postFX?.addGlow(COLORS.shieldOuter, 2, 0, false, SHIELD_FX.glowQuality, 22);
    const origin = [FLEET_TEX.ox / FLEET_TEX.width, FLEET_TEX.oy / FLEET_TEX.height] as const;
    this.ships = Array.from({ length: LANE.sublanes }, (_, i) => {
      const cy = sublaneCenterY(i);
      return {
        cy,
        state: 'shielded' as ShipState,
        msSinceHit: 0,
        revealAtMs: null,
        bubble: new Phaser.Geom.Ellipse(FLEET.shield.cx, cy, BUBBLE_W, BUBBLE_H).getPoints(BUBBLE_POINTS),
        image: scene.add.image(0, cy, TEX.fleetShip).setOrigin(...origin),
        lostImage: scene.add.image(0, cy, TEX.fleetShipLost).setOrigin(...origin).setVisible(false),
      };
    });
    this.bubbles = scene.add.graphics();
  }

  /** Every ship's state, top to bottom (the e2e suite reads it). */
  states(): ShipState[] {
    return this.ships.map((ship) => ship.state);
  }

  /** True while restoreAll's staggered reveal still has ships to show, or
   *  the last one's regrow cue is still settling in. */
  get restoring(): boolean {
    return this.elapsed < this.settledAtMs || this.ships.some((ship) => ship.revealAtMs !== null);
  }

  /** The fleet's current shift right of its slots (px). */
  get offsetX(): number {
    return this.offset;
  }

  /** Shift the whole fleet dx px right of its slots (#29's flyby; negative
   *  is left): hulls, wrecks, bubbles and their glow move together. The
   *  bubble outlines are world points drawn at Graphics x 0, so moving the
   *  Graphics moves them. Gameplay geometry (contactX, shipPoint) stays at the
   *  slots: the flyby only runs between waves, with the field empty. */
  setOffsetX(dx: number): void {
    this.offset = dx;
    for (const ship of this.ships) {
      ship.image.setX(dx);
      ship.lostImage.setX(dx);
    }
    this.bubbles.setX(dx);
    this.glowDisc.setX(dx);
  }

  isLive(i: number): boolean {
    return this.ships[i]?.state !== 'lost';
  }

  /** The top-most live ship's index (the boss beam's target, #27), or -1 if
   *  the whole fleet is lost. */
  topMostLive(): number {
    return this.ships.findIndex((ship) => ship.state !== 'lost');
  }

  /** The x an enemy in ship i's sublane stops at: the bubble's front while
   *  the shield is up, else the hull's nose. */
  contactX(i: number): number {
    return this.ships[i].state === 'shielded' ? FLEET.bubbleFrontX : FLEET.noseX;
  }

  /** The middle of ship i (the boss beam's end point). */
  shipPoint(i: number): { x: number; y: number } {
    return { x: FLEET.shield.cx, y: this.ships[i].cy };
  }

  /** An enemy reached ship i: pops its shield, or loses the ship if the shield
   *  was already down. Hitting a ship that's already lost changes nothing. */
  onEnemyReached(i: number): FleetHit {
    const ship = this.ships[i];
    // A restored ship hit before its staggered turn shows itself first, so the
    // pop below lands on a bubble that's drawn.
    if (ship.revealAtMs !== null) this.reveal(ship);
    if (ship.state === 'shielded') {
      ship.state = 'exposed';
      ship.msSinceHit = 0; // a hit restarts this ship's regen clock
      this.popBubble(ship);
      this.worriedShake(ship);
      sfx.play('shieldPop');
      return 'shieldPopped';
    }
    if (ship.state === 'exposed') {
      ship.state = 'lost';
      ship.revealAtMs = null;
      this.scene.tweens.killTweensOf(ship.image); // may stop a shake mid-way:
      ship.image.setY(ship.cy).setVisible(false); // put the hull back for its rebuild
      ship.lostImage.setVisible(true);
      this.boom(FLEET.shield.cx, ship.cy, FLEET.lostBoomR);
      sfx.play('shipLost');
    }
    return this.ships.every((s) => s.state === 'lost') ? 'fleetLost' : 'shipLost';
  }

  /** Lose every ship at once (the giant asteroid reached the fleet, #25):
   *  each live ship takes hits until it's lost, with its usual pop and boom. */
  loseAll(): void {
    this.ships.forEach((_, i) => {
      while (this.isLive(i)) this.onEnemyReached(i);
    });
  }

  setShieldRegenMs(ms: number): void {
    this.shieldRegenMs = ms;
  }

  /** Per-frame: redraw the pulsing bubbles + glow, reveal any restored ship
   *  whose turn has come, and regrow each exposed ship's shield after a quiet
   *  stretch of shieldRegenMs — the difficulty budget's "leak allowance".
   *  Pauses behind the end cards for free: the scene stops calling update(). */
  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    for (const ship of this.ships) {
      if (ship.revealAtMs !== null && this.elapsed >= ship.revealAtMs) {
        this.reveal(ship);
        sfx.play('shieldRebuild'); // here, not in reveal(): a hit's early reveal is the pop's sound
      }
    }
    this.drawBubbles();
    this.drawAmbientGlow();

    if (this.shieldRegenMs <= 0) return;
    for (const ship of this.ships) {
      if (ship.state !== 'exposed') continue;
      ship.msSinceHit += deltaMs;
      if (ship.msSinceHit < this.shieldRegenMs) continue;
      ship.state = 'shielded';
      ship.msSinceHit = 0;
      this.regrowBubble(ship);
      sfx.play('shieldRebuild');
    }
  }

  /** Between waves: every lost ship is rebuilt and every shield returns. The
   *  state changes now; the ships reappear one by one, top to bottom, each
   *  BREATHER.shipRestoreStaggerMs after the last. */
  restoreAll(): void {
    let k = 0;
    for (const ship of this.ships) {
      ship.msSinceHit = 0;
      if (ship.state === 'shielded') continue;
      ship.state = 'shielded';
      ship.revealAtMs = this.elapsed + k * BREATHER.shipRestoreStaggerMs;
      k += 1;
    }
  }

  /** A restored ship's turn: a rebuilt hull fades in over its outline, and
   *  the bubble settles back in. */
  private reveal(ship: Ship): void {
    ship.revealAtMs = null;
    this.settledAtMs = Math.max(this.settledAtMs, this.elapsed + REGROW.durationMs);
    if (!ship.image.visible) {
      ship.lostImage.setVisible(false);
      ship.image.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: ship.image, alpha: 1, duration: REGROW.durationMs });
    }
    this.regrowBubble(ship);
  }

  /** A ship's bubble shows once it's shielded and any staggered reveal has run. */
  private showsBubble(ship: Ship): boolean {
    return ship.state === 'shielded' && ship.revealAtMs === null;
  }

  /** Shielded ships' bubbles, flow-pulsed by COLOR brightness (opaque). */
  private drawBubbles(): void {
    const g = this.bubbles;
    g.clear();
    this.ships.forEach((ship, i) => {
      if (!this.showsBubble(ship)) return;
      const f = SHIELD_FX.pulseLo + brightness(this.elapsed, i) * (1 - SHIELD_FX.pulseLo);
      g.lineStyle(STROKES.bubble.width, dim(COLORS.shieldOuter, f), 1);
      g.strokePoints(ship.bubble, true);
    });
  }

  /** One ambient bloom under every live bubble, breathing on the top bubble's
   *  pulse. Hidden when no shield is up (or postFX is unavailable headless).
   *  The bloom shapes are refilled only when the set of shown bubbles changes;
   *  the breathing is just the glow's strength. */
  private drawAmbientGlow(): void {
    const g = this.glowDisc;
    if (!this.ambientGlow) {
      g.setVisible(false);
      return;
    }
    const mask = this.ships.reduce((m, ship, i) => (this.showsBubble(ship) ? m | (1 << i) : m), 0);
    if (mask === 0) {
      g.setVisible(false);
      return;
    }
    if (mask !== this.glowMask) {
      this.glowMask = mask;
      g.clear().fillStyle(COLORS.sceneBg, 1);
      for (const ship of this.ships) if (this.showsBubble(ship)) g.fillPoints(ship.bubble, true);
    }
    const lit = this.ships.findIndex((ship) => this.showsBubble(ship)); // the top-most shown bubble
    this.ambientGlow.outerStrength = 1.5 + brightness(this.elapsed, lit) * 3;
    g.setVisible(true);
  }

  /** A throwaway copy of the bubble drawn at local (0,0), so a scale tween
   *  grows it around the ship. */
  private bubbleCopy(ship: Ship, alpha: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics({ x: FLEET.shield.cx + this.offset, y: ship.cy });
    g.lineStyle(STROKES.bubble.width, COLORS.shieldOuter, alpha);
    g.strokeEllipse(0, 0, BUBBLE_W, BUBBLE_H);
    return g;
  }

  /** The popped bubble's locked cue: a copy flares its glow bright (yoyo), then
   *  expands + fades away. postFX guarded for headless. */
  private popBubble(ship: Ship): void {
    const g = this.bubbleCopy(ship, 1);
    const fx = g.postFX?.addGlow(COLORS.shieldOuter, 0, 0, false, SHIELD_FX.glowQuality, 26);
    if (fx) {
      this.scene.tweens.add({
        targets: fx,
        outerStrength: SHIELD_FX.flare.strength,
        duration: SHIELD_FX.flare.flareMs,
        yoyo: true,
        ease: 'Quad.Out',
      });
    }
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: SHIELD_FX.flare.scaleTo,
      duration: SHIELD_FX.flare.fadeMs,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  /** Reverse of popBubble: a copy settles in (scale REGROW.scaleFrom → 1,
   *  alpha 0 → full) over the bubble that's drawn again from now on. */
  private regrowBubble(ship: Ship): void {
    const g = this.bubbleCopy(ship, STROKES.bubble.alpha);
    g.setScale(REGROW.scaleFrom).setAlpha(0);
    this.scene.tweens.add({
      targets: g,
      scale: 1,
      alpha: 1,
      duration: REGROW.durationMs,
      onComplete: () => g.destroy(),
    });
  }

  /** Brief vertical tremble of the hit ship — local, not camera shake, so the
   *  players' controls and HUDs stay still. */
  private worriedShake(ship: Ship): void {
    this.scene.tweens.killTweensOf(ship.image); // a re-hit mid-shake restarts it
    ship.image.setY(ship.cy).setAlpha(1);
    this.scene.tweens.add({
      targets: ship.image,
      y: ship.cy + SHAKE.amplitude,
      duration: SHAKE.durationMs,
      yoyo: true,
      repeat: SHAKE.repeats,
      onComplete: () => ship.image.setY(ship.cy),
    });
  }
}
