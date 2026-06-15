/**
 * SlingControl — one player's abstract sling: anchor dot + dashed pull-range
 * arc; press near the anchor, drag back within your own half, release to fire.
 *
 * The scene forwards all pointer events to every control; each control claims
 * at most one pointer by id, so two controls track two fingers independently.
 */
import Phaser from 'phaser';
import { STROKES } from '../tokens';
import { SLING } from '../layout';

export interface SlingControlConfig {
  anchor: { x: number; y: number };
  color: number;
  /** Which screen edge this player sits at; pulls clamp toward that edge. */
  edge: 'top' | 'bottom';
  /** Texture for the nocked-rocket preview at the anchor. */
  rocketTexture: string;
  canFire: () => boolean;
  onFire: (x: number, y: number, vx: number, vy: number) => void;
  /** Homing mode (B14): is this seat's toggle on right now? */
  isHoming?: () => boolean;
  /** The rock the shot would lock onto for a given aim ray (anchor + dir),
   *  as a position + ring radius — or null if none. Drives the aim preview. */
  homingTargetAt?: (ox: number, oy: number, dirx: number, diry: number) => { x: number; y: number; r: number } | null;
}

export class SlingControl {
  private readonly staticGfx: Phaser.GameObjects.Graphics;
  private readonly dynamicGfx: Phaser.GameObjects.Graphics;
  private readonly nockedRocket: Phaser.GameObjects.Image;

