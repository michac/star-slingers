/**
 * JoinScene — the join screen every boot opens on (#20). Each seat has a join
 * panel in its own half (P1's is P2's layout rotated 180°): a breathing ring in
 * the seat's colour. A tap anywhere in that half joins the seat, and two pick
 * buttons appear beside its ring: Easy (∞, unlimited ammo) and Normal (five
 * ammo pips). Picking one makes the seat ready; tapping the ring again leaves.
 * Once every joined seat is ready, a numeral countdown starts the run with
 * just those seats (lineup.ts). A seat that joins mid-countdown cancels it
 * until that seat picks too. No reading anywhere: icons and numerals only.
 *
 * All timing runs off update(delta), not tweens, so the e2e suite's fixed
 * timestep drives it (TweenManager is wall-clock driven).
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../tokens';
import { AMMO, GAME_HEIGHT, GAME_WIDTH, JOIN } from '../layout';
import { generateTextures, TEX } from '../objects/textures';
import { drawStarfield } from '../objects/draw';
import type { PlayerId } from '../objects/Rocket';
import { SEAT_ORDER, setLineup, type Difficulty, type Lineup } from '../lineup';

type Pt = { x: number; y: number };

/** One seat's panel: its container (rotated 180° for P1) and parts. */
interface Panel {
  player: PlayerId;
  ring: Phaser.GameObjects.Container;
  easy: Phaser.GameObjects.Graphics;
  normal: Phaser.GameObjects.Graphics;
  countdown: Phaser.GameObjects.Text;
}

/** P1's spot for a P2-frame point (and back: the map is its own inverse). */
const toSeat = (player: PlayerId, p: Pt): Pt =>
  player === 'p1' ? { x: GAME_WIDTH - p.x, y: GAME_HEIGHT - p.y } : { x: p.x, y: p.y };

const within = (p: Pt, c: { x: number; y: number; r: number }) =>
  Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y) <= c.r + JOIN.hitPad;

export class JoinScene extends Phaser.Scene {
  /** Per seat: not joined (undefined), joined and picking (null), or picked. */
  private picks: Partial<Record<PlayerId, Difficulty | null>> = {};
  private panels: Panel[] = [];
  /** Countdown left (ms) while every joined seat is ready; null otherwise. */
  private countdownLeft: number | null = null;
  private clockMs = 0;

  constructor() {
    super('Join');
  }

  create(): void {
    this.picks = {};
    this.countdownLeft = null;
    this.clockMs = 0;
    generateTextures(this); // the ring's rocket glyph (idempotent across scenes)
    drawStarfield(this);
    this.panels = SEAT_ORDER.map((player) => this.buildPanel(player));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.refresh();

    // Deterministic handle for the headless e2e suite (e2e/).
    if (import.meta.env.DEV) {
      (this as unknown as { __debug: object }).__debug = {
        picks: () => ({ ...this.picks }),
        countdownLeft: () => this.countdownLeft,
        // World-space panel layout (P1's mirrored) + its rotation, for touches.
        panel: (player: PlayerId) => {
          const panel = this.panels.find((p) => p.player === player)!;
          const at = (c: { x: number; y: number; r: number }) => ({ ...toSeat(player, c), r: c.r });
          return {
            angle: panel.ring.parentContainer.angle,
            ring: at(JOIN.ring),
            easy: at(JOIN.easy),
            normal: at(JOIN.normal),
            easyVisible: panel.easy.visible,
            countdown: panel.countdown.visible ? panel.countdown.text : null,
          };
        },
        // Skip the screen: start the run with this lineup straight away.
        startRun: (l: Partial<Lineup>) => this.startRun({ p1: l.p1 ?? null, p2: l.p2 ?? null }),
      };
    }
  }

  update(_time: number, delta: number): void {
    this.clockMs += delta;
    // The unjoined rings breathe; a joined seat's ring holds still.
    const breath = 1 + JOIN.pulseScale * Math.sin((this.clockMs / JOIN.pulseMs) * Math.PI * 2);
    for (const panel of this.panels) panel.ring.setScale(this.picks[panel.player] === undefined ? breath : 1);

    const joined = SEAT_ORDER.filter((p) => this.picks[p] !== undefined);
    const allReady = joined.length > 0 && joined.every((p) => this.picks[p]);
    if (!allReady) {
      if (this.countdownLeft !== null) {
        this.countdownLeft = null;
        this.refresh();
      }
      return;
    }
    if (this.countdownLeft === null) this.countdownLeft = JOIN.countdownMs;
    else this.countdownLeft -= delta;
    if (this.countdownLeft <= 0) {
      this.startRun({ p1: this.picks.p1 ?? null, p2: this.picks.p2 ?? null });
      return;
    }
    this.refresh();
  }

