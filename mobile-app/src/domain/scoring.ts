import { mapRangeToScore } from './ranges';
import { CURRENT_DIET_SCORE, WHO_FAO_ADULT_STANDARD } from './standards';
import type {
  DietScoreResult,
  NutrientFieldAggregate,
  NutrientRange,
  PhotoObservableScoreMetricKey,
  PeriodNutritionAggregate,
  ScoreInvalidReason,
  ScoreMetricResult,
  UserProfile,
} from './types';

export interface ScoreEvaluationContext {
  readonly completionKind: 'day' | 'period';
  readonly recordingComplete: boolean;
  readonly minimumEligibleDays: number;
}

interface MetricInput {
  readonly key: PhotoObservableScoreMetricKey;
  readonly value: NutrientRange | null;
  readonly observedDayCount: number;
  readonly eligibleDayCount: number;
  readonly scoreValue: (value: number) => number;
  readonly criticalPoints: readonly number[];
  readonly standardLabel: string;
}

function lowerBoundScore(value: number, target: number): number {
  return Math.min(value / target, 1);
}

function bandScore(value: number, minimum: number, maximum: number): number {
  if (value < minimum) {
    return value / minimum;
  }
  if (value <= maximum) {
    return 1;
  }
  return maximum / value;
}

function availability(observed: number, eligible: number): number {
  if (eligible <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, observed / eligible));
}

function stabilizeScoreBoundary(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 100) < 1e-12) return 100;
  return value;
}

function metricResult(input: MetricInput): ScoreMetricResult {
  const weight = CURRENT_DIET_SCORE.weights[input.key];
  return {
    key: input.key,
    weight,
    availability: availability(
      input.observedDayCount,
      input.eligibleDayCount,
    ),
    score:
      input.value === null
        ? null
        : mapRangeToScore(
            input.value,
            input.scoreValue,
            input.criticalPoints,
          ),
    observedDayCount: input.observedDayCount,
    eligibleDayCount: input.eligibleDayCount,
    standardLabel: input.standardLabel,
  };
}

function nutrientMetricInput(
  key: PhotoObservableScoreMetricKey,
  field: NutrientFieldAggregate,
  scoreValue: (value: number) => number,
  criticalPoints: readonly number[],
  standardLabel: string,
): MetricInput {
  return {
    key,
    value: field.dailyAverage,
    observedDayCount: field.observedDayCount,
    eligibleDayCount: field.eligibleDayCount,
    scoreValue,
    criticalPoints,
    standardLabel,
  };
}

function buildMetricInputs(
  aggregate: PeriodNutritionAggregate,
  profile: UserProfile,
): readonly MetricInput[] {
  const standard = WHO_FAO_ADULT_STANDARD;
  const fruitVegetables = aggregate.nutrients.fruitVegetableG;
  const fiber = aggregate.nutrients.fiberG;
  const carbohydrate = aggregate.energyShares.carbohydrate;
  const totalFat = aggregate.energyShares.totalFat;

  if (
    profile.weightKg !== null &&
    (!Number.isFinite(profile.weightKg) || profile.weightKg <= 0)
  ) {
    throw new Error('Profile weightKg must be a positive finite number or null.');
  }

  const protein: MetricInput =
    profile.weightKg === null
      ? {
          key: 'protein_adequacy',
          value: aggregate.energyShares.protein.energyPercent,
          observedDayCount: aggregate.energyShares.protein.observedDayCount,
          eligibleDayCount: aggregate.energyShares.protein.eligibleDayCount,
          scoreValue: (value) =>
            lowerBoundScore(
              value,
              standard.proteinEnergyPercentFallbackMinimum,
            ),
          criticalPoints: [standard.proteinEnergyPercentFallbackMinimum],
          standardLabel: `>=${standard.proteinEnergyPercentFallbackMinimum}% energy (fallback without body weight)`,
        }
      : nutrientMetricInput(
          'protein_adequacy',
          aggregate.nutrients.proteinG,
          (value) =>
            lowerBoundScore(
              value,
              standard.proteinGPerKgPerDaySafeLevel * profile.weightKg!,
            ),
          [standard.proteinGPerKgPerDaySafeLevel * profile.weightKg],
          `>=${standard.proteinGPerKgPerDaySafeLevel} g/kg/day`,
        );

  return [
    nutrientMetricInput(
      'fruit_vegetables',
      fruitVegetables,
      (value) =>
        lowerBoundScore(value, standard.fruitVegetablesGPerDayMinimum),
      [standard.fruitVegetablesGPerDayMinimum],
      `>=${standard.fruitVegetablesGPerDayMinimum} g/day`,
    ),
    nutrientMetricInput(
      'fiber',
      fiber,
      (value) => lowerBoundScore(value, standard.fiberGPerDayMinimum),
      [standard.fiberGPerDayMinimum],
      `>=${standard.fiberGPerDayMinimum} g/day`,
    ),
    {
      key: 'carbohydrate_share',
      value: carbohydrate.energyPercent,
      observedDayCount: carbohydrate.observedDayCount,
      eligibleDayCount: carbohydrate.eligibleDayCount,
      scoreValue: (value) =>
        bandScore(
          value,
          standard.carbohydrateEnergyPercent.minimum,
          standard.carbohydrateEnergyPercent.maximum,
        ),
      criticalPoints: [
        standard.carbohydrateEnergyPercent.minimum,
        standard.carbohydrateEnergyPercent.maximum,
      ],
      standardLabel: `${standard.carbohydrateEnergyPercent.minimum}-${standard.carbohydrateEnergyPercent.maximum}% energy`,
    },
    protein,
    {
      key: 'total_fat_share',
      value: totalFat.energyPercent,
      observedDayCount: totalFat.observedDayCount,
      eligibleDayCount: totalFat.eligibleDayCount,
      scoreValue: (value) =>
        bandScore(
          value,
          standard.totalFatEnergyPercent.minimum,
          standard.totalFatEnergyPercent.maximum,
        ),
      criticalPoints: [
        standard.totalFatEnergyPercent.minimum,
        standard.totalFatEnergyPercent.maximum,
      ],
      standardLabel: `${standard.totalFatEnergyPercent.minimum}-${standard.totalFatEnergyPercent.maximum}% energy`,
    },
  ];
}