  /** id of the pointer this control has claimed, or null when at rest. */
  private pointerId: number | null = null;
  /** Clamped pull vector (touch point minus anchor). */
  private readonly pull = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene, private readonly config: SlingControlConfig) {
    this.staticGfx = scene.add.graphics();
    this.dynamicGfx = scene.add.graphics();
    this.nockedRocket = scene.add
      .image(config.anchor.x, config.anchor.y, config.rocketTexture)
      .setVisible(false);
    this.drawStatic();
  }

  // ---- pointer routing (called by the scene for every pointer event) ----

  handleDown(pointer: Phaser.Input.Pointer): void {
    if (this.pointerId !== null) return; // already holding a finger
    const { anchor } = this.config;
    const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, anchor.x, anchor.y);
    if (dist > SLING.grabRadius) return;
    this.pointerId = pointer.id;
    this.updatePull(pointer);
  }

  handleMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.updatePull(pointer);
  }

  /** Wired to BOTH pointerup and pointerupoutside — a finger lifted over the
   *  FIT letterbox only fires the latter; missing it leaves a stuck sling. */
  handleUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    const len = this.pull.length();
    this.dynamicGfx.clear();
    this.nockedRocket.setVisible(false);
    if (len < SLING.minFirePull || !this.config.canFire()) return;

    const { anchor } = this.config;
    // Launch opposite the pull; speed scales with how far back it was drawn.
    const dir = this.pull.clone().scale(-1).normalize();
    const speed = Math.max(SLING.minSpeed, (len / SLING.pullRadius) * SLING.maxSpeed);
    this.config.onFire(anchor.x, anchor.y, dir.x * speed, dir.y * speed);
  }

  /** Redraw the pull visuals each frame while a finger is down. */
  update(): void {
    if (this.pointerId === null) return;
    this.drawDynamic();
  }

  // ---- internals ----

  private updatePull(pointer: Phaser.Input.Pointer): void {
    const { anchor, edge } = this.config;
    this.pull.set(pointer.x - anchor.x, pointer.y - anchor.y);
    // Clamp to the player's own half: P1 (top) may only pull up, P2 down.
    if (edge === 'top') {
      this.pull.y = Math.min(this.pull.y, 0);
    } else {
      this.pull.y = Math.max(this.pull.y, 0);
    }
    if (this.pull.length() > SLING.pullRadius) {
      this.pull.setLength(SLING.pullRadius);
    }
  }

  /** Anchor dot + dashed pull-range arc, drawn once. */
  private drawStatic(): void {
    const { anchor, color, edge } = this.config;
    const g = this.staticGfx;
    g.fillStyle(color, 1);
    g.fillCircle(anchor.x, anchor.y, SLING.anchorRadius);

    // Arc angles in screen space (y down): the top player's arc bulges up
    // through -PI/2 (pi..2pi), the bottom player's down through +PI/2 (0..pi).
    const [start, end] = edge === 'top' ? [Math.PI, Math.PI * 2] : [0, Math.PI];
    const arc = STROKES.rangeArc;
    g.lineStyle(arc.width, color, arc.alpha);
    drawDashedArc(g, anchor.x, anchor.y, SLING.pullRadius, start, end, arc.dash, arc.gap);
  }

  /** Pull line, translucent touch dot, dotted trajectory, nocked rocket. */
  private drawDynamic(): void {
    const { anchor, color } = this.config;
    const g = this.dynamicGfx;
    g.clear();

    const tipX = anchor.x + this.pull.x;
    const tipY = anchor.y + this.pull.y;
    const len = this.pull.length();

    // Pull line anchor -> finger.
    g.lineStyle(STROKES.pullLine.width, color, STROKES.pullLine.alpha);
    g.lineBetween(anchor.x, anchor.y, tipX, tipY);

    // Translucent dot under the finger.
    g.fillStyle(color, STROKES.touchDot.fillAlpha);
    g.fillCircle(tipX, tipY, SLING.touchDotRadius);
    g.lineStyle(STROKES.touchDot.strokeWidth, color, 1);
    g.strokeCircle(tipX, tipY, SLING.touchDotRadius);

    if (len < SLING.minFirePull) {
      this.nockedRocket.setVisible(false);
      return;
    }

    // Straight dotted trajectory — honest preview, there is no gravity.
    const dirX = -this.pull.x / len;
    const dirY = -this.pull.y / len;
    const reach = SLING.trajectoryGap + (len / SLING.pullRadius) * SLING.trajectoryMax;
    const traj = STROKES.trajectory;
    g.lineStyle(traj.width, color, traj.alpha);
    drawDashedLine(
      g,
      anchor.x + dirX * SLING.trajectoryGap,
      anchor.y + dirY * SLING.trajectoryGap,
      anchor.x + dirX * reach,
      anchor.y + dirY * reach,
      traj.dash,
      traj.gap
    );

    // Rocket nocked at the anchor, nose along the launch direction.
    this.nockedRocket
      .setVisible(true)
      .setRotation(Math.atan2(dirY, dirX) + Math.PI / 2);

    // Homing aim preview (B14): ring the rock the shot would lock onto, so the
    // player sees what they'll hit before firing.
    if (this.config.isHoming?.()) {
      const lock = this.config.homingTargetAt?.(anchor.x, anchor.y, dirX, dirY);
      if (lock) {
        // Glow fill + bold ring so the lock clearly pops and is easy to track
        // as it jumps between rocks drifting through the aim line.
        g.fillStyle(color, 0.22);
        g.fillCircle(lock.x, lock.y, lock.r);
        g.lineStyle(3.5, color, 1);
        g.strokeCircle(lock.x, lock.y, lock.r);
      }
    }
  }
}

// ---- dashed-stroke helpers (Phaser Graphics has no native dash) ----

function drawDashedLine(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(s + dash, len);
    g.lineBetween(x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e);
  }
}

/** Walks the arc by arc-length; each dash is short enough to draw straight. */
function drawDashedArc(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  dash: number,
  gap: number
): void {
  const total = Math.abs(endAngle - startAngle) * r;
  const sign = Math.sign(endAngle - startAngle);
  for (let s = 0; s < total; s += dash + gap) {
    const e = Math.min(s + dash, total);
    const a0 = startAngle + (s / r) * sign;
    const a1 = startAngle + (e / r) * sign;
    g.lineBetween(
      cx + r * Math.cos(a0),
      cy + r * Math.sin(a0),
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1)
    );
  }
}
