export type LocalDate = string;
export type IsoDateTime = string;

/**
 * A bounded estimate. A missing measurement is represented by `null` at the
 * field level; it must never be replaced with a zero-valued range.
 */
export interface NutrientRange {
  readonly low: number;
  readonly estimate: number;
  readonly high: number;
}

export type NutrientField =
  | 'caloriesKcal'
  | 'proteinG'
  | 'carbohydrateG'
  | 'totalFatG'
  | 'saturatedFatG'
  | 'transFatG'
  | 'freeSugarG'
  | 'fiberG'
  | 'sodiumMg'
  | 'fruitVegetableG';

export interface NutrientTotals {
  readonly caloriesKcal: NutrientRange | null;
  readonly proteinG: NutrientRange | null;
  readonly carbohydrateG: NutrientRange | null;
  readonly totalFatG: NutrientRange | null;
  readonly saturatedFatG: NutrientRange | null;
  readonly transFatG: NutrientRange | null;
  readonly freeSugarG: NutrientRange | null;
  readonly fiberG: NutrientRange | null;
  readonly sodiumMg: NutrientRange | null;
  readonly fruitVegetableG: NutrientRange | null;
}

export type FoodCategory =
  | 'fruit'
  | 'vegetable'
  | 'whole_grain'
  | 'refined_grain'
  | 'pulse'
  | 'nuts_seeds'
  | 'lean_protein'
  | 'red_processed_meat'
  | 'dairy'
  | 'oil_fat'
  | 'sweet'
  | 'drink'
  | 'mixed_dish'
  | 'unknown';

export interface FoodComponent {
  readonly name: string;
  readonly category: FoodCategory;
  readonly portionG: NutrientRange | null;
  readonly preparationTags: readonly string[];
}

export type NutrientEvidenceKind =
  | 'single_photo_estimate'
  | 'multi_photo_estimate'
  | 'nutrition_label'
  | 'package_database_match'
  | 'user_confirmed';

export interface NutrientEvidence {
  readonly kind: NutrientEvidenceKind;
  readonly notes: readonly string[];
}

export type NutrientEvidenceMap = Readonly<
  Partial<Record<NutrientField, NutrientEvidence>>
>;

export interface MealAnalysisMetadata {
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly analyzedAt: IsoDateTime;
  readonly assumptions: readonly string[];
}

export interface MealRecord {
  readonly id: string;
  readonly capturedAt: IsoDateTime;
  /** Calendar date in `timeZone`, stored explicitly to avoid regrouping drift. */
  readonly localDate: LocalDate;
  /** IANA time-zone identifier, for example `Asia/Kuala_Lumpur`. */
  readonly timeZone: string;
  readonly nutrients: NutrientTotals;
  readonly components: readonly FoodComponent[];
  readonly evidence: NutrientEvidenceMap;
  readonly analysis: MealAnalysisMetadata;
}

export type PopulationGroup =
  | 'healthy_adult'
  | 'child_or_adolescent'
  | 'pregnant_or_breastfeeding'
  | 'clinical_diet';

export type SpecialCondition =
  | 'kidney_disease'
  | 'heart_failure'
  | 'type_1_diabetes'
  | 'clinician_prescribed_diet'
  | 'competitive_athlete'
  | 'other';

export interface UserProfile {
  readonly id: string;
  readonly populationGroup: PopulationGroup;
  readonly birthDate: LocalDate | null;
  readonly weightKg: number | null;
  readonly dailyEnergyTargetKcal: number | null;
  readonly specialConditions: readonly SpecialCondition[];
}

export interface DiaryDay {
  readonly date: LocalDate;
  /** True only after the user confirms that every consumed meal was recorded. */
  readonly isComplete: boolean;
  readonly meals: readonly MealRecord[];
}

export type ScoreMetricKey =
  | 'fruit_vegetables'
  | 'fiber'
  | 'carbohydrate_share'
  | 'protein_adequacy'
  | 'total_fat_share'
  | 'saturated_fat_share'
  | 'trans_fat_share'
  | 'free_sugar_share'
  | 'sodium';

