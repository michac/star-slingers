/** B34 phone-review lab. Tap anywhere to step through the encounter reads:
 * entrance → shield web → one escort down / gap → boss damage → beam → defeat. */
import Phaser from 'phaser';
import { COLORS, CSS, FONTS, STROKES } from '../src/tokens';

const W = 360;
const H = 740;
const CX = 174;
const CY = 370;
const STATES = ['ENTRANCE', 'SHIELD WEB', 'ESCORT DOWN · GAP OPEN', 'BOSS DAMAGE', 'BEAM', 'DEFEAT'] as const;
type State = (typeof STATES)[number];

class BossCommandLab extends Phaser.Scene {
  private art!: Phaser.GameObjects.Graphics;
  private elapsed = 0;
  private stateIndex = 0;

  create(): void {
    this.art = this.add.graphics();
    this.add.text(W / 2, 28, 'B34 · COMMAND SHIP', { fontFamily: FONTS.display, fontSize: '17px', color: CSS.ink }).setOrigin(0.5);
    this.add.text(W / 2, 53, 'tap anywhere · inspect every boss state', { fontFamily: FONTS.body, fontSize: '10px', color: CSS.chromeMuted }).setOrigin(0.5);
    this.add.text(W / 2, 704, 'left-facing ships · shield web · diamond guard loop', { fontFamily: FONTS.body, fontSize: '9px', color: CSS.chromeMuted }).setOrigin(0.5);
    this.input.on('pointerdown', () => { this.stateIndex = (this.stateIndex + 1) % STATES.length; });
  }

  update(_time: number, delta: number): void {
    this.elapsed += delta;
    this.draw(STATES[this.stateIndex]);
  }

  private draw(state: State): void {
    const g = this.art.clear();
    const entering = state === 'ENTRANCE';
    const exposed = state === 'BOSS DAMAGE' || state === 'DEFEAT';
    const bx = entering ? 254 - Math.min(this.elapsed / 1500, 1) * 80 : CX;
    const pulse = 0.72 + 0.28 * Math.sin(this.elapsed * 0.006);
    g.fillStyle(COLORS.sceneBg, 0.8); g.fillRect(0, 76, W, 590);
    this.drawStars(g);
    this.drawBoss(g, bx, CY, exposed, state === 'DEFEAT');
    if (state !== 'DEFEAT') {
      const escorts = this.drawEscorts(g, bx, CY, state === 'ESCORT DOWN · GAP OPEN' || state === 'BOSS DAMAGE');
      this.drawShieldWeb(g, escorts, pulse);
    }
    if (state === 'BEAM') this.drawBeam(g, bx, CY);
    if (state === 'DEFEAT') this.drawBurst(g, bx, CY);
    this.drawGauges(g, exposed, state === 'BEAM');
    this.addStateLabel(state);
  }