  private startRun(l: Lineup): void {
    setLineup(l);
    // Explicit empty data: Phaser keeps a scene's last start data when given
    // none, so after a Try again (which passes a retry wave) the next run
    // would otherwise begin at that wave instead of the query's / wave 1.
    this.scene.start('Sandbox', {});
  }

  /** A tap belongs to the seat whose half it lands in. Unjoined: join. Joined:
   *  the ring leaves, a pick button picks, anything else does nothing. */
  private onDown(pointer: Phaser.Input.Pointer): void {
    const player: PlayerId = pointer.y >= JOIN.halfY ? 'p2' : 'p1';
    const at = toSeat(player, pointer);
    const pick = this.picks[player];
    if (pick === undefined) {
      this.picks[player] = null;
    } else if (within(at, JOIN.ring)) {
      delete this.picks[player];
    } else if (within(at, JOIN.easy)) {
      this.picks[player] = 'easy';
    } else if (within(at, JOIN.normal)) {
      this.picks[player] = 'normal';
    } else {
      return;
    }
    this.refresh();
  }

  /** Redraw every panel's state: buttons shown once joined, the pick lit, the
   *  countdown numeral while it runs. */
  private refresh(): void {
    const seconds = this.countdownLeft === null ? null : Math.ceil(this.countdownLeft / 1000);
    for (const panel of this.panels) {
      const pick = this.picks[panel.player];
      const joined = pick !== undefined;
      panel.easy.setVisible(joined).setAlpha(pick === 'normal' ? JOIN.unpickedAlpha : 1);
      panel.normal.setVisible(joined).setAlpha(pick === 'easy' ? JOIN.unpickedAlpha : 1);
      panel.ring.setAlpha(joined ? JOIN.unpickedAlpha : 1);
      const counting = seconds !== null && joined;
      panel.countdown.setVisible(counting).setText(counting ? String(seconds) : '');
    }
  }

  private buildPanel(player: PlayerId): Panel {
    const color = player === 'p1' ? COLORS.p1 : COLORS.p2;
    const colorCss = player === 'p1' ? CSS.p1 : CSS.p2;
    // P1's panel = P2's layout rotated 180° about the field centre: a
    // container at (W, H) turned 180° maps local (x, y) to (W − x, H − y).
    const root = player === 'p1'
      ? this.add.container(GAME_WIDTH, GAME_HEIGHT).setAngle(180)
      : this.add.container(0, 0);

    // Join ring: the seat's colour round a big rocket glyph.
    const { ring: r } = JOIN;
    const ringGfx = this.add.graphics();
    ringGfx.lineStyle(STROKES.replay.width, color, 1);
    ringGfx.strokeCircle(0, 0, r.r);
    const rocket = this.add.image(0, 0, player === 'p1' ? TEX.rocketP1 : TEX.rocketP2).setScale(2.6);
    const ring = this.add.container(r.x, r.y, [ringGfx, rocket]);

    // Easy: ∞ drawn as a lemniscate, so it never depends on the font's glyphs.
    const easy = this.add.graphics({ x: JOIN.easy.x, y: JOIN.easy.y });
    easy.lineStyle(STROKES.replay.width, color, 1);
    easy.strokeCircle(0, 0, JOIN.easy.r);
    const lobe = JOIN.easy.r * 0.5;
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const d = 1 + Math.sin(t) ** 2;
      pts.push(new Phaser.Math.Vector2((lobe * Math.cos(t)) / d, (lobe * Math.sin(t) * Math.cos(t)) / d));
    }
    easy.lineStyle(STROKES.replay.width - 1, COLORS.ink, 1);
    easy.strokePoints(pts, false);

    // Normal: the regular ammo pool as a row of pips.
    const normal = this.add.graphics({ x: JOIN.normal.x, y: JOIN.normal.y });
    normal.lineStyle(STROKES.replay.width, color, 1);
    normal.strokeCircle(0, 0, JOIN.normal.r);
    normal.fillStyle(COLORS.ink, 1);
    const pipGap = 11;
    for (let i = 0; i < AMMO.max; i++) normal.fillCircle((i - (AMMO.max - 1) / 2) * pipGap, 0, 3.5);

    const countdown = this.add
      .text(JOIN.countdownAt.x, JOIN.countdownAt.y, '', {
        fontFamily: FONTS.display,
        fontSize: `${JOIN.countdownFontPx}px`,
        color: colorCss,
      })
      .setOrigin(0.5);

    root.add([ring, easy, normal, countdown]);
    return { player, ring, easy, normal, countdown };
  }
}
