import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidRange,
  nutrientBindValues,
  nutrientsToColumnObject,
  readNutrients,
} from "./rowMappers";
import type { StoredNutrientTotals } from "./types";

const nutrients: StoredNutrientTotals = {
  caloriesKcal: { low: 420, estimate: 500, high: 610 },
  proteinG: { low: 20, estimate: 25, high: 31 },
  carbohydrateG: null,
  totalFatG: null,
  saturatedFatG: null,
  transFatG: null,
  freeSugarG: null,
  fiberG: null,
  sodiumMg: { low: 300, estimate: 440, high: 610 },
  fruitVegetableG: null,
};

test("nutrient row mapping preserves missing evidence as null", () => {
  const row = nutrientsToColumnObject(nutrients);
  const mapped = readNutrients(row);
  assert.deepEqual(mapped, nutrients);
  assert.equal(mapped.carbohydrateG, null);
});

test("nutrient bind order always has three values per supported nutrient", () => {
  const values = nutrientBindValues(nutrients);
  assert.equal(values.length, 30);
  assert.deepEqual(values.slice(0, 6), [420, 500, 610, 20, 25, 31]);
  assert.deepEqual(values.slice(6, 9), [null, null, null]);
});

test("invalid or partially populated estimates fail closed", () => {
  assert.throws(
    () => assertValidRange({ low: 10, estimate: 8, high: 12 }),
    /low <= estimate/,
  );
  const row = nutrientsToColumnObject(nutrients);
  row.carbohydrate_g_low = 1;
  assert.throws(() => readNutrients(row), /partially populated/);
});