function isSupportedProfile(profile: UserProfile): boolean {
  return (
    profile.populationGroup === 'healthy_adult' &&
    profile.specialConditions.length === 0
  );
}

function uniqueReasons(
  reasons: readonly ScoreInvalidReason[],
): readonly ScoreInvalidReason[] {
  return [...new Set(reasons)];
}

export function scoreNutritionAggregate(
  aggregate: PeriodNutritionAggregate,
  profile: UserProfile,
  context: ScoreEvaluationContext,
): DietScoreResult {
  if (
    !Number.isInteger(context.minimumEligibleDays) ||
    context.minimumEligibleDays < 1
  ) {
    throw new Error('minimumEligibleDays must be a positive integer.');
  }

  const metrics = buildMetricInputs(aggregate, profile).map(metricResult);
  let availableWeight = 0;
  let low = 0;
  let estimate = 0;
  let high = 0;

  for (const metric of metrics) {
    if (metric.score === null || metric.availability <= 0) {
      continue;
    }
    const effectiveWeight = metric.weight * metric.availability;
    availableWeight += effectiveWeight;
    low += effectiveWeight * metric.score.low;
    estimate += effectiveWeight * metric.score.estimate;
    high += effectiveWeight * metric.score.high;
  }

  const score: NutrientRange | null =
    availableWeight <= 0
      ? null
      : {
          low: stabilizeScoreBoundary(low / availableWeight),
          estimate: stabilizeScoreBoundary(estimate / availableWeight),
          high: stabilizeScoreBoundary(high / availableWeight),
        };
  const coverage =
    Math.min(
      1,
      availableWeight / CURRENT_DIET_SCORE.normalizedWeightTotal,
    );
  const invalidReasons: ScoreInvalidReason[] = [];

  if (!isSupportedProfile(profile)) {
    invalidReasons.push('unsupported_profile');
  }
  if (!context.recordingComplete) {
    invalidReasons.push(
      context.completionKind === 'day'
        ? 'day_not_complete'
        : 'insufficient_recording_completeness',
    );
  }
  if (aggregate.eligibleDayCount < context.minimumEligibleDays) {
    invalidReasons.push('insufficient_days');
  }
  if (score === null) {
    invalidReasons.push('no_scoreable_data');
  }
  if (coverage < CURRENT_DIET_SCORE.minimumCoverage) {
    invalidReasons.push('insufficient_coverage');
  }
  if (
    score !== null &&
    score.high - score.low > CURRENT_DIET_SCORE.maximumScoreIntervalWidth
  ) {
    invalidReasons.push('uncertainty_too_wide');
  }

  const reasons = uniqueReasons(invalidReasons);
  return {
    version: CURRENT_DIET_SCORE.version,
    score,
    coverage,
    isValid: reasons.length === 0,
    invalidReasons: reasons,
    metrics,
  };
}
