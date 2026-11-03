/**
 * harness.spec.ts — guards the harness itself. The console gate lives on the
 * `test` that ./helpers.ts exports, so a spec that takes `test` from
 * '@playwright/test' instead would silently run its cases ungated.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './helpers';

test('every spec imports test from ./helpers (the console gate)', () => {
  const dir = test.info().project.testDir;
  const bypassing = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .filter((f) => /from\s+['"]@playwright\/test['"]/.test(readFileSync(join(dir, f), 'utf8')));
  expect(bypassing).toEqual([]);
});
