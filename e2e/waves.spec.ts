/**
 * waves.spec.ts — the src/waves.ts difficulty model: wave solver and solo target scaling.
 * Shared harness (gotoGame, the fixed-timestep steppers, the console gate):
 * ./helpers.ts.
 */
import { test, expect } from './helpers';
import {
  ASTEROID_KIND,
  breakEvenAccuracy,
  clearDamage,
  requiredDamagePerSec,
  SOLO,
  solveWave,
  waveTarget,
  WAVES,
} from '../src/waves';

test('wave solver uses only standards and three-hit splitters', () => {
  const specs = solveWave(0.75, 0);
  expect(specs.every((spec) => spec.kind === 'standard' || spec.kind === 'splitter')).toBe(true);
  expect(specs.every((spec) => spec.radius === ASTEROID_KIND[spec.kind].radius)).toBe(true);
  const cost = specs.reduce((sum, spec) => sum + clearDamage(spec), 0);
  expect(cost).toBeGreaterThan(specs.length); // a splitter contributes 3, not 2
});

test('solo scales wave targets; two-player targets are untouched', () => {
  // SOLO.requiredScale ships at 1.0, so drive the wiring with an explicit scale.
  for (const w of WAVES) {
    expect(waveTarget(w, 2, 0.5)).toBe(w.required);
    expect(waveTarget(w, 1, 0.5)).toBeCloseTo(w.required * 0.5, 10);
    expect(waveTarget(w, 1)).toBeCloseTo(w.required * SOLO.requiredScale, 10);
    // Break-even is over the seats in play: per unit of required damage/s, one
    // seat must land twice the share two seats do (whatever SOLO's scale is).
    const perRequired = (players: 1 | 2) => breakEvenAccuracy(w, players) / requiredDamagePerSec(w, players);
    expect(requiredDamagePerSec(w, 1)).toBeGreaterThan(0);
    expect(perRequired(1) / perRequired(2)).toBeCloseTo(2, 10);
  }
});
