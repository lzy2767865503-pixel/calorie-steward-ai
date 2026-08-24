import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateMeals } from './aggregation';
import {
  addCalendarDays,
  createCalendarPeriod,
  evaluateCalendarPeriod,
  evaluateDiaryDay,
  evaluateRolling28ValidDays,
} from './periods';
import { exactRange } from './ranges';
import { CURRENT_DIET_SCORE } from './standards';
import type {
  DiaryDay,
  MealRecord,
  NutrientTotals,
  UserProfile,
} from './types';

const PROFILE: UserProfile = {
  id: 'profile-1',
  populationGroup: 'healthy_adult',
  birthDate: '1995-01-01',
  weightKg: 70,
  dailyEnergyTargetKcal: 2_000,
  specialConditions: [],
};

function healthyNutrients(
  overrides: Partial<NutrientTotals> = {},
): NutrientTotals {
  return {
    caloriesKcal: exactRange(2_000),
    proteinG: exactRange(60),
    carbohydrateG: exactRange(250),
    totalFatG: exactRange(60),
    saturatedFatG: exactRange(15),
    transFatG: exactRange(0.5),
    freeSugarG: exactRange(25),
    fiberG: exactRange(25),
    sodiumMg: exactRange(1_999),
    fruitVegetableG: exactRange(400),
    ...overrides,
  };
}

function meal(
  localDate: string,
  nutrients: NutrientTotals = healthyNutrients(),
  id = `meal-${localDate}`,
): MealRecord {
  return {
    id,
    capturedAt: `${localDate}T12:00:00.000Z`,
    localDate,
    timeZone: 'Asia/Kuala_Lumpur',
    nutrients,
    components: [],
    evidence: {},
    analysis: {
      providerId: 'test-provider',
      model: 'test-model',
      promptVersion: 'test-v1',
      analyzedAt: `${localDate}T12:00:01.000Z`,
      assumptions: [],
    },
  };
}

function day(
  date: string,
  nutrients: NutrientTotals = healthyNutrients(),
  isComplete = true,
): DiaryDay {
  return { date, isComplete, meals: [meal(date, nutrients)] };
}

