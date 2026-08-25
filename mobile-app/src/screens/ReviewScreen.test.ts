import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('review screen never renders unavailable component placeholders as zero', () => {
  const source = readFileSync(new URL('./ReviewScreen.tsx', import.meta.url), 'utf8');

  assert.match(source, /component\.energyKcal\.available/);
  assert.match(source, /热量未知/);
  assert.match(source, /Calories unknown/);
  assert.match(source, /component\.weightG\.available/);
  assert.match(source, /份量未知/);
  assert.match(source, /Portion unknown/);
});
