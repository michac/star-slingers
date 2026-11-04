/**
 * JoinScene — the join screen every boot opens on (#20). Each seat has a join
 * panel in its own half (P1's is P2's layout rotated 180°): a breathing ring in
 * the seat's colour. A tap anywhere in that half joins the seat, and two pick
 * buttons appear beside its ring: Easy (∞, unlimited ammo) and Normal (five
 * ammo pips). Picking one makes the seat ready; tapping the ring again leaves.
 * Once every joined seat is ready, a numeral countdown starts the run with
 * just those seats (lineup.ts). A seat that joins mid-countdown cancels it
 * until that seat picks too; a seat that leaves restarts it from the top. No reading anywhere: icons and numerals only.
 *
 * All timing runs off update(delta), not tweens, so the e2e suite's fixed
 * timestep drives it (TweenManager is wall-clock driven).
 */
import Phaser from 'phaser';
import { COLORS, FONTS, STROKES } from '../tokens';
import { AMMO, GAME_HEIGHT, GAME_WIDTH, JOIN, seatPoint, type SeatEdge } from '../layout';
import { generateTextures } from '../objects/textures';
import { Starfield } from '../objects/Starfield';
import type { PlayerId } from '../objects/Rocket';
import { SEAT_DEFS, toLineup, type Lineup, type SeatDef } from '../lineup';

type Pt = { x: number; y: number };

/** One seat's panel: its container (rotated 180° for P1) and parts. */
interface Panel {
  player: PlayerId;
  edge: SeatEdge;
  ring: Phaser.GameObjects.Container;
  easy: Phaser.GameObjects.Graphics;
  normal: Phaser.GameObjects.Graphics;
  countdown: Phaser.GameObjects.Text;
}

const within = (p: Pt, c: { x: number; y: number; r: number }) =>
  Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y) <= c.r + JOIN.hitPad;

export class JoinScene extends Phaser.Scene {
  /** Per seat: not joined (undefined), joined and picking (null), or picked. */
  private picks: Partial<Lineup> = {};
  private panels: Panel[] = [];
  /** Countdown left (ms) while every joined seat is ready; null otherwise. */
  private countdownLeft: number | null = null;
  private clockMs = 0;
  /** When (clockMs) each joined seat joined: a ring tap only leaves after
   *  JOIN.leaveGraceMs, so a double-tap or a two-finger slap stays joined. */
  private joinedAt: Partial<Record<PlayerId, number>> = {};
  private starfield!: Starfield;

  constructor() {
    super('Join');
  }

  create(): void {
    this.picks = {};
    this.joinedAt = {};
    this.countdownLeft = null;
    this.clockMs = 0;
    generateTextures(this); // the ring's rocket glyph + the star tiles (idempotent across scenes)
    this.starfield = new Starfield(this); // first, so it sits under the panels
    this.panels = SEAT_DEFS.map((def) => this.buildPanel(def));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.refresh();

    // Deterministic handle for the headless e2e suite (e2e/).
    if (import.meta.env.DEV) {
      (this as unknown as { __debug: object }).__debug = {
        picks: () => ({ ...this.picks }),
        // World-space panel layout (P1's mirrored) + its rotation, for touches.
        panel: (player: PlayerId) => {
          const panel = this.panels.find((p) => p.player === player)!;
          const at = (c: { x: number; y: number; r: number }) => ({ ...seatPoint(panel.edge, c), r: c.r });
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
        startRun: (l: Partial<Lineup>) => this.startRun(l),
      };
    }
  }

  update(_time: number, delta: number): void {
    this.clockMs += delta;
    this.starfield.update(delta);
    // The unjoined rings breathe; a joined seat's ring holds still.
    const breath = 1 + JOIN.pulseScale * Math.sin((this.clockMs / JOIN.pulseMs) * Math.PI * 2);
    for (const panel of this.panels) panel.ring.setScale(this.picks[panel.player] === undefined ? breath : 1);

    // picks holds only the joined seats (leaving deletes the key).
    const joined = Object.values(this.picks);
    const allReady = joined.length > 0 && joined.every((pick) => pick !== null);
    if (!allReady) {
      if (this.countdownLeft !== null) {
        this.countdownLeft = null;
        this.refresh();
      }
      return;
    }
    const shown = this.countdownSeconds();
    this.countdownLeft = this.countdownLeft === null ? JOIN.countdownMs : this.countdownLeft - delta;
    if (this.countdownLeft <= 0) {
      this.startRun(this.picks);
      return;
    }
    // Redraw only when the numeral changes (once a second), not every frame.
    if (this.countdownSeconds() !== shown) this.refresh();
  }

  private countdownSeconds(): number | null {
    return this.countdownLeft === null ? null : Math.ceil(this.countdownLeft / 1000);
  }

  /** The lineup travels as scene data, so Try again's restart keeps it. The
   *  fresh payload also replaces a previous run's retry wave: Phaser keeps a
   *  scene's last start data only when it's given none. */
  private startRun(l: Partial<Lineup>): void {
    this.scene.start('Sandbox', { lineup: toLineup(l) });
  }

  /** A tap belongs to the seat whose half it lands in. Unjoined: join. Joined:
   *  the ring leaves (once the join grace has passed), a pick button picks,
   *  anything else does nothing. A join or a leave changes who plays, so it
   *  restarts the countdown; a changed pick doesn't. */
  private onDown(pointer: Phaser.Input.Pointer): void {
    const edge: SeatEdge = pointer.y >= JOIN.halfY ? 'bottom' : 'top';
    const { player } = this.panels.find((p) => p.edge === edge)!;
    const at = seatPoint(edge, pointer);
    const pick = this.picks[player];
    if (pick === undefined) {
      this.picks[player] = null;
      this.joinedAt[player] = this.clockMs;
      this.countdownLeft = null;
    } else if (within(at, JOIN.ring)) {
      if (this.clockMs - (this.joinedAt[player] ?? 0) < JOIN.leaveGraceMs) return;
      delete this.picks[player];
      this.countdownLeft = null;
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
    const seconds = this.countdownSeconds();
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

  private buildPanel({ player, edge, color, colorCss, tex }: SeatDef): Panel {
    // P1's panel = P2's layout rotated 180° about the field centre: a
    // container at (W, H) turned 180° maps local (x, y) to (W − x, H − y),
    // the same map as seatPoint.
    const root = edge === 'top'
      ? this.add.container(GAME_WIDTH, GAME_HEIGHT).setAngle(180)
      : this.add.container(0, 0);
    /** A Graphics at (x, y) with the seat-colour outline of radius r. */
    const outlined = (x: number, y: number, r: number) => {
      const g = this.add.graphics({ x, y });
      g.lineStyle(STROKES.replay.width, color, 1);
      g.strokeCircle(0, 0, r);
      return g;
    };

    // Join ring: the seat's colour round a big rocket glyph.
    const { ring: r } = JOIN;
    const rocket = this.add.image(0, 0, tex).setScale(2.6);
    const ring = this.add.container(r.x, r.y, [outlined(0, 0, r.r), rocket]);

    // Easy: ∞ drawn as a lemniscate, so it never depends on the font's glyphs.
    const easy = outlined(JOIN.easy.x, JOIN.easy.y, JOIN.easy.r);
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
    const normal = outlined(JOIN.normal.x, JOIN.normal.y, JOIN.normal.r);
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
    return { player, edge, ring, easy, normal, countdown };
  }
}
