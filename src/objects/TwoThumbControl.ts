/**
 * TwoThumbControl — one seat's controls v2 (#7): one thumb aims on the aim pad,
 * the other holds a fire button. Replaces pull-and-release slinging.
 *
 *  - FIRE: press starts the draw (the nocked rocket pulls back along the aim
 *    and a charge ring fills round the button); release fires at the fixed
 *    SLING.maxSpeed. Held ≥ CHARGE.fullMs, release fires the railgun.
 *  - HOME: while held, rings the rock the shot would lock; release fires a
 *    homing shot. Never charges.
 *  - One button at a time: while either is held, a press on the other is ignored.
 *  - Haptics (#3): FIRE ticks once the moment it's fully charged with ammo to
 *    fire (HAPTICS dials, src/haptics.ts). The per-shot buzz is the scene's,
 *    in fireRocket.
 *  - Aim pad, `arc` mode: thumb direction from the pad centre sets the aim
 *    (outside a small deadzone). `drag` mode: sideways motion anywhere in the aim
 *    zone turns the aim. Both clamp to CONTROLS_V2.aim; aim persists.
 *
 * Everything the seat draws (buttons, pad, launcher, trajectory) lives in ONE
 * container in the bottom seat's frame (layout CONTROLS_V2's coordinates), which
 * the top seat rotates 180° about the field centre. Only the homing lock ring is
 * drawn in world space (it sits on a rock). Pointers are claimed by id exactly
 * like SlingControl: the scene fans every event out to every seat, and each
 * button / the pad claims at most one pointer on down by hit-testing its region.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { CHARGE, CONTROLS_V2, GAME_HEIGHT, GAME_WIDTH, HAPTICS, SLING } from '../layout';
import type { AimMode } from '../controlsVariant';
import { buzz } from '../haptics';
import { drawDashedArc, drawDashedLine, drawLockRing, drawSolidArc } from './draw';
import type { SeatControl } from './SeatControl';

type Point = { x: number; y: number };
type Button = 'fire' | 'home';

export interface ShotKind {
  /** Railgun (B13): FIRE held to a full charge. */
  charged: boolean;
  /** Homing (B14): fired from HOME (locks at fire, else flies straight). */
  homing: boolean;
}

export interface TwoThumbControlConfig {
  /** World launcher position (P1_ANCHOR / P2_ANCHOR). */
  anchor: Point;
  color: number;
  /** Which screen edge this player sits at; 'top' rotates the layout 180°. */
  edge: 'top' | 'bottom';
  aimMode: AimMode;
  /** Mirror the seat: pad on the player's left, buttons on their right. */
  lefty: boolean;
  rocketTexture: string;
  canFire: () => boolean;
  onFire: (x: number, y: number, vx: number, vy: number, kind: ShotKind) => void;
  /** The rock a shot along (origin, dir) would lock onto, or null. */
  homingTargetAt: (ox: number, oy: number, dirx: number, diry: number) => { x: number; y: number; r: number } | null;
}

const DEG = Math.PI / 180;

export class TwoThumbControl implements SeatControl {
  private readonly staticGfx: Phaser.GameObjects.Graphics;
  private readonly dynamicGfx: Phaser.GameObjects.Graphics;
  /** World-space: the homing lock ring on the targeted rock. */
  private readonly lockGfx: Phaser.GameObjects.Graphics;
  private readonly nockedRocket: Phaser.GameObjects.Image;

  // Seat-frame geometry (lefty already applied).
  private readonly launcher: Point;
  private readonly fire: { x: number; y: number; r: number };
  private readonly home: { x: number; y: number; r: number };
  private readonly pad: Point;

  /** Seat-frame aim, degrees (0 = player's right, 90 = across the field). */
  private aimDeg: number = CONTROLS_V2.aim.startDeg;
  private aimPointer: number | null = null;
  /** Drag mode: last seat-frame x of the aiming thumb. */
  private dragLastX = 0;
  private buttonPointer: number | null = null;
  private held: Button | null = null;
  /** FIRE charge, 0→1 over CHARGE.fullMs of held game time. */
  private charge = 0;
  /** This FIRE hold has already given its armed tick (#3). */
  private armedBuzzed = false;
  /** Free-running ms clock for the armed pulse. */
  private elapsed = 0;
  /** Set when the resting picture changed and needs one more redraw. */
  private dirty = true;