/**
 * Metrics that photo-only v1 can support without inferring hidden nutrients.
 * Saturated fat, trans fat, free sugar and sodium remain nutrition fields, but
 * they are deliberately excluded from the photo-observable product score.
 */
export type PhotoObservableScoreMetricKey = Exclude<
  ScoreMetricKey,
  'saturated_fat_share' | 'trans_fat_share' | 'free_sugar_share' | 'sodium'
>;

export interface ScoreMetricResult {
  readonly key: ScoreMetricKey;
  readonly weight: number;
  /** Fraction of eligible days with enough source data for this metric. */
  readonly availability: number;
  /** A 0–100 result, or null when the metric has no observations. */
  readonly score: NutrientRange | null;
  readonly observedDayCount: number;
  readonly eligibleDayCount: number;
  readonly standardLabel: string;
}

export type ScoreInvalidReason =
  | 'unsupported_profile'
  | 'day_not_complete'
  | 'insufficient_recording_completeness'
  | 'insufficient_days'
  | 'insufficient_coverage'
  | 'uncertainty_too_wide'
  | 'no_scoreable_data';

export interface DietScoreResult {
  readonly version: string;
  /** Normalized 0–100 score over observed metrics. */
  readonly score: NutrientRange | null;
  /** Weighted fraction of the complete score represented by observed data. */
  readonly coverage: number;
  readonly isValid: boolean;
  readonly invalidReasons: readonly ScoreInvalidReason[];
  readonly metrics: readonly ScoreMetricResult[];
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'rolling_28_valid_days';

export interface Period {
  readonly kind: PeriodKind;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly asOfDate: LocalDate;
}

export interface NutrientFieldAggregate {
  /** Mean daily amount among observed complete days. */
  readonly dailyAverage: NutrientRange | null;
  readonly observedDayCount: number;
  readonly eligibleDayCount: number;
}

export type NutrientFieldAggregates = Readonly<
  Record<NutrientField, NutrientFieldAggregate>
>;

export type EnergyShareField =
  | 'protein'
  | 'carbohydrate'
  | 'totalFat'
  | 'saturatedFat'
  | 'transFat'
  | 'freeSugar';

export interface EnergyShareAggregate {
  /** Percentage of total energy contributed by the nutrient. */
  readonly energyPercent: NutrientRange | null;
  readonly observedDayCount: number;
  readonly eligibleDayCount: number;
}

export type EnergyShareAggregates = Readonly<
  Record<EnergyShareField, EnergyShareAggregate>
>;

export interface PeriodNutritionAggregate {
  readonly nutrients: NutrientFieldAggregates;
  readonly energyShares: EnergyShareAggregates;
  readonly eligibleDayCount: number;
}

export interface PeriodEvaluation {
  readonly period: Period;
  readonly aggregate: PeriodNutritionAggregate;
  readonly score: DietScoreResult;
  readonly elapsedDayCount: number;
  readonly completeDayCount: number;
  readonly recordingCompleteness: number;
  /** Dates used for aggregation; useful for auditing rolling calculations. */
  readonly includedDates: readonly LocalDate[];
}

export const NUTRIENT_FIELDS: readonly NutrientField[] = [
  'caloriesKcal',
  'proteinG',
  'carbohydrateG',
  'totalFatG',
  'saturatedFatG',
  'transFatG',
  'freeSugarG',
  'fiberG',
  'sodiumMg',
  'fruitVegetableG',
] as const;

export const ENERGY_SHARE_FIELDS: readonly EnergyShareField[] = [
  'protein',
  'carbohydrate',
  'totalFat',
  'saturatedFat',
  'transFat',
  'freeSugar',
] as const;

export function emptyNutrientTotals(): NutrientTotals {
  return {
    caloriesKcal: null,
    proteinG: null,
    carbohydrateG: null,
    totalFatG: null,
    saturatedFatG: null,
    transFatG: null,
    freeSugarG: null,
    fiberG: null,
    sodiumMg: null,
    fruitVegetableG: null,
  };
}
