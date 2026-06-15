/**
 * Overlay — the end-of-round modal pattern shared by the fail ("Try
 * again?") and victory ("You did it!") cards: calm dim, an opaque rounded
 * card (field clutter never shows through — playtest 2), a central icon
 * that reads either way up, mirrored decorative text for each seat (never
 * load-bearing — the 5yo can't read), and tap-ANYWHERE-to-restart via an
 * invisible full-field Zone (a Graphics icon isn't tappable without an
 * explicit hit area, and a full-field zone is friendlier than a target).
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../tokens';
import { DEPTHS, GAME_HEIGHT, GAME_WIDTH, OVERLAY, VICTORY_ICON } from '../layout';

export interface OverlayConfig {
  /** Decorative text, shown once per seat (P1's copy rotated 180°). */
  text: string;
  /** Draws the central icon at (cx, cy); must read either way up. */
  drawIcon: (scene: Phaser.Scene, cx: number, cy: number) => Phaser.GameObjects.GameObject;
}

export class Overlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly tapZone: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene, cfg: OverlayConfig) {
    const { x: cx, y: cy } = OVERLAY.center;
    const textGap = OVERLAY.iconR + 34;

    const dim = scene.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      COLORS.sceneBg,
      OVERLAY.dimAlpha
    );
    const { w, h, radius } = OVERLAY.panel;
    const card = scene.add.graphics();
    card.fillStyle(COLORS.sceneBg, 1);
    card.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, radius);
    card.lineStyle(STROKES.panel.width, COLORS.accent, STROKES.panel.alpha);
    card.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, radius);

    const icon = cfg.drawIcon(scene, cx, cy);
    const textStyle = { fontFamily: FONTS.body, fontSize: '16px', color: CSS.ink };
    const textP2 = scene.add.text(cx, cy + textGap, cfg.text, textStyle).setOrigin(0.5);
    const textP1 = scene.add
      .text(cx, cy - textGap, cfg.text, textStyle)
      .setOrigin(0.5)
      .setAngle(180); // reads right-side-up from the top edge, like P1's HUD

    // Explicit depth: the WaveDirector creates asteroids after this exists,
    // so creation order alone would put them above the card.
    this.container = scene.add
      .container(0, 0, [dim, card, icon, textP1, textP2])
      .setDepth(DEPTHS.overlay)
      .setVisible(false);

    // Not interactive until show(), so it never swallows sling input mid-game.
    this.tapZone = scene.add.zone(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT);
    this.tapZone.on('pointerdown', () => scene.scene.restart());
  }

  get visible(): boolean {
    return this.container.visible;
  }

  show(): void {
    this.container.setVisible(true);
    this.tapZone.setInteractive();
  }
}

// ---- the two cards ----

export const FAIL_CONFIG: OverlayConfig = {
  text: 'Try again?',
  drawIcon: drawReplayIcon,
};

export const VICTORY_CONFIG: OverlayConfig = {
  text: 'You did it!',
  drawIcon: drawVictoryIcon,
};

/** Circular arrow: a ~270° arc with a tangential arrowhead at its end. */
function drawReplayIcon(
  scene: Phaser.Scene,
  cx: number,
  cy: number
): Phaser.GameObjects.Graphics {
  const r = OVERLAY.iconR;
  const g = scene.add.graphics({ x: cx, y: cy });
  const start = Phaser.Math.DegToRad(30);
  const end = Phaser.Math.DegToRad(300);

  g.lineStyle(STROKES.replay.width, COLORS.ink, STROKES.replay.alpha);
  g.beginPath();
  g.arc(0, 0, r, start, end);
  g.strokePath();

  // Arrowhead: tip ahead of the arc's end along the tangent, base across it.
  const tipLen = 18;
  const baseHalf = 10;
  const px = r * Math.cos(end);
  const py = r * Math.sin(end);
  const tx = -Math.sin(end); // tangent (direction of increasing angle)
  const ty = Math.cos(end);
  g.fillStyle(COLORS.ink, STROKES.replay.alpha);
  g.fillTriangle(
    px + tx * tipLen,
    py + ty * tipLen,
    px + (px / r) * baseHalf,
    py + (py / r) * baseHalf,
    px - (px / r) * baseHalf,
    py - (py / r) * baseHalf
  );
  return g;
}

/** Star burst: a big 5-point star + sparkles in each player's color —
 *  rotationally symmetric enough to read as "hooray" from both seats. */
function drawVictoryIcon(
  scene: Phaser.Scene,
  cx: number,
  cy: number
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: cx, y: cy });
  const { starR, starInnerRatio, sparkles } = VICTORY_ICON;

  const points: Phaser.Geom.Point[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? starR : starR * starInnerRatio;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(new Phaser.Geom.Point(r * Math.cos(a), r * Math.sin(a)));
  }
  g.lineStyle(STROKES.replay.width, COLORS.ink, STROKES.replay.alpha);
  g.strokePoints(points, true);

  // Sparkles alternate the two player colors — a shared win.
  sparkles.forEach((s, i) => {
    g.fillStyle(i % 2 === 0 ? COLORS.p1 : COLORS.p2, 1);
    g.fillCircle(s.x, s.y, s.r);
  });
  return g;
}