  constructor(scene: Phaser.Scene, private readonly config: TwoThumbControlConfig) {
    const { fire, home, pad } = CONTROLS_V2;
    const mirror = <T extends Point>(p: T): T => (config.lefty ? { ...p, x: GAME_WIDTH - p.x } : { ...p });
    this.fire = mirror(fire);
    this.home = mirror(home);
    this.pad = mirror(pad);
    this.launcher = this.toSeat(config.anchor);

    // Seat-frame container (identity for the bottom seat): the outer one pivots
    // on the field centre, the inner one shifts back so children use plain
    // seat-frame coordinates.
    const inner = scene.add.container(-GAME_WIDTH / 2, -GAME_HEIGHT / 2);
    scene.add
      .container(GAME_WIDTH / 2, GAME_HEIGHT / 2, [inner])
      .setAngle(config.edge === 'top' ? 180 : 0);
    this.staticGfx = scene.add.graphics();
    this.dynamicGfx = scene.add.graphics();
    this.nockedRocket = scene.add.image(this.launcher.x, this.launcher.y, config.rocketTexture);
    inner.add([this.staticGfx, this.dynamicGfx, this.nockedRocket]);
    this.lockGfx = scene.add.graphics();
    this.drawStatic();
  }

  // ---- read-outs (DEV hooks / tests) ----

  get aimDegrees(): number {
    return this.aimDeg;
  }

  /** World-space centres + radii of this seat's controls. */
  worldLayout(): { anchor: Point; fire: Point & { r: number }; home: Point & { r: number }; pad: Point & { r: number } } {
    return {
      anchor: { ...this.config.anchor },
      fire: { ...this.toSeat(this.fire), r: this.fire.r },
      home: { ...this.toSeat(this.home), r: this.home.r },
      pad: { ...this.toSeat(this.pad), r: CONTROLS_V2.pad.r },
    };
  }

  // ---- pointer routing (called by the scene for every pointer event) ----

  handleDown(pointer: Phaser.Input.Pointer): void {
    const p = this.toSeat(pointer);
    const button = this.buttonAt(p);
    if (button) {
      // One button at a time: a second press on either button is ignored.
      if (this.buttonPointer !== null) return;
      this.buttonPointer = pointer.id;
      this.held = button;
      this.charge = 0;
      this.armedBuzzed = false;
      this.dirty = true;
      return;
    }
    if (this.aimPointer !== null || !this.inAimRegion(p)) return;
    this.aimPointer = pointer.id;
    this.dragLastX = p.x;
    if (this.config.aimMode === 'arc') this.aimFromPad(p);
    this.dirty = true;
  }

  handleMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.aimPointer) return; // a held button ignores sliding
    const p = this.toSeat(pointer);
    if (this.config.aimMode === 'arc') {
      this.aimFromPad(p);
    } else {
      this.setAim(this.aimDeg - (p.x - this.dragLastX) * CONTROLS_V2.drag.gainDegPerPx);
      this.dragLastX = p.x;
    }
  }

  handleUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.aimPointer) {
      this.aimPointer = null;
      this.dirty = true;
    }
    if (pointer.id !== this.buttonPointer) return;
    const kind: ShotKind = { charged: this.held === 'fire' && this.charge >= 1, homing: this.held === 'home' };
    this.buttonPointer = null;
    this.held = null;
    this.charge = 0;
    this.dirty = true;
    this.lockGfx.clear();
    if (!this.config.canFire()) return;
    const dir = this.worldDir();
    const { anchor } = this.config;
    this.config.onFire(anchor.x, anchor.y, dir.x * SLING.maxSpeed, dir.y * SLING.maxSpeed, kind);
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (this.held === 'fire') this.charge = Math.min(1, this.charge + deltaMs / CHARGE.fullMs);
    const canFire = this.config.canFire();
    // Armed tick: once per hold, the first frame it's both fully charged AND
    // has ammo (no "ready" buzz for a release that would fire nothing).
    if (this.held === 'fire' && this.charge >= 1 && canFire && !this.armedBuzzed) {
      this.armedBuzzed = true;
      buzz(HAPTICS.armedMs);
    }
    // Out of ammo dims the nocked rocket (cheap; ammo regens on its own clock).
    this.nockedRocket.setAlpha(canFire ? 1 : 0.35);
    const active = this.held !== null || this.aimPointer !== null;
    if (!active && !this.dirty) return;
    this.dirty = false;
    this.drawDynamic();
    this.drawLock();
  }

  // ---- internals ----

  /** World ↔ seat frame (the same involution both ways). */
  private toSeat(p: Point): Point {
    return this.config.edge === 'top' ? { x: GAME_WIDTH - p.x, y: GAME_HEIGHT - p.y } : { x: p.x, y: p.y };
  }

  /** Launch direction in the seat frame (y down). */
  private seatDir(): Point {
    const a = this.aimDeg * DEG;
    return { x: Math.cos(a), y: -Math.sin(a) };
  }

  private worldDir(): Point {
    const d = this.seatDir();
    return this.config.edge === 'top' ? { x: -d.x, y: -d.y } : d;
  }

  private setAim(deg: number): void {
    this.aimDeg = Phaser.Math.Clamp(deg, CONTROLS_V2.aim.minDeg, CONTROLS_V2.aim.maxDeg);
  }

  /** Arc mode: absolute aim from the pad centre to the thumb. */
  private aimFromPad(p: Point): void {
    const dx = p.x - this.pad.x;
    const dy = this.pad.y - p.y; // seat-frame "up" is +
    if (Math.hypot(dx, dy) < CONTROLS_V2.pad.deadzone) return;
    let deg = Math.atan2(dy, dx) / DEG;
    // Below the pad's centre line: snap to the nearer clamp end, not across.
    if (deg < -90) deg += 360;
    this.setAim(deg);
  }

  /** Which button (if any) a seat-frame point presses; nearest wins an overlap. */
  private buttonAt(p: Point): Button | null {
    const pad = CONTROLS_V2.buttonHitPad;
    const score = (b: { x: number; y: number; r: number }) => {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      return d <= b.r + pad ? d / b.r : Infinity;
    };
    const f = score(this.fire);
    const h = score(this.home);
    if (f === Infinity && h === Infinity) return null;
    return f <= h ? 'fire' : 'home';
  }

  private inAimRegion(p: Point): boolean {
    if (this.config.aimMode === 'arc') {
      const { r, hitPad } = CONTROLS_V2.pad;
      return Math.hypot(p.x - this.pad.x, p.y - this.pad.y) <= r + hitPad;
    }
    const { minX, minY } = CONTROLS_V2.drag;
    if (p.y < minY) return false;
    return this.config.lefty ? p.x <= GAME_WIDTH - minX : p.x >= minX;
  }

  /** Buttons + pad base, drawn once in the seat frame. */
  private drawStatic(): void {
    const { color } = this.config;
    const g = this.staticGfx;

    // Launcher base dot (the nocked rocket sits on it).
    g.fillStyle(color, 0.6);
    g.fillCircle(this.launcher.x, this.launcher.y, SLING.anchorRadius);

    this.drawButtonBase(g, this.fire);
    this.drawRocketGlyph(g, this.fire.x, this.fire.y, this.fire.r);
    this.drawButtonBase(g, this.home);
    this.drawCrosshairGlyph(g, this.home.x, this.home.y, this.home.r);

    // Aim pad: dim disc + rim, the aimable range as a dashed arc just outside,
    // and a centre dot. Drag mode adds a ◀ ▶ hint (sideways turns the aim).
    const { r } = CONTROLS_V2.pad;
    const { minDeg, maxDeg } = CONTROLS_V2.aim;
    g.fillStyle(color, 0.08);
    g.fillCircle(this.pad.x, this.pad.y, r);
    g.lineStyle(1.5, color, 0.35);
    g.strokeCircle(this.pad.x, this.pad.y, r);
    const arc = STROKES.rangeArc;
    g.lineStyle(arc.width, color, arc.alpha);
    // Seat-frame aim θ sits at screen angle −θ (y down).
    drawDashedArc(g, this.pad.x, this.pad.y, r + 5, -maxDeg * DEG, -minDeg * DEG, arc.dash, arc.gap);
    g.fillStyle(color, 0.5);
    g.fillCircle(this.pad.x, this.pad.y, 3);
    if (this.config.aimMode === 'drag') {
      const s = r * 0.62;
      const h = r * 0.16;
      g.fillStyle(color, 0.45);
      g.fillTriangle(this.pad.x - s, this.pad.y, this.pad.x - s + h * 1.4, this.pad.y - h, this.pad.x - s + h * 1.4, this.pad.y + h);
      g.fillTriangle(this.pad.x + s, this.pad.y, this.pad.x + s - h * 1.4, this.pad.y - h, this.pad.x + s - h * 1.4, this.pad.y + h);
    }
  }

  private drawButtonBase(g: Phaser.GameObjects.Graphics, b: { x: number; y: number; r: number }): void {
    g.fillStyle(this.config.color, 0.12);
    g.fillCircle(b.x, b.y, b.r);
    g.lineStyle(2.5, this.config.color, 0.9);
    g.strokeCircle(b.x, b.y, b.r);
  }

  /** FIRE glyph: a slim rocket pointing across the field, flame underneath. */
  private drawRocketGlyph(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    const { color } = this.config;
    const w = r * 0.2; // body half-width
    const tip = cy - r * 0.62;
    const shoulder = cy - r * 0.2;
    const tail = cy + r * 0.3;
    g.fillStyle(color, 1);
    g.fillTriangle(cx, tip, cx - w, shoulder, cx + w, shoulder); // nose
    g.fillRect(cx - w, shoulder, w * 2, tail - shoulder); // body
    g.fillTriangle(cx - w, cy + r * 0.02, cx - w * 2.1, tail + r * 0.08, cx - w, tail); // fins
    g.fillTriangle(cx + w, cy + r * 0.02, cx + w * 2.1, tail + r * 0.08, cx + w, tail);
    g.fillStyle(COLORS.charge, 0.9); // flame in the exhaust violet
    g.fillTriangle(cx - w * 0.75, tail + 2, cx + w * 0.75, tail + 2, cx, cy + r * 0.66);
  }

  /** HOME glyph: a crosshair (ring + four ticks + centre dot). */
  private drawCrosshairGlyph(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    const { color } = this.config;
    const ring = r * 0.42;
    g.lineStyle(2.5, color, 1);
    g.strokeCircle(cx, cy, ring);
    const inner = ring * 0.55;
    const outer = r * 0.72;
    g.lineBetween(cx, cy - outer, cx, cy - inner);
    g.lineBetween(cx, cy + inner, cx, cy + outer);
    g.lineBetween(cx - outer, cy, cx - inner, cy);
    g.lineBetween(cx + inner, cy, cx + outer, cy);
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, 2.5);
  }

  /** Trajectory, pad knob, pressed highlight + charge ring, nocked rocket. */
  private drawDynamic(): void {
    const { color } = this.config;
    const g = this.dynamicGfx;
    g.clear();
    const dir = this.seatDir();
    const active = this.held !== null || this.aimPointer !== null;

    // Fixed-length dotted trajectory; dim at rest, bright while in use.
    const traj = STROKES.trajectory;
    const { x: lx, y: ly } = this.launcher;
    const near = SLING.trajectoryGap;
    const far = SLING.trajectoryGap + SLING.trajectoryMax;
    g.lineStyle(traj.width, color, active ? traj.alpha : traj.alpha * CONTROLS_V2.trajectoryRestFrac);
    drawDashedLine(g, lx + dir.x * near, ly + dir.y * near, lx + dir.x * far, ly + dir.y * far, traj.dash, traj.gap);

    // Pad knob along the current aim (brighter while the thumb is on it).
    const { r, knobR, knobFrac } = CONTROLS_V2.pad;
    const kx = this.pad.x + dir.x * r * knobFrac;
    const ky = this.pad.y + dir.y * r * knobFrac;
    g.lineStyle(2, color, this.aimPointer !== null ? 0.9 : 0.45);
    g.lineBetween(this.pad.x, this.pad.y, kx, ky);
    g.fillStyle(color, this.aimPointer !== null ? 1 : 0.6);
    g.fillCircle(kx, ky, knobR);

    // Pressed button: brighter fill; FIRE also grows a charge ring.
    if (this.held) {
      const b = this.held === 'fire' ? this.fire : this.home;
      g.fillStyle(color, 0.3);
      g.fillCircle(b.x, b.y, b.r);
    }
    if (this.held === 'fire') this.drawChargeRing();

    // Nocked rocket, nose along the aim, drawn back along −aim.
    const pull =
      this.held === 'fire'
        ? CONTROLS_V2.pullBack * (CONTROLS_V2.pullBackMinFrac + (1 - CONTROLS_V2.pullBackMinFrac) * this.charge)
        : this.held === 'home'
          ? CONTROLS_V2.homePullBack
          : 0;
    this.nockedRocket
      .setPosition(lx - dir.x * pull, ly - dir.y * pull)
      .setRotation(Math.atan2(dir.y, dir.x) + Math.PI / 2);
  }

  /** B35 charge visuals on the FIRE button: a solid player-colour ring, with
   *  the charge violet sweeping clockwise from the top; breathes when armed. */
  private drawChargeRing(): void {
    const g = this.dynamicGfx;
    const ring = STROKES.chargeArc;
    const r = this.fire.r + CONTROLS_V2.chargeRingGap;
    const start = -Math.PI / 2;
    const width = ring.width + 1.5; // a touch bolder than the sling's arc: it's small
    g.lineStyle(width, this.config.color, ring.alpha);
    g.strokeCircle(this.fire.x, this.fire.y, r);
    let alpha: number = ring.alpha;
    if (this.charge >= 1) {
      const pulse = Math.sin(this.elapsed * CHARGE.pulseW);
      alpha = Phaser.Math.Clamp(ring.alpha * (1 + CHARGE.armedPulseDepth * pulse), 0, 1);
    }
    g.lineStyle(width, COLORS.charge, alpha);
    drawSolidArc(g, this.fire.x, this.fire.y, r, start, start + this.charge * Math.PI * 2);
  }

  /** While HOME is held: ring the rock the shot would lock (same look as the
   *  sling's homing preview). World space. */
  private drawLock(): void {
    const g = this.lockGfx;
    g.clear();
    if (this.held !== 'home') return;
    const { anchor, color } = this.config;
    const d = this.worldDir();
    const lock = this.config.homingTargetAt(anchor.x, anchor.y, d.x, d.y);
    if (lock) drawLockRing(g, lock, color);
  }
}