function assertNear(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('DietScore v1.1 normalizes only the five photo-observable base weights', () => {
  const weights = Object.values(CURRENT_DIET_SCORE.weights);
  assertNear(weights.reduce((sum, weight) => sum + weight, 0), 100);
  assertNear(
    CURRENT_DIET_SCORE.weights.fruit_vegetables /
      CURRENT_DIET_SCORE.weights.fiber,
    1.5,
  );
  assert.deepEqual(CURRENT_DIET_SCORE.excludedHiddenMetrics, [
    'saturated_fat_share',
    'trans_fat_share',
    'free_sugar_share',
    'sodium',
  ]);
  assert.equal('sodium' in CURRENT_DIET_SCORE.weights, false);
});

test('a complete, fully observed WHO/FAO-aligned day scores 100', () => {
  const evaluation = evaluateDiaryDay(day('2026-08-24'), PROFILE);

  assert.equal(evaluation.score.version, 'DietScore-v1.1');
  assert.equal(evaluation.score.isValid, true);
  assert.equal(evaluation.score.coverage, 1);
  assert.equal(evaluation.score.score?.low, 100);
  assert.equal(evaluation.score.score?.estimate, 100);
  assert.equal(evaluation.score.score?.high, 100);
  assert.deepEqual(
    evaluation.score.metrics.map((metric) => metric.key),
    [
      'fruit_vegetables',
      'fiber',
      'carbohydrate_share',
      'protein_adequacy',
      'total_fat_share',
    ],
  );
});

test('missing nutrients reduce coverage and are never converted to zero', () => {
  const nutrients = healthyNutrients({ fruitVegetableG: null });
  const evaluation = evaluateDiaryDay(day('2026-08-24', nutrients), PROFILE);
  const fruitVegetables = evaluation.score.metrics.find(
    (metric) => metric.key === 'fruit_vegetables',
  );

  assert.equal(fruitVegetables?.score, null);
  assert.equal(fruitVegetables?.availability, 0);
  assertNear(evaluation.score.coverage, 40 / 55);
  assert.equal(evaluation.score.score?.estimate, 100);
  assert.equal(evaluation.score.isValid, true);
});

test('v1.1 still rejects a photo score when observable coverage is below 70%', () => {
  const evaluation = evaluateDiaryDay(
    day(
      '2026-08-24',
      healthyNutrients({
        fruitVegetableG: null,
        fiberG: null,
      }),
    ),
    PROFILE,
  );

  assertNear(evaluation.score.coverage, 30 / 55);
  assert.equal(evaluation.score.score?.estimate, 100);
  assert.equal(evaluation.score.isValid, false);
  assert.ok(
    evaluation.score.invalidReasons.includes('insufficient_coverage'),
  );
});

test('hidden photo-only nutrients stay unknown and never affect DietScore v1.1', () => {
  const hiddenUnknown = evaluateDiaryDay(
    day(
      '2026-08-24',
      healthyNutrients({
        saturatedFatG: null,
        transFatG: null,
        freeSugarG: null,
        sodiumMg: null,
      }),
    ),
    PROFILE,
  );

  assert.equal(hiddenUnknown.score.coverage, 1);
  assert.equal(hiddenUnknown.score.isValid, true);
  assert.equal(hiddenUnknown.score.score?.estimate, 100);
  assert.ok(
    hiddenUnknown.score.metrics.every(
      (metric) =>
        ![
          'saturated_fat_share',
          'trans_fat_share',
          'free_sugar_share',
          'sodium',
        ].includes(metric.key),
    ),
  );
});

test('one meal with a missing nutrient makes the whole daily nutrient total unknown', () => {
  const date = '2026-08-24';
  const totals = aggregateMeals([
    meal(date, healthyNutrients(), 'known-sodium'),
    meal(date, healthyNutrients({ sodiumMg: null }), 'unknown-sodium'),
  ]);

  assert.equal(totals.sodiumMg, null);
  assert.equal(totals.proteinG?.estimate, 120);
});

test('an incomplete diary remains provisional even with a perfect estimate', () => {
  const evaluation = evaluateDiaryDay(
    day('2026-08-24', healthyNutrients(), false),
    PROFILE,
  );

  assert.equal(evaluation.score.isValid, false);
  assert.ok(evaluation.score.invalidReasons.includes('day_not_complete'));
  assert.equal(evaluation.score.score?.estimate, 100);
});

test('a nutrient-poor pattern receives a materially lower deterministic score', () => {
  const poor = healthyNutrients({
    proteinG: exactRange(35),
    carbohydrateG: exactRange(100),
    totalFatG: exactRange(120),
    saturatedFatG: exactRange(50),
    transFatG: exactRange(3),
    freeSugarG: exactRange(100),
    fiberG: exactRange(5),
    sodiumMg: exactRange(5_000),
    fruitVegetableG: exactRange(100),
  });
  const evaluation = evaluateDiaryDay(day('2026-08-24', poor), PROFILE);

  assert.ok((evaluation.score.score?.estimate ?? 100) < 65);
  assert.equal(evaluation.score.coverage, 1);
});

test('a wide AI interval is surfaced and fails the single-score validity gate', () => {
  const uncertain = healthyNutrients({
    fruitVegetableG: { low: 0, estimate: 400, high: 800 },
    fiberG: { low: 0, estimate: 25, high: 50 },
  });
  const evaluation = evaluateDiaryDay(day('2026-08-24', uncertain), PROFILE);

  assert.equal(evaluation.score.isValid, false);
  assert.ok(
    evaluation.score.invalidReasons.includes('uncertainty_too_wide'),
  );
  assert.ok(
    (evaluation.score.score?.high ?? 0) -
      (evaluation.score.score?.low ?? 0) >
      20,
  );
});

test('week score is recomputed from raw records instead of averaging daily scores', () => {
  const first = day(
    '2026-08-24',
    healthyNutrients({ fruitVegetableG: exactRange(0) }),
  );
  const second = day(
    '2026-08-25',
    healthyNutrients({ fruitVegetableG: exactRange(800) }),
  );
  const firstScore = evaluateDiaryDay(first, PROFILE).score.score?.estimate;
  const secondScore = evaluateDiaryDay(second, PROFILE).score.score?.estimate;
  const period = createCalendarPeriod('week', '2026-08-25', '2026-08-25');
  const weekly = evaluateCalendarPeriod([first, second], PROFILE, period);

  if (firstScore === undefined || secondScore === undefined) {
    assert.fail('Expected both daily scores to be available.');
  }
  assert.ok(((firstScore ?? 0) + (secondScore ?? 0)) / 2 < 100);
  assert.equal(
    weekly.aggregate.nutrients.fruitVegetableG.dailyAverage?.estimate,
    400,
  );
  assert.equal(weekly.score.score?.estimate, 100);
  assert.equal(weekly.score.isValid, true);
});

test('period field availability reflects missing days without treating them as zero', () => {
  const first = day('2026-08-24');
  const second = day(
    '2026-08-25',
    healthyNutrients({ sodiumMg: null }),
  );
  const period = createCalendarPeriod('week', '2026-08-25', '2026-08-25');
  const weekly = evaluateCalendarPeriod([first, second], PROFILE, period);
  assert.equal(
    weekly.aggregate.nutrients.sodiumMg.dailyAverage?.estimate,
    1_999,
  );
  assert.equal(
    weekly.aggregate.nutrients.sodiumMg.observedDayCount,
    1,
  );
  assert.equal(weekly.score.metrics.some((metric) => metric.key === 'sodium'), false);
  assertNear(weekly.score.coverage, 1);
  assert.equal(weekly.score.score?.estimate, 100);
});

test('day, ISO week, leap-year month, and year periods use stable calendar bounds', () => {
  assert.deepEqual(
    createCalendarPeriod('day', '2024-02-29', '2024-02-29'),
    {
      kind: 'day',
      startDate: '2024-02-29',
      endDate: '2024-02-29',
      asOfDate: '2024-02-29',
    },
  );
  assert.deepEqual(
    createCalendarPeriod('week', '2024-02-29', '2024-02-29'),
    {
      kind: 'week',
      startDate: '2024-02-26',
      endDate: '2024-03-03',
      asOfDate: '2024-02-29',
    },
  );
  assert.deepEqual(
    createCalendarPeriod('month', '2024-02-29', '2024-02-29'),
    {
      kind: 'month',
      startDate: '2024-02-01',
      endDate: '2024-02-29',
      asOfDate: '2024-02-29',
    },
  );
  assert.deepEqual(
    createCalendarPeriod('year', '2024-02-29', '2024-02-29'),
    {
      kind: 'year',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      asOfDate: '2024-02-29',
    },
  );
});

test('rolling score selects the latest 28 valid days and re-aggregates raw meals', () => {
  const start = '2026-07-26';
  const days = Array.from({ length: 30 }, (_, index) =>
    day(addCalendarDays(start, index)),
  );
  const asOf = addCalendarDays(start, 29);
  const rolling = evaluateRolling28ValidDays(days, PROFILE, asOf);

  assert.equal(rolling.includedDates.length, 28);
  assert.equal(rolling.includedDates[0], addCalendarDays(start, 2));
  assert.equal(rolling.includedDates.at(-1), asOf);
  assert.equal(rolling.aggregate.eligibleDayCount, 28);
  assert.equal(rolling.score.isValid, true);
  assert.equal(rolling.score.score?.estimate, 100);
});

test('rolling score requires at least seven individually valid days', () => {
  const start = '2026-08-19';
  const days = Array.from({ length: 6 }, (_, index) =>
    day(addCalendarDays(start, index)),
  );
  const rolling = evaluateRolling28ValidDays(
    days,
    PROFILE,
    addCalendarDays(start, 5),
  );

  assert.equal(rolling.score.isValid, false);
  assert.ok(rolling.score.invalidReasons.includes('insufficient_days'));
});

test('clinical or non-adult profiles do not receive a valid general-adult score', () => {
  const clinicalProfile: UserProfile = {
    ...PROFILE,
    populationGroup: 'clinical_diet',
    specialConditions: ['kidney_disease'],
  };
  const evaluation = evaluateDiaryDay(day('2026-08-24'), clinicalProfile);

  assert.equal(evaluation.score.isValid, false);
  assert.ok(evaluation.score.invalidReasons.includes('unsupported_profile'));
});
