/**
 * TwoThumbControl — one seat's controls (#7): one thumb drags to aim, the
 * other holds a fire button.
 *
 *  - FIRE (the railgun): press starts the draw (the nocked rocket pulls back
 *    along the aim and a charge ring fills round the button); release fires at
 *    the fixed SLING.maxSpeed. Held ≥ CHARGE.fullMs, release fires a charged round.
 *  - SPECIAL (#22): while held, rings the enemy the seat's current special would
 *    take; release fires it (a homing missile today). Never charges. Its icon is
 *    drawn from SPECIALS by the `special` field, and dims while its pool is empty.
 *  - One button at a time: while either is held, a press on the other is ignored.
 *  - Haptics (#3): FIRE ticks once the moment it's fully charged with ammo to
 *    fire (HAPTICS dials, src/haptics.ts). The per-shot buzz is the scene's,
 *    in fireShot.
 *  - Aim: sideways motion anywhere in the aim zone (CONTROLS_V2.drag) turns the
 *    aim, clamped to CONTROLS_V2.aim; it persists between shots. The aim pad is
 *    the zone's visual: a knob along the current aim inside the range arc.
 *  - Lefty swap (#21): a small ⇄ above FIRE (CONTROLS_V2.swap). Held for
 *    `holdMs` (a ring fills round it), it mirrors the seat (toggleLefty) and tells
 *    the scene (onLeftyChange); an earlier release cancels. It claims only a
 *    pointer that goes down inside its own circle, which overlaps neither
 *    button nor the aim zone, so it never takes their pointers. The hold runs
 *    on update(delta), so the e2e fixed timestep drives it.
 *
 * Everything the seat draws (buttons, pad, launcher, trajectory) lives in ONE
 * container in the bottom seat's frame (layout CONTROLS_V2's coordinates), which
 * the top seat rotates 180° about the field centre. Only the special's target
 * ring is drawn in world space (it sits on a rock). Pointers are claimed by id: the
 * scene fans every event out to every seat, and each button / the aim zone
 * claims at most one pointer on down by hit-testing its region.
 */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../tokens';
import { CHARGE, CONTROLS_V2, GAME_HEIGHT, GAME_WIDTH, HAPTICS, seatPoint, SLING, type SeatEdge } from '../layout';
import { buzz } from '../haptics';
import { drawDashedArc, drawDashedLine, drawLockRing, drawSolidArc } from './draw';
import { DEFAULT_SPECIAL, SPECIALS, type SpecialKind } from './specials';

type Point = { x: number; y: number };
type Circle = Point & { r: number };
export type Button = 'fire' | 'special';

export interface ShotKind {
  /** The button released: FIRE, or SPECIAL (the seat's current special). */
  button: Button;
  /** A charged FIRE round: FIRE held to a full charge. */
  charged: boolean;
}

export interface TwoThumbControlConfig {
  /** World launcher position (P1_ANCHOR / P2_ANCHOR). */
  anchor: Point;
  color: number;
  /** Which screen edge this player sits at; 'top' rotates the layout 180°. */
  edge: SeatEdge;
  /** Start mirrored: aim zone on the player's left, buttons on their right. */
  lefty: boolean;
  /** The seat's swap control mirrored it (#21); `lefty` is the new setting. */
  onLeftyChange: (lefty: boolean) => void;
  rocketTexture: string;
  /** Does this button's ammo pool have a shot left? */
  canFire: (button: Button) => boolean;
  /** Launch direction (unit vector, world) from the anchor; the scene picks the speed. */
  onFire: (x: number, y: number, dirx: number, diry: number, kind: ShotKind) => void;
  /** The enemy the special along (origin, dir) would take, or null. */
  specialTargetAt: (ox: number, oy: number, dirx: number, diry: number) => { x: number; y: number; r: number } | null;
}

const DEG = Math.PI / 180;
/** Charge/hold ring stroke: a touch bolder than the base stroke, the rings are small. */
const RING_WIDTH = STROKES.chargeArc.width + 1.5;

/** Does a point fall inside a circle grown by `pad` (a control's hit area)? */
const hits = (p: Point, c: Circle, pad: number): boolean => Math.hypot(p.x - c.x, p.y - c.y) <= c.r + pad;

export class TwoThumbControl {
  private readonly staticGfx: Phaser.GameObjects.Graphics;
  /** The SPECIAL button's icon, on its own so it can dim and be swapped. */
  private readonly specialIconGfx: Phaser.GameObjects.Graphics;
  private readonly dynamicGfx: Phaser.GameObjects.Graphics;
  /** World-space: the target ring on the enemy the special would take. */
  private readonly lockGfx: Phaser.GameObjects.Graphics;
  private readonly nockedRocket: Phaser.GameObjects.Image;

