/**
 * ActTransition (#29) — the colony fleet's flyby between acts. When an act's
 * last wave (its boss) is cleared, the WaveDirector's `actTransition` seam
 * hands control here:
 *
 *   idle → leadIn → out → in → idle (done)
 *
 * leadIn waits ACT_TRANSITION.leadInMs AND until restoreAll's staggered
 * rebuild has shown every ship and its regrow cue has settled, so the whole
 * fleet takes off with every shield up. `out` flies it right, speeding up, until its bubbles are past the right
 * edge; it wraps to just off the left edge, and `in` eases it back into its
 * slots. The starfield rushes with it: its speed scale climbs to starRush
 * over `out` and settles back to cruise over `in`.
 *
 * Driven by update(delta) from the scene, not tweens, so the e2e suite's
 * stepped clock advances it (tweens run on wall-clock time). It runs with the
 * field empty (the director only calls it between waves) and needs no input.
 */
import Phaser from 'phaser';
import { ACT_TRANSITION, STARFIELD } from '../layout';
import type { Act } from '../waves';
import type { Fleet } from './Fleet';
import type { Starfield } from './Starfield';
import { sfx } from '../sfx';

export type TransitionPhase = 'idle' | 'leadIn' | 'out' | 'in';

const { In: easeIn, Out: easeOut } = Phaser.Math.Easing.Quadratic;
const { Linear: lerp } = Phaser.Math;
const CRUISE = STARFIELD.speedScale;

export class ActTransition {
  private phaseState: TransitionPhase = 'idle';
  /** ms into the current phase. */
  private elapsed = 0;
  private done: (() => void) | null = null;
  /** Every flyby started, as 'from-to' ('1-2'), for the e2e suite. */
  readonly flights: string[] = [];

  constructor(
    private readonly fleet: Fleet,
    private readonly starfield: Starfield
  ) {}

  get phase(): TransitionPhase {
    return this.phaseState;
  }

  /** Start the flyby from act `from` to act `to`; `done` runs when the fleet
   *  is back in its slots and the stars are at cruise. A flight already in
   *  progress is cancelled first (fleet home, its done dropped). */
  start(from: Act, to: Act, done: () => void): void {
    this.cancel();
    this.flights.push(`${from}-${to}`);
    this.done = done;
    this.enter('leadIn');
  }

  update(deltaMs: number): void {
    if (this.phaseState === 'idle') return;
    this.elapsed += deltaMs;
    const T = ACT_TRANSITION;
    switch (this.phaseState) {
      case 'leadIn':
        if (this.elapsed >= T.leadInMs && !this.fleet.restoring) {
          this.enter('out');
          sfx.play('flyby'); // its engine swell spans the out and in legs (#3)
        }
        return;
      case 'out': {
        const p = Math.min(1, this.elapsed / T.outMs);
        this.fleet.setOffsetX(lerp(0, T.exitX, easeIn(p)));
        this.starfield.setSpeedScale(lerp(CRUISE, T.starRush, p));
        if (p >= 1) {
          // Wrap: off the right edge, straight to just off the left one.
          this.enter('in');
          this.fleet.setOffsetX(T.entryX);
        }
        return;
      }
      case 'in': {
        const p = Math.min(1, this.elapsed / T.inMs);
        const e = easeOut(p);
        this.fleet.setOffsetX(lerp(T.entryX, 0, e));
        this.starfield.setSpeedScale(lerp(T.starRush, CRUISE, e));
        if (p >= 1) this.finish();
        return;
      }
    }
  }

  /** DEV/test: end the flyby now, as if it had played out (calls done). */
  skip(): void {
    if (this.phaseState !== 'idle') this.finish();
  }

  /** Stop a flyby without finishing it (a wave jump): the fleet snaps home,
   *  the stars return to cruise, and done never runs. */
  cancel(): void {
    this.done = null;
    this.finish();
  }

  private enter(phase: TransitionPhase): void {
    this.phaseState = phase;
    this.elapsed = 0;
  }

  /** Back to idle with the fleet home and the stars at cruise, then run done (if any). */
  private finish(): void {
    const done = this.done;
    this.done = null;
    this.enter('idle');
    this.fleet.setOffsetX(0);
    this.starfield.setSpeedScale(CRUISE);
    done?.();
  }
}
