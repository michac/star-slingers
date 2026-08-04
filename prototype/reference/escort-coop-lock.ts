/** B33 LOCKED reference: four station-facing ships, each with cyan + amber
 * lock fins. Click/tap a ship to remove cyan then amber; its remaining fin
 * pulses. The game texture/state art in objects/textures.ts matches this. */
import Phaser from 'phaser';
import { COLORS, STROKES } from '../../src/tokens';

const W = 360, H = 740, CX = 180, CY = 370, R = 122;
type Ship = { g: Phaser.GameObjects.Graphics; locks: number; angle: number };

class EscortReference extends Phaser.Scene {
  private ships: Ship[] = [];
  private elapsed = 0;
  create(): void {
    this.add.text(CX, 28, 'B33 · CO-OP ESCORT LOCKS', { fontFamily: 'Audiowide', fontSize: '14px', color: '#fdf4ff' }).setOrigin(.5);
    this.add.text(CX, 49, 'cyan + amber · one hit from each player', { fontFamily: 'Audiowide', fontSize: '9px', color: '#9d7fd6' }).setOrigin(.5);
    const boss = this.add.graphics(); boss.fillStyle(COLORS.rockFill, 1); boss.fillCircle(CX, CY, 40); boss.lineStyle(4, COLORS.danger, 1); boss.strokeCircle(CX, CY, 38);
    for (let i = 0; i < 4; i++) this.ships.push({ g: this.add.graphics().setInteractive(new Phaser.Geom.Circle(0, 0, 28), Phaser.Geom.Circle.Contains), locks: 3, angle: i * Math.PI / 2 });
    this.input.on('gameobjectdown', (_p: Phaser.Input.Pointer, g: Phaser.GameObjects.GameObject) => { const ship = this.ships.find(s => s.g === g); if (ship) ship.locks = ship.locks === 3 ? 2 : 0; });
  }
  update(_t: number, dt: number): void {
    this.elapsed += dt;
    for (const ship of this.ships) {
      ship.angle += dt * .00045;
      const x = CX + Math.cos(ship.angle) * R, y = CY + Math.sin(ship.angle) * R;
      ship.g.setPosition(x, y).setRotation(Math.atan2(CY - y, CX - x) + Math.PI / 2).clear();
      ship.g.fillStyle(COLORS.rockFill, 1); ship.g.fillPoints([new Phaser.Geom.Point(0,-23),new Phaser.Geom.Point(20,16),new Phaser.Geom.Point(0,25),new Phaser.Geom.Point(-20,16)], true);
      ship.g.lineStyle(STROKES.rock.width, COLORS.danger, 1); ship.g.strokePoints([new Phaser.Geom.Point(0,-23),new Phaser.Geom.Point(20,16),new Phaser.Geom.Point(0,25),new Phaser.Geom.Point(-20,16)], true);
      ship.g.fillStyle(COLORS.accent, 1); ship.g.fillCircle(0, -2, 5);
      this.fin(ship.g, -1, COLORS.p1, !!(ship.locks & 1), ship.locks === 1);
      this.fin(ship.g, 1, COLORS.p2, !!(ship.locks & 2), ship.locks === 2);
    }
  }
  private fin(g: Phaser.GameObjects.Graphics, side: number, color: number, on: boolean, pulse: boolean): void {
    if (!on) return;
    const a = pulse ? .65 + .35 * Math.sin(this.elapsed * .012) : 1;
    g.fillStyle(color, a); g.fillTriangle(side * 9, 6, side * 25, 20, side * 9, 22);
    g.lineStyle(1.5, 0xffffff, a); g.strokeTriangle(side * 9, 6, side * 25, 20, side * 9, 22);
  }
}
new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: W, height: H, backgroundColor: COLORS.sceneBg, scene: EscortReference, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