  private drawStars(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 30; i++) {
      const x = (i * 73 + 17) % W, y = 94 + ((i * 109) % 540);
      g.fillStyle(COLORS.star, i % 3 === 0 ? 0.65 : 0.3); g.fillCircle(x, y, i % 4 === 0 ? 1.5 : 0.8);
    }
  }

  private drawBoss(g: Phaser.GameObjects.Graphics, x: number, y: number, exposed: boolean, defeated: boolean): void {
    // Same left-facing hull language as the escorts, only scaled up into a flagship.
    const pts = [[-44, 0], [20, -32], [42, -15], [34, 0], [42, 15], [20, 32]];
    const points = pts.map(([px, py]) => new Phaser.Geom.Point(x + px, y + py));
    g.fillStyle(defeated ? COLORS.danger : COLORS.rockFill, defeated ? 0.2 : 1); g.fillPoints(points, true);
    g.lineStyle(4, exposed ? COLORS.accent : COLORS.danger, defeated ? 0.35 : 1); g.strokePoints(points, true);
    // Command bridge, port-side nose, and panel seams intentionally use straight lines only.
    g.fillStyle(exposed ? COLORS.p1 : COLORS.lineDim, 0.9); g.fillTriangle(x - 31, y, x - 3, y - 11, x - 3, y + 11);
    g.lineStyle(2, COLORS.shieldMid, 0.9); g.lineBetween(x - 2, y - 20, x + 13, y); g.lineBetween(x + 13, y, x - 2, y + 20);
    g.fillStyle(COLORS.hullWindow, exposed ? 1 : 0.58); g.fillRect(x + 10, y - 5, 12, 10);
  }

  private drawEscorts(g: Phaser.GameObjects.Graphics, bx: number, by: number, downOne: boolean): { x: number; y: number; live: boolean }[] {
    const escorts: { x: number; y: number; live: boolean }[] = [];
    // The formation rotates but never breathes inward: the web must always
    // clear the flagship, not skim or clip it at a corner of its path.
    const radius = 92;
    for (let i = 0; i < 4; i++) {
      const a = this.elapsed * 0.000345 + i * Math.PI / 2;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      const live = !(downOne && i === 0);
      escorts.push({ x: bx + x, y: by + y, live });
      if (live) this.drawEscort(g, bx + x, by + y);
    }
    return escorts;
  }

  private drawEscort(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    // Every ship's nose points left, toward the station we protect.
    const ship = [new Phaser.Geom.Point(x - 20, y), new Phaser.Geom.Point(x + 9, y - 15), new Phaser.Geom.Point(x + 19, y), new Phaser.Geom.Point(x + 9, y + 15)];
    g.fillStyle(COLORS.rockFill, 1); g.fillPoints(ship, true); g.lineStyle(STROKES.rock.width, COLORS.danger, 1); g.strokePoints(ship, true);
    g.fillStyle(COLORS.p1, 1); g.fillTriangle(x + 1, y - 6, x + 15, y - 18, x + 14, y - 6);
    g.fillStyle(COLORS.p2, 1); g.fillTriangle(x + 1, y + 6, x + 15, y + 18, x + 14, y + 6);
  }

  private drawShieldWeb(g: Phaser.GameObjects.Graphics, escorts: { x: number; y: number; live: boolean }[], pulse: number): void {
    // A link exists only when BOTH neighboring escorts live. The downed escort's
    // two links disappear, so its side of the diamond is a literal shoot-through gap.
    for (let i = 0; i < escorts.length; i++) {
      const a = escorts[i], b = escorts[(i + 1) % escorts.length];
      if (!a.live || !b.live) continue;
      g.lineStyle(7, COLORS.shieldOuter, 0.12 * pulse); g.lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(2.5, COLORS.shieldMid, 0.9 * pulse); g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private drawBeam(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.lineStyle(7, COLORS.danger, 0.38); g.lineBetween(x - 34, y, 20, y);
    g.lineStyle(2, COLORS.ink, 0.95); g.strokePoints([new Phaser.Geom.Point(x - 34, y), new Phaser.Geom.Point(118, y - 8), new Phaser.Geom.Point(70, y + 7), new Phaser.Geom.Point(20, y)], false);
  }

  private drawBurst(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.elapsed * 0.001;
      const d = 44 + (i % 3) * 13;
      g.fillStyle(i % 2 ? COLORS.accent : COLORS.danger, 0.75);
      g.fillTriangle(x + Math.cos(a) * d, y + Math.sin(a) * d, x + Math.cos(a + 0.18) * (d + 18), y + Math.sin(a + 0.18) * (d + 18), x + Math.cos(a - 0.18) * (d + 18), y + Math.sin(a - 0.18) * (d + 18));
    }
  }

  private drawGauges(g: Phaser.GameObjects.Graphics, exposed: boolean, firing: boolean): void {
    const bar = (x: number, color: number, fill: number) => {
      g.lineStyle(2, COLORS.chromeMuted, 0.8); g.strokeRect(x, 255, 15, 230);
      g.fillStyle(color, 0.9); g.fillRect(x + 3, 482 - 224 * fill, 9, 224 * fill);
    };
    bar(281, COLORS.health, exposed ? 0.62 : 1);
    bar(315, COLORS.danger, firing ? 1 : exposed ? 0 : 0.56);
  }

  private addStateLabel(state: State): void {
    const existing = this.children.getByName('state-label') as Phaser.GameObjects.Text | null;
    if (existing) existing.setText(state);
    else this.add.text(W / 2, 642, state, { fontFamily: FONTS.display, fontSize: '13px', color: CSS.accent }).setName('state-label').setOrigin(0.5);
  }
}

const ready = document.fonts?.load('400 16px "Audiowide"') ?? Promise.resolve([]);
ready.catch(() => undefined).then(() => new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: COLORS.sceneBg, scale: { width: W, height: H, mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [BossCommandLab] }));
