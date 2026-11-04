/**
 * UpgradeDrop (#26) — a popped boss's two upgrade pods. Any boss wave can call
 * it: the WaveDirector's `bossDrop` seam hands the scene the ended wave, and
 * the scene starts a drop with that boss's pair (`BOSS_DROPS` in waves.ts).
 *
 *   start → live (bobbing; blinking for the last PODS.blinkMs) → fading → done()
 *
 * Each live seat takes ONE pod per drop, with a FIRE round (the scene's pod
 * collider decides what counts, via canPick); taking one doesn't remove it for
 * the other seat, and a seat that has picked wears its colour ring on that pod.
 * The pods leave once every live seat has picked (solo: the one seat), or
 * after PODS.timeoutMs; a seat that didn't pick keeps what it has. `done()` is
 * called once, after the pods are gone, so whatever follows the drop (the act
 * transition, the next wave's banner) never shares the field with them.
 *
 * Everything runs on update(delta), not tweens or timers, so the e2e fixed
 * timestep drives the bob, the timeout, the blink and the fade. The two pod
 * sprites are created ONCE (parked) so the scene's rocket↔pod collider, built
 * once over `sprites`, never points at a recreated body. Each pod's icon and
 * pick rings sit on its own Graphics, drawn only on start and on a pick, and
 * moved with the pod as it bobs.
 */
import Phaser from 'phaser';
import { PODS } from '../layout';
import { COLORS } from '../tokens';
import { SEAT_DEFS } from '../lineup';
import type { PlayerId } from './Rocket';
import { SPECIALS, type SpecialKind } from './specials';
import { TEX } from './textures';

type DropPhase = 'idle' | 'live' | 'fading';

/** How long the pods take to fade out once they leave (stepped clock). */
const FADE_MS = 300;