  // Seat-frame geometry (lefty applied by layOut).
  private readonly launcher: Point;
  private lefty: boolean;
  private fire!: Circle;
  private specialBtn!: Circle;
  private pad!: Point;
  private swap!: Circle;

  /** The seat's current special: what SPECIAL fires and which icon it shows. */
  private currentSpecial: SpecialKind = DEFAULT_SPECIAL;

  /** Seat-frame aim, degrees (0 = player's right, 90 = across the field). */
  private aimDeg: number = CONTROLS_V2.aim.startDeg;
  private aimPointer: number | null = null;
  /** Last seat-frame x of the aiming thumb. */
  private dragLastX = 0;
  private buttonPointer: number | null = null;
  private held: Button | null = null;
  /** FIRE charge, 0→1 over CHARGE.fullMs of held game time. */
  private charge = 0;
  /** This FIRE hold has already given its armed tick (#3). */
  private armedBuzzed = false;
  /** Free-running ms clock for the armed pulse. */
  private elapsed = 0;
  /** The pointer holding the swap control, and how long it has held (ms). */
  private swapPointer: number | null = null;
  private swapHeldMs = 0;
  /** Set when the resting picture changed and needs one more redraw. */
  private dirty = true;

  constructor(scene: Phaser.Scene, private readonly config: TwoThumbControlConfig) {
    this.lefty = config.lefty;
    this.layOut();
    this.launcher = this.toSeat(config.anchor);

    // Seat-frame container (identity for the bottom seat): the outer one pivots
    // on the field centre, the inner one shifts back so children use plain
    // seat-frame coordinates.
    const inner = scene.add.container(-GAME_WIDTH / 2, -GAME_HEIGHT / 2);
    scene.add
      .container(GAME_WIDTH / 2, GAME_HEIGHT / 2, [inner])
      .setAngle(config.edge === 'top' ? 180 : 0);
    this.staticGfx = scene.add.graphics();
    this.specialIconGfx = scene.add.graphics();
    this.dynamicGfx = scene.add.graphics();
    this.nockedRocket = scene.add.image(this.launcher.x, this.launcher.y, config.rocketTexture);
    inner.add([this.staticGfx, this.specialIconGfx, this.dynamicGfx, this.nockedRocket]);
    this.lockGfx = scene.add.graphics();
    this.drawStatic();
    this.setSpecial(this.currentSpecial);
  }

  // ---- read-outs (DEV hooks / tests) ----

  get aimDegrees(): number {
    return this.aimDeg;
  }

  get special(): SpecialKind {
    return this.currentSpecial;
  }

  /** Change what SPECIAL fires (#26 upgrades): redraws the button's icon. */
  setSpecial(kind: SpecialKind): void {
    this.currentSpecial = kind;
    const g = this.specialIconGfx;
    g.clear();
    const b = this.specialBtn;
    SPECIALS[kind].drawIcon(g, b.x, b.y, b.r, this.config.color);
  }

  /** World-space centres + radii of this seat's controls. */
  worldLayout(): { anchor: Point; fire: Circle; special: Circle; pad: Circle; swap: Circle } {
    return {
      anchor: { ...this.config.anchor },
      fire: { ...this.toSeat(this.fire), r: this.fire.r },
      special: { ...this.toSeat(this.specialBtn), r: this.specialBtn.r },
      pad: { ...this.toSeat(this.pad), r: CONTROLS_V2.pad.r },
      swap: { ...this.toSeat(this.swap), r: this.swap.r },
    };
  }

  // ---- pointer routing (called by the scene for every pointer event) ----

  handleDown(pointer: Phaser.Input.Pointer): void {
    const p = this.toSeat(pointer);
    if (hits(p, this.swap, CONTROLS_V2.swap.hitPad)) {
      if (this.swapPointer !== null) return;
      this.swapPointer = pointer.id;
      this.swapHeldMs = 0;
      this.dirty = true;
      return;
    }
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
    this.dirty = true;
  }

  handleMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.aimPointer) return; // a held button ignores sliding
    const p = this.toSeat(pointer);
    this.setAim(this.aimDeg - (p.x - this.dragLastX) * CONTROLS_V2.drag.gainDegPerPx);
    this.dragLastX = p.x;
  }

  handleUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.swapPointer) {
      this.swapPointer = null; // released early: no swap
      this.dirty = true;
    }
    if (pointer.id === this.aimPointer) {
      this.aimPointer = null;
      this.dirty = true;
    }
    if (pointer.id !== this.buttonPointer) return;
    const button = this.held;
    const charged = button === 'fire' && this.charge >= 1;
    this.dropButton();
    if (!button || !this.config.canFire(button)) return;
    const dir = this.worldDir();
    const { anchor } = this.config;
    this.config.onFire(anchor.x, anchor.y, dir.x, dir.y, { button, charged });
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (this.swapPointer !== null) {
      this.swapHeldMs += deltaMs;
      if (this.swapHeldMs >= CONTROLS_V2.swap.holdMs) this.toggleLefty();
    }
    if (this.held === 'fire') this.charge = Math.min(1, this.charge + deltaMs / CHARGE.fullMs);
    const canFire = this.config.canFire('fire');
    // An empty special pool dims the SPECIAL icon (it regens on its own clock).
    this.specialIconGfx.setAlpha(this.config.canFire('special') ? 1 : 0.35);
    // Armed tick: once per hold, the first frame it's both fully charged AND
    // has ammo (no "ready" buzz for a release that would fire nothing).
    if (this.held === 'fire' && this.charge >= 1 && canFire && !this.armedBuzzed) {
      this.armedBuzzed = true;
      buzz(HAPTICS.armedMs);
    }
    // An empty pool dims the nocked rocket: the held button's pool, else
    // FIRE's (cheap; each pool regens on its own clock).
    this.nockedRocket.setAlpha(this.config.canFire(this.held ?? 'fire') ? 1 : 0.35);
    const active = this.held !== null || this.aimPointer !== null || this.swapPointer !== null;
    if (!active && !this.dirty) return;
    this.dirty = false;
    this.drawDynamic();
    this.drawLock();
  }

  // ---- internals ----

  /** World ↔ seat frame (the same involution both ways). */
  private toSeat(p: Point): Point {
    return seatPoint(this.config.edge, p);
  }

  /** Seat-frame controls from CONTROLS_V2, mirrored (x → GAME_WIDTH − x) for a lefty seat. */
  private layOut(): void {
    const mirror = <T extends Point>(p: T): T => (this.lefty ? { ...p, x: GAME_WIDTH - p.x } : { ...p });
    const { fire, special, pad, swap } = CONTROLS_V2;
    this.fire = mirror(fire);
    this.specialBtn = mirror(special);
    this.pad = mirror(pad);
    this.swap = mirror(swap);
  }

  /** The swap's hold completed: mirror (or un-mirror) the seat now, and tell
   *  the scene. Buttons, pad, aim zone and swap move to the other side; a held
   *  button is dropped without firing and the aim thumb let go (their regions
   *  moved); the aim angle stays. */
  private toggleLefty(): void {
    this.lefty = !this.lefty;
    this.layOut();
    this.dropButton();
    this.aimPointer = null;
    this.swapPointer = null;
    this.drawStatic();
    this.setSpecial(this.currentSpecial);
    this.config.onLeftyChange(this.lefty);
  }

  /** Let go of the held button (no shot) and clear its charge and target ring. */
  private dropButton(): void {
    this.buttonPointer = null;
    this.held = null;
    this.charge = 0;
    this.dirty = true;
    this.lockGfx.clear();
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

  /** Which button (if any) a seat-frame point presses; nearest wins an overlap. */
  private buttonAt(p: Point): Button | null {
    const score = (b: Circle) => (hits(p, b, CONTROLS_V2.buttonHitPad) ? Math.hypot(p.x - b.x, p.y - b.y) / b.r : Infinity);
    const f = score(this.fire);
    const s = score(this.specialBtn);
    if (f === Infinity && s === Infinity) return null;
    return f <= s ? 'fire' : 'special';
  }

  /** The aim zone: the player's side of their band away from the buttons. */
  private inAimRegion(p: Point): boolean {
    const { minX, minY } = CONTROLS_V2.drag;
    if (p.y < minY) return false;
    return this.lefty ? p.x <= GAME_WIDTH - minX : p.x >= minX;
  }

  /** Buttons, pad base and swap, drawn in the seat frame (again on a swap). */
  private drawStatic(): void {
    const { color } = this.config;
    const g = this.staticGfx;
    g.clear();

    // Launcher base dot (the nocked rocket sits on it).
    g.fillStyle(color, 0.6);
    g.fillCircle(this.launcher.x, this.launcher.y, SLING.anchorRadius);

    this.drawButtonBase(g, this.fire);
    this.drawRocketGlyph(g, this.fire.x, this.fire.y, this.fire.r);
    this.drawButtonBase(g, this.specialBtn); // its icon is specialIconGfx (setSpecial)

    // Aim pad: dim disc + rim, the aimable range as a dashed arc just outside,
    // a centre dot, and a ◀ ▶ hint (sideways turns the aim).
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
    const s = r * 0.62;
    const h = r * 0.16;
    g.fillStyle(color, 0.45);
    g.fillTriangle(this.pad.x - s, this.pad.y, this.pad.x - s + h * 1.4, this.pad.y - h, this.pad.x - s + h * 1.4, this.pad.y + h);
    g.fillTriangle(this.pad.x + s, this.pad.y, this.pad.x + s - h * 1.4, this.pad.y - h, this.pad.x + s - h * 1.4, this.pad.y + h);

    this.drawSwap(g);
  }

  /** Swap control: a dim ring round ⇄ (an arrow right over an arrow left). */
  private drawSwap(g: Phaser.GameObjects.Graphics): void {
    const { color } = this.config;
    const { x, y, r } = this.swap;
    g.fillStyle(color, 0.08);
    g.fillCircle(x, y, r);
    g.lineStyle(1.5, color, 0.5);
    g.strokeCircle(x, y, r);
    const half = r * 0.5; // arrow half-length
    const dy = r * 0.28; // each arrow's offset from the centre line
    const head = r * 0.26;
    g.lineStyle(2, color, 0.8);
    g.fillStyle(color, 0.8);
    g.lineBetween(x - half, y - dy, x + half - head, y - dy);
    g.fillTriangle(x + half, y - dy, x + half - head, y - dy - head * 0.8, x + half - head, y - dy + head * 0.8);
    g.lineBetween(x + half, y + dy, x - half + head, y + dy);
    g.fillTriangle(x - half, y + dy, x - half + head, y + dy - head * 0.8, x - half + head, y + dy + head * 0.8);
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

  /** Trajectory, pad knob, pressed highlight + charge ring, nocked rocket. */
  private drawDynamic(): void {
    const { color } = this.config;
    const g = this.dynamicGfx;
    g.clear();
    const dir = this.seatDir();
    const active = this.held !== null || this.aimPointer !== null;

    // Swap hold: a ring fills clockwise round the ⇄ (the charge-ring look).
    if (this.swapPointer !== null) {
      g.fillStyle(color, 0.25);
      g.fillCircle(this.swap.x, this.swap.y, this.swap.r);
      this.drawSweep(this.swap, this.swapHeldMs / CONTROLS_V2.swap.holdMs, STROKES.chargeArc.alpha);
    }

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
      const b = this.held === 'fire' ? this.fire : this.specialBtn;
      g.fillStyle(color, 0.3);
      g.fillCircle(b.x, b.y, b.r);
    }
    if (this.held === 'fire') this.drawChargeRing();

    // Nocked rocket, nose along the aim, drawn back along −aim.
    const pull =
      this.held === 'fire'
        ? CONTROLS_V2.pullBack * (CONTROLS_V2.pullBackMinFrac + (1 - CONTROLS_V2.pullBackMinFrac) * this.charge)
        : this.held === 'special'
          ? CONTROLS_V2.specialPullBack
          : 0;
    this.nockedRocket
      .setPosition(lx - dir.x * pull, ly - dir.y * pull)
      .setRotation(Math.atan2(dir.y, dir.x) + Math.PI / 2);
  }

  /** Charge visuals on the FIRE button: a solid player-colour ring, with
   *  the charge violet sweeping clockwise from the top; breathes when armed. */
  private drawChargeRing(): void {
    const ring = STROKES.chargeArc;
    this.dynamicGfx.lineStyle(RING_WIDTH, this.config.color, ring.alpha);
    this.dynamicGfx.strokeCircle(this.fire.x, this.fire.y, this.fire.r + CONTROLS_V2.chargeRingGap);
    let alpha: number = ring.alpha;
    if (this.charge >= 1) {
      const pulse = Math.sin(this.elapsed * CHARGE.pulseW);
      alpha = Phaser.Math.Clamp(ring.alpha * (1 + CHARGE.armedPulseDepth * pulse), 0, 1);
    }
    this.drawSweep(this.fire, this.charge, alpha);
  }

  /** The charge violet sweeping clockwise from the top round a control, `frac`
   *  (0→1) of the way: FIRE's charge and the swap's hold. */
  private drawSweep(c: Circle, frac: number, alpha: number): void {
    const start = -Math.PI / 2;
    this.dynamicGfx.lineStyle(RING_WIDTH, COLORS.charge, alpha);
    drawSolidArc(this.dynamicGfx, c.x, c.y, c.r + CONTROLS_V2.chargeRingGap, start, start + Math.min(1, frac) * Math.PI * 2);
  }

  /** While SPECIAL is held with ammo: ring the enemy it would take. World space. */
  private drawLock(): void {
    const g = this.lockGfx;
    g.clear();
    if (this.held !== 'special' || !this.config.canFire('special')) return; // nothing would fire
    const { anchor, color } = this.config;
    const d = this.worldDir();
    const lock = this.config.specialTargetAt(anchor.x, anchor.y, d.x, d.y);
    if (lock) drawLockRing(g, lock, color);
  }
}
