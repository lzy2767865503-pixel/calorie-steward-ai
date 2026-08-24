import assert from 'node:assert/strict';
import test from 'node:test';

import { AiProviderError } from './errors';
import { normalizeMealAnalysisPayload } from './normalization';
import { assertRecordableMealAnalysis, validateMealAnalysis } from './validation';

function looseMeal(energy: string = '280') {
  return {
    status: 'ok',
    mealName: 'Chicken rice',
    provider_note: 'extra fields are ignored',
    foods: [
      {
        food: 'Chicken rice',
        cooking_method: 'steamed and roasted',
        grams: '180',
        calories: energy,
        protein: '20',
        carbs: '40',
        fat: '10',
      },
    ],
    nutrition: {
      calories: energy,
      protein: '20',
      carbs: '40',
      fat: '10',
      sodium_mg: {
        available: true,
        value: 900,
        lower: 600,
        upper: 1200,
        confidence: 0.9,
      },
    },
    confidence: {
      image: 85,
      identification: 0.8,
      portion: 0.45,
      nutrition: 90,
    },
  };
}

test('normalization accepts common provider aliases and numeric strings', () => {
  const normalized = normalizeMealAnalysisPayload(looseMeal());
  const result = validateMealAnalysis(normalized, 'openai_chat_compatible');

  assert.equal(result.status, 'ok');
  assert.equal(result.meal_name, 'Chicken rice');
  assert.equal(result.components.length, 1);
  assert.equal(result.totals.energy_kcal.value, 280);
  assert.ok(result.totals.energy_kcal.lower < 280);
  assert.ok(result.totals.energy_kcal.upper > 280);
  assert.equal(result.totals.sodium_mg.available, false);
  assert.equal(result.quality.data_coverage, 0.4);
  assert.ok(
    result.quality.uncertainties.some((item) => item.includes('保守规范化')),
  );
});

test('meal normalization fallbacks follow the requested English locale', () => {
  const normalized = normalizeMealAnalysisPayload(
    {
      status: 'ok',
      foods: [{ grams: 100, calories: 180, protein: 8, carbs: 22, fat: 7 }],
      nutrition: { calories: 180, protein: 8, carbs: 22, fat: 7 },
    },
    'en-US',
  ) as { meal_name: string; components: Array<{ name: string }>; quality: { uncertainties: string[] } };

  assert.equal(normalized.meal_name, 'Unnamed food');
  assert.equal(normalized.components[0]?.name, 'Unnamed food');
  assert.ok(normalized.quality.uncertainties.some((item) => item.includes('conservatively normalized')));
  assert.doesNotMatch(JSON.stringify(normalized), /未命名|保守规范化/);
});

test('normalization does not hide impossible negative nutrition', () => {
  assert.throws(
    () =>
      validateMealAnalysis(
        normalizeMealAnalysisPayload(looseMeal('-20')),
        'openai_chat_compatible',
      ),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'SEMANTIC_INVALID',
  );
});

test('non-food aliases can never be promoted by component or calorie fields', () => {
  const normalized = normalizeMealAnalysisPayload({
    status: 'no_food',
    foods: [{ food: 'hallucinated item', calories: 100 }],
    nutrition: { calories: 100 },
  });
  const result = validateMealAnalysis(normalized, 'openai_chat_compatible');

  assert.equal(result.status, 'not_food');
  assert.throws(
    () => assertRecordableMealAnalysis(result, 'openai_chat_compatible'),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'NOT_FOOD',
  );
});

test('missing or unknown status stays unquantifiable despite calorie fields', () => {
  for (const status of [undefined, 'mystery']) {
    const normalized = normalizeMealAnalysisPayload({
      status,
      foods: [{ food: 'ambiguous item', calories: 100 }],
      nutrition: { calories: 100 },
    });
    const result = validateMealAnalysis(normalized, 'openai_chat_compatible');
    assert.equal(result.status, 'unquantifiable');
    assert.throws(
      () => assertRecordableMealAnalysis(result, 'openai_chat_compatible'),
      (error: unknown) =>
        error instanceof AiProviderError && error.code === 'UNQUANTIFIABLE',
    );
  }
});

test('explicit non-food and retake signals override an optimistic ok status', () => {
  for (const payload of [
    { ...looseMeal(), contains_food: 'false' },
    { ...looseMeal(), no_food: 1 },
  ]) {
    const result = validateMealAnalysis(
      normalizeMealAnalysisPayload(payload),
      'openai_chat_compatible',
    );
    assert.equal(result.status, 'not_food');
  }

  for (const retakeSignal of ['true', 1]) {
    const payload = looseMeal();
    payload.confidence = {
      ...payload.confidence,
      needs_retake: retakeSignal,
    } as typeof payload.confidence;
    const result = validateMealAnalysis(
      normalizeMealAnalysisPayload(payload),
      'openai_chat_compatible',
    );
    assert.equal(result.status, 'needs_retake');
    assert.equal(result.quality.retake_recommended, true);
  }
});