export class UpgradeDrop {
  private readonly pods: Phaser.Physics.Arcade.Sprite[];
  /** Per pod (index-aligned): its upgrade icon and pick rings, drawn about
   *  the Graphics' own origin, which place() keeps on the pod. */
  private readonly icons: Phaser.GameObjects.Graphics[];
  private phase: DropPhase = 'idle';
  private kinds: readonly SpecialKind[] = []; // empty while parked
  private seats: readonly PlayerId[] = [];
  /** Which pod each seat took this drop. */
  private picks: Partial<Record<PlayerId, number>> = {};
  /** ms since the drop started (it stops at the timeout or once the pods leave). */
  private elapsed = 0;
  /** ms into the fade, once the pods leave. */
  private fadeMs = 0;
  private done: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.pods = PODS.xs.map((x, i) => {
      const sprite = scene.physics.add.sprite(x, PODS.y, TEX.pod).setDepth(2);
      sprite.setData('podIndex', i); // the collider callback reads which pod
      const body = sprite.body as Phaser.Physics.Arcade.Body;
      body.setAllowGravity(false);
      body.setImmovable(true);
      body.setCircle(PODS.r, sprite.width / 2 - PODS.r, sprite.height / 2 - PODS.r);
      return sprite;
    });
    this.icons = this.pods.map(() => scene.add.graphics().setDepth(2));
    this.park();
  }

  /** Sprites for the one-time rocket↔pod overlap collider. */
  get sprites(): Phaser.Physics.Arcade.Sprite[] {
    return this.pods;
  }

  /** DEV/test read: the drop's phase, kinds, each seat's pick, and the live clock. */
  get state(): { phase: DropPhase; kinds: SpecialKind[]; picks: Partial<Record<PlayerId, number>>; elapsedMs: number; pods: { x: number; y: number; alpha: number }[] } {
    return {
      phase: this.phase,
      kinds: [...this.kinds],
      picks: { ...this.picks },
      elapsedMs: this.elapsed,
      pods: this.pods.map((p) => ({ x: p.x, y: p.y, alpha: p.alpha })),
    };
  }

  /** Put the boss's pods in the field for these live seats. `done` runs once,
   *  after they've gone. */
  start(kinds: readonly [SpecialKind, SpecialKind], seats: readonly PlayerId[], done: () => void): void {
    this.kinds = kinds;
    this.seats = seats;
    this.picks = {};
    this.elapsed = 0;
    this.done = done;
    this.phase = 'live';
    this.setAlpha(1);
    for (const pod of this.pods) {
      pod.setVisible(true).setActive(true);
      (pod.body as Phaser.Physics.Arcade.Body).enable = true;
    }
    this.place();
    this.draw();
  }

  /** Can a FIRE round from `player` take pod `i` now? (First pick per seat
   *  only: once a seat has picked, its rounds pass through the pods.) */
  canPick(player: PlayerId, i: number): boolean {
    return this.phase === 'live' && this.seats.includes(player) && this.picks[player] === undefined && i >= 0 && i < this.kinds.length;
  }

  /** `player` takes pod `i`: returns the upgrade, or null if it can't. The
   *  pods stay for the other seat; once every live seat has picked they leave. */
  pick(player: PlayerId, i: number): SpecialKind | null {
    if (!this.canPick(player, i)) return null;
    this.picks[player] = i;
    if (this.seats.every((seat) => this.picks[seat] !== undefined)) this.leave();
    this.draw();
    return this.kinds[i];
  }

  /** Per frame (the scene's update delta): bob, time out, blink, fade. */
  update(deltaMs: number): void {
    if (this.phase === 'idle') return;
    if (this.phase === 'fading') {
      this.fadeMs += deltaMs;
      this.setAlpha(Math.max(0, 1 - this.fadeMs / FADE_MS));
      if (this.fadeMs >= FADE_MS) this.finish();
      return;
    }
    this.elapsed += deltaMs;
    if (this.elapsed >= PODS.timeoutMs) {
      this.leave();
      return;
    }
    this.place();
    // Blink for the last PODS.blinkMs: "going soon".
    const left = PODS.timeoutMs - this.elapsed;
    const on = left > PODS.blinkMs || Math.floor(left / PODS.blinkPeriodMs) % 2 === 0;
    this.setAlpha(on ? 1 : 0.3);
  }

  /** DEV/test: end a live drop now as if its pods had gone (done() runs), so
   *  a case that only needs to get past a boss wave doesn't wait out the timeout. */
  skip(): void {
    if (this.phase !== 'idle') this.finish();
  }

  /** Take the pods away now without calling done (a wave jump away from the
   *  drop; the director has already dropped its pending steps). */
  cancel(): void {
    this.park();
  }

  /** Stop being pickable and fade out; done() follows the fade. */
  private leave(): void {
    this.phase = 'fading';
    this.fadeMs = 0;
    for (const pod of this.pods) (pod.body as Phaser.Physics.Arcade.Body).enable = false;
  }

  private finish(): void {
    const done = this.done;
    this.park();
    done?.();
  }

  private park(): void {
    this.phase = 'idle';
    this.done = null;
    this.kinds = [];
    this.picks = {};
    for (const pod of this.pods) {
      pod.setVisible(false).setActive(false);
      (pod.body as Phaser.Physics.Arcade.Body).enable = false;
    }
    for (const g of this.icons) g.clear();
    this.setAlpha(1);
  }

  /** The pods and their icons together (blink, fade, reset). */
  private setAlpha(alpha: number): void {
    for (const pod of this.pods) pod.setAlpha(alpha);
    for (const g of this.icons) g.setAlpha(alpha);
  }

  /** Bob each pod (and its icon) about its spot, the two out of phase. */
  private place(): void {
    const w = (Math.PI * 2) / PODS.bobMs;
    this.pods.forEach((pod, i) => {
      pod.setPosition(PODS.xs[i], PODS.y + Math.sin(this.elapsed * w + i * Math.PI) * PODS.bobPx);
      this.icons[i].setPosition(pod.x, pod.y);
    });
  }

  /** Each pod's upgrade icon, plus a ring in each seat's colour round the pod
   *  it took (P1's inside P2's). Only on start and a pick: place() moves them. */
  private draw(): void {
    this.kinds.forEach((kind, i) => {
      const g = this.icons[i].clear();
      SPECIALS[kind].drawIcon(g, 0, 0, PODS.r * PODS.iconFrac, COLORS.ink);
      SEAT_DEFS.forEach(({ player, color }, s) => {
        if (this.picks[player] !== i) return;
        g.lineStyle(2.5, color, 1);
        g.strokeCircle(0, 0, PODS.r + PODS.pickRingGap[s]);
      });
    });
  }
}
