import type { PhotoObservableScoreMetricKey } from './types';

export const WHO_FAO_ADULT_STANDARD = {
  version: 'WHO-FAO-adult-2026-v1',
  scope: 'General healthy adults; not a clinical or individualized diet prescription.',
  fruitVegetablesGPerDayMinimum: 400,
  fiberGPerDayMinimum: 25,
  carbohydrateEnergyPercent: { minimum: 45, maximum: 75 },
  totalFatEnergyPercent: { minimum: 15, maximum: 30 },
  saturatedFatEnergyPercentMaximum: 10,
  transFatEnergyPercentMaximum: 1,
  freeSugarEnergyPercent: { maximum: 10, preferredMaximum: 5 },
  sodiumMgPerDayMaximum: 2_000,
  saltGPerDayMaximum: 5,
  proteinGPerKgPerDaySafeLevel: 0.83,
  proteinEnergyPercentFallbackMinimum: 10,
  references: {
    healthyDiet:
      'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    carbohydrate:
      'https://www.who.int/publications/i/item/9789240073593',
    totalFat:
      'https://www.who.int/publications/i/item/9789240073654/',
    saturatedAndTransFat:
      'https://www.who.int/publications/i/item/9789240073630',
    freeSugar:
      'https://www.who.int/publications/i/item/9789241549028',
    sodium:
      'https://iris.who.int/bitstream/handle/10665/77985/9789241504836_eng.pdf',
    protein:
      'https://iris.who.int/bitstream/handle/10665/43411/WHO_TRS_935_eng.pdf',
  },
} as const;

/**
 * The thresholds come from WHO/FAO sources. The weights and interpolation
 * rules are product policy and must not be presented as a WHO-issued score.
 */
const PHOTO_OBSERVABLE_BASE_WEIGHTS = {
  fruit_vegetables: 15,
  fiber: 10,
  carbohydrate_share: 10,
  protein_adequacy: 10,
  total_fat_share: 10,
} satisfies Readonly<Record<PhotoObservableScoreMetricKey, number>>;

const PHOTO_OBSERVABLE_BASE_WEIGHT_TOTAL = Object.values(
  PHOTO_OBSERVABLE_BASE_WEIGHTS,
).reduce((sum, weight) => sum + weight, 0);

/**
 * DietScore v1.1 is a photo-observable product score. It preserves the
 * relative weights of the five v1.0 metrics that a validated photo-only meal
 * can support, then normalizes those 55 base points to 100. Hidden nutrients
 * stay unknown and do not receive either zeroes or assumed-good scores.
 */
export const DIET_SCORE_V1_1 = {
  version: 'DietScore-v1.1',
  methodology: 'photo_observable' as const,
  minimumCoverage: 0.7,
  maximumScoreIntervalWidth: 20,
  minimumRollingValidDays: 7,
  maximumRollingValidDays: 28,
  minimumRecordingCompleteness: 0.7,
  normalizedWeightTotal: 100,
  baseWeightTotal: PHOTO_OBSERVABLE_BASE_WEIGHT_TOTAL,
  weights: Object.fromEntries(
    Object.entries(PHOTO_OBSERVABLE_BASE_WEIGHTS).map(([key, weight]) => [
      key,
      (weight / PHOTO_OBSERVABLE_BASE_WEIGHT_TOTAL) * 100,
    ]),
  ) as Readonly<Record<PhotoObservableScoreMetricKey, number>>,
  excludedHiddenMetrics: [
    'saturated_fat_share',
    'trans_fat_share',
    'free_sugar_share',
    'sodium',
  ] as const,
} as const;

export const CURRENT_DIET_SCORE = DIET_SCORE_V1_1;

/** @deprecated Use CURRENT_DIET_SCORE. Kept as a source-compatibility alias. */
export const DIET_SCORE_V1 = CURRENT_DIET_SCORE;

export const SCORE_METRIC_KEYS = Object.freeze(
  Object.keys(CURRENT_DIET_SCORE.weights) as PhotoObservableScoreMetricKey[],
);

const totalWeight = SCORE_METRIC_KEYS.reduce(
  (sum, key) => sum + CURRENT_DIET_SCORE.weights[key],
  0,
);

if (Math.abs(totalWeight - CURRENT_DIET_SCORE.normalizedWeightTotal) > 1e-9) {
  throw new Error(`DietScore weights must total 100; received ${totalWeight}.`);
}
