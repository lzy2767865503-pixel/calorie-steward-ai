import { AiProviderError } from './errors';
import {
  AUTH_TYPES,
  COMPONENT_VISIBILITIES,
  MEAL_ANALYSIS_STATUSES,
  NUTRIENT_EVIDENCE_KINDS,
  PHOTO_MIME_TYPES,
  PROVIDER_KINDS,
  REPORT_METRIC_IDS,
  REPORT_METRIC_CLASSIFICATIONS,
  REPORT_PATTERN_KINDS,
  REPORT_PERIODS,
  REPORT_SUGGESTION_CATEGORIES,
  REPORT_TRENDS,
  type DietReportV1,
  type MealAnalysisV1,
  type NutrientEstimate,
  type PhotoInput,
  type ProviderConfig,
  type ProviderCredentials,
  type ProviderKind,
  type ReportContextV1,
  type ReportMetricId,
  type ReportMetricInputV1,
  type ReportSuggestionCategory,
} from './types';

type JsonObject = Record<string, unknown>;

const FORBIDDEN_AUTH_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'origin',
  'referer',
  'transfer-encoding',
]);

function invalid(
  providerKind: ProviderKind,
  code: 'SCHEMA_INVALID' | 'SEMANTIC_INVALID' | 'CONFIG_INVALID',
  path: string,
  detail: string,
): never {
  throw new AiProviderError({
    code,
    providerKind,
    message: `${path}: ${detail}`,
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): JsonObject {
  if (!isObject(value)) {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected an object');
  }
  return value;
}

function exactKeys(
  value: JsonObject,
  expected: readonly string[],
  providerKind: ProviderKind,
  path: string,
): void {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !(key in value));
  const extras = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extras.length > 0) {
    invalid(
      providerKind,
      'SCHEMA_INVALID',
      path,
      `field mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extras.join(', ') || 'none'})`,
    );
  }
}

function finiteNumber(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected a finite number');
  }
  if (value < min || value > max) {
    invalid(providerKind, 'SEMANTIC_INVALID', path, `must be between ${min} and ${max}`);
  }
  return value;
}

function integer(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
  min: number,
  max: number,
): number {
  const parsed = finiteNumber(value, providerKind, path, min, max);
  if (!Number.isInteger(parsed)) {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected an integer');
  }
  return parsed;
}

function booleanAt(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): boolean {
  if (typeof value !== 'boolean') {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected a boolean');
  }
  return value;
}

function stringAt(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
  maxLength = 500,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected a string');
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    invalid(providerKind, 'SEMANTIC_INVALID', path, 'must not be empty');
  }
  if (trimmed.length > maxLength) {
    invalid(providerKind, 'SEMANTIC_INVALID', path, `exceeds ${maxLength} characters`);
  }
  return trimmed;
}

function localeAt(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): string {
  const parsed = stringAt(value, providerKind, path, 40);
  if (/\p{Cc}/u.test(parsed)) {
    invalid(providerKind, 'CONFIG_INVALID', path, 'must not contain control characters');
  }
  let canonical: string;
  try {
    const locales = Intl.getCanonicalLocales(parsed);
    if (locales.length !== 1 || locales[0] === undefined) {
      invalid(providerKind, 'CONFIG_INVALID', path, 'must contain one BCP-47 locale');
    }
    canonical = locales[0];
  } catch {
    invalid(providerKind, 'CONFIG_INVALID', path, 'must be a valid BCP-47 locale');
  }
  if (parsed !== canonical) {
    invalid(providerKind, 'CONFIG_INVALID', path, `must use canonical form ${canonical}`);
  }
  return canonical;
}

function timezoneAt(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): string {
  const parsed = stringAt(value, providerKind, path, 100);
  if (/\p{Cc}/u.test(parsed)) {
    invalid(providerKind, 'CONFIG_INVALID', path, 'must not contain control characters');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: parsed }).format(0);
  } catch {
    invalid(providerKind, 'CONFIG_INVALID', path, 'must be a valid IANA timezone');
  }
  return parsed;
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  providerKind: ProviderKind,
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(providerKind, 'SCHEMA_INVALID', path, `unsupported value: ${String(value)}`);
  }
  return value as T;
}

function stringArray(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) {
    invalid(providerKind, 'SCHEMA_INVALID', path, 'expected an array');
  }
  if (value.length > maxItems) {
    invalid(providerKind, 'SEMANTIC_INVALID', path, `exceeds ${maxItems} entries`);
  }
  return value.map((item, index) =>
    stringAt(item, providerKind, `${path}[${index}]`, maxItemLength),
  );
}

function parseEstimate(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
  upperLimit: number,
): NutrientEstimate {
  const object = objectAt(value, providerKind, path);
  exactKeys(
    object,
    ['available', 'value', 'lower', 'upper', 'confidence', 'evidence'],
    providerKind,
    path,
  );

  const available = booleanAt(object.available, providerKind, `${path}.available`);
  const estimate = finiteNumber(object.value, providerKind, `${path}.value`, 0, upperLimit);
  const lower = finiteNumber(object.lower, providerKind, `${path}.lower`, 0, upperLimit);
  const upper = finiteNumber(object.upper, providerKind, `${path}.upper`, 0, upperLimit);
  const confidence = finiteNumber(
    object.confidence,
    providerKind,
    `${path}.confidence`,
    0,
    1,
  );
  const evidence = enumAt(
    object.evidence,
    NUTRIENT_EVIDENCE_KINDS,
    providerKind,
    `${path}.evidence`,
  );

  if (
    !available &&
    (estimate !== 0 ||
      lower !== 0 ||
      upper !== 0 ||
      confidence !== 0 ||
      evidence !== 'unsupported')
  ) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      path,
      'unavailable estimates must contain zero placeholders and zero confidence',
    );
  }
  if (available && (lower > estimate || estimate > upper)) {
    invalid(providerKind, 'SEMANTIC_INVALID', path, 'requires lower <= value <= upper');
  }
  if (available && confidence === 0) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      `${path}.confidence`,
      'available visual estimates require positive confidence',
    );
  }
  if (available && evidence !== 'visual_estimate') {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      path,
      'photo-only v1 accepts only visual_estimate evidence for available values',
    );
  }
  if (available && lower === upper) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      path,
      'single-photo visual estimates require a non-zero uncertainty interval',
    );
  }
  if (available) {
    const relativeWidth = (upper - lower) / Math.max(estimate, 1);
    const intervalConfidenceCap = Math.min(0.95, 1 / (1 + relativeWidth / 2));
    if (confidence > intervalConfidenceCap + 0.02) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.confidence`,
        'confidence is incompatible with the reported uncertainty interval',
      );
    }
  }

  return { available, value: estimate, lower, upper, confidence, evidence };
}

function assertRatio(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): number {
  return finiteNumber(value, providerKind, path, 0, 1);
}

export function validateMealAnalysis(
  input: unknown,
  providerKind: ProviderKind,
): MealAnalysisV1 {
  const root = objectAt(input, providerKind, '$');
  exactKeys(
    root,
    ['schema_version', 'status', 'meal_name', 'components', 'totals', 'quality'],
    providerKind,
    '$',
  );

  if (root.schema_version !== 'meal_analysis.v1') {
    invalid(providerKind, 'SCHEMA_INVALID', '$.schema_version', 'expected meal_analysis.v1');
  }
  const status = enumAt(root.status, MEAL_ANALYSIS_STATUSES, providerKind, '$.status');
  const mealName = stringAt(
    root.meal_name,
    providerKind,
    '$.meal_name',
    120,
    status !== 'ok',
  );

  if (!Array.isArray(root.components)) {
    invalid(providerKind, 'SCHEMA_INVALID', '$.components', 'expected an array');
  }
  if (root.components.length > 24) {
    invalid(providerKind, 'SEMANTIC_INVALID', '$.components', 'exceeds 24 components');
  }

  const components = root.components.map((rawComponent, index) => {
    const path = `$.components[${index}]`;
    const component = objectAt(rawComponent, providerKind, path);
    exactKeys(
      component,
      [
        'name',
        'preparation',
        'visibility',
        'weight_g',
        'energy_kcal',
        'protein_g',
        'carbohydrate_g',
        'fat_g',
      ],
      providerKind,
      path,
    );
    return {
      name: stringAt(component.name, providerKind, `${path}.name`, 100),
      preparation: stringAt(
        component.preparation,
        providerKind,
        `${path}.preparation`,
        100,
      ),
      visibility: enumAt(
        component.visibility,
        COMPONENT_VISIBILITIES,
        providerKind,
        `${path}.visibility`,
      ),
      weight_g: parseEstimate(component.weight_g, providerKind, `${path}.weight_g`, 5_000),
      energy_kcal: parseEstimate(
        component.energy_kcal,
        providerKind,
        `${path}.energy_kcal`,
        20_000,
      ),
      protein_g: parseEstimate(
        component.protein_g,
        providerKind,
        `${path}.protein_g`,
        2_000,
      ),
      carbohydrate_g: parseEstimate(
        component.carbohydrate_g,
        providerKind,
        `${path}.carbohydrate_g`,
        5_000,
      ),
      fat_g: parseEstimate(component.fat_g, providerKind, `${path}.fat_g`, 2_000),
    };
  });

  const totalsObject = objectAt(root.totals, providerKind, '$.totals');
  const totalKeys = [
    'energy_kcal',
    'protein_g',
    'carbohydrate_g',
    'fat_g',
    'saturated_fat_g',
    'trans_fat_g',
    'fiber_g',
    'free_sugars_g',
    'sodium_mg',
    'fruit_vegetable_g',
  ] as const;
  exactKeys(totalsObject, totalKeys, providerKind, '$.totals');
  const totals = {
    energy_kcal: parseEstimate(
      totalsObject.energy_kcal,
      providerKind,
      '$.totals.energy_kcal',
      20_000,
    ),
    protein_g: parseEstimate(
      totalsObject.protein_g,
      providerKind,
      '$.totals.protein_g',
      2_000,
    ),
    carbohydrate_g: parseEstimate(
      totalsObject.carbohydrate_g,
      providerKind,
      '$.totals.carbohydrate_g',
      5_000,
    ),
    fat_g: parseEstimate(totalsObject.fat_g, providerKind, '$.totals.fat_g', 2_000),
    saturated_fat_g: parseEstimate(
      totalsObject.saturated_fat_g,
      providerKind,
      '$.totals.saturated_fat_g',
      2_000,
    ),
    trans_fat_g: parseEstimate(
      totalsObject.trans_fat_g,
      providerKind,
      '$.totals.trans_fat_g',
      500,
    ),
    fiber_g: parseEstimate(
      totalsObject.fiber_g,
      providerKind,
      '$.totals.fiber_g',
      1_000,
    ),
    free_sugars_g: parseEstimate(
      totalsObject.free_sugars_g,
      providerKind,
      '$.totals.free_sugars_g',
      2_000,
    ),
    sodium_mg: parseEstimate(
      totalsObject.sodium_mg,
      providerKind,
      '$.totals.sodium_mg',
      50_000,
    ),
    fruit_vegetable_g: parseEstimate(
      totalsObject.fruit_vegetable_g,
      providerKind,
      '$.totals.fruit_vegetable_g',
      5_000,
    ),
  };

  for (const [field, estimate] of [
    ['saturated_fat_g', totals.saturated_fat_g],
    ['trans_fat_g', totals.trans_fat_g],
    ['free_sugars_g', totals.free_sugars_g],
    ['sodium_mg', totals.sodium_mg],
  ] as const) {
    if (estimate.available) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `$.totals.${field}`,
        'hidden nutrients are unavailable in photo-only v1 without app-verified external evidence',
      );
    }
  }

  const qualityObject = objectAt(root.quality, providerKind, '$.quality');
  exactKeys(
    qualityObject,
    [
      'image_quality',
      'identification_confidence',
      'portion_confidence',
      'nutrition_confidence',
      'data_coverage',
      'retake_recommended',
      'assumptions',
      'uncertainties',
    ],
    providerKind,
    '$.quality',
  );
  const reportedQuality = {
    image_quality: assertRatio(
      qualityObject.image_quality,
      providerKind,
      '$.quality.image_quality',
    ),
    identification_confidence: assertRatio(
      qualityObject.identification_confidence,
      providerKind,
      '$.quality.identification_confidence',
    ),
    portion_confidence: assertRatio(
      qualityObject.portion_confidence,
      providerKind,
      '$.quality.portion_confidence',
    ),
    nutrition_confidence: assertRatio(
      qualityObject.nutrition_confidence,
      providerKind,
      '$.quality.nutrition_confidence',
    ),
    data_coverage: assertRatio(
      qualityObject.data_coverage,
      providerKind,
      '$.quality.data_coverage',
    ),
    retake_recommended: booleanAt(
      qualityObject.retake_recommended,
      providerKind,
      '$.quality.retake_recommended',
    ),
    assumptions: stringArray(
      qualityObject.assumptions,
      providerKind,
      '$.quality.assumptions',
      12,
      240,
    ),
    uncertainties: stringArray(
      qualityObject.uncertainties,
      providerKind,
      '$.quality.uncertainties',
      12,
      240,
    ),
  };

  const totalEstimates = totalKeys.map((field) => totals[field]);
  const derivedDataCoverage =
    totalEstimates.filter((estimate) => estimate.available).length /
    totalEstimates.length;
  if (Math.abs(reportedQuality.data_coverage - derivedDataCoverage) > 0.05) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      '$.quality.data_coverage',
      `must reflect the available totals fields (${derivedDataCoverage.toFixed(2)})`,
    );
  }

  const availableNutritionEstimates = [
    totals.energy_kcal,
    totals.protein_g,
    totals.carbohydrate_g,
    totals.fat_g,
    totals.fiber_g,
    totals.fruit_vegetable_g,
  ].filter((estimate) => estimate.available);
  const meanEstimateConfidence =
    availableNutritionEstimates.length === 0
      ? 0
      : availableNutritionEstimates.reduce(
          (sum, estimate) => sum + estimate.confidence,
          0,
        ) / availableNutritionEstimates.length;
  const localNutritionConfidenceCap = Math.min(
    reportedQuality.image_quality,
    reportedQuality.identification_confidence,
    reportedQuality.portion_confidence,
    meanEstimateConfidence,
  );
  if (
    reportedQuality.nutrition_confidence >
    localNutritionConfidenceCap + 0.05
  ) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      '$.quality.nutrition_confidence',
      'exceeds the confidence supported by image, identification, portion and nutrient estimates',
    );
  }
  const quality = {
    ...reportedQuality,
    nutrition_confidence: Math.min(
      reportedQuality.nutrition_confidence,
      localNutritionConfidenceCap,
    ),
    data_coverage: derivedDataCoverage,
  };

  if (status === 'ok') {
    if (components.length === 0) {
      invalid(providerKind, 'SEMANTIC_INVALID', '$.components', 'ok requires food components');
    }
    if (!totals.energy_kcal.available) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.totals.energy_kcal',
        'ok requires an available energy estimate',
      );
    }
    if (quality.retake_recommended) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.quality.retake_recommended',
        'status must be needs_retake when a retake is required',
      );
    }
    if (
      quality.image_quality < 0.35 ||
      quality.identification_confidence < 0.35 ||
      quality.portion_confidence < 0.25 ||
      quality.nutrition_confidence < 0.25 ||
      totals.energy_kcal.confidence < 0.25
    ) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.quality',
        'ok is incompatible with low image, identification, portion, energy or nutrition confidence',
      );
    }

    const totalEnergy = totals.energy_kcal.value;
    for (const rule of [
      { field: 'energy_kcal', absolute: 150, ratio: 0.4 },
      { field: 'protein_g', absolute: 20, ratio: 0.4 },
      { field: 'carbohydrate_g', absolute: 30, ratio: 0.4 },
      { field: 'fat_g', absolute: 15, ratio: 0.5 },
    ] as const) {
      const componentEstimates = components.map((component) => component[rule.field]);
      const total = totals[rule.field];
      if (total.available && componentEstimates.every((estimate) => estimate.available)) {
        const summedValue = componentEstimates.reduce(
          (sum, estimate) => sum + estimate.value,
          0,
        );
        const summedLower = componentEstimates.reduce(
          (sum, estimate) => sum + estimate.lower,
          0,
        );
        const summedUpper = componentEstimates.reduce(
          (sum, estimate) => sum + estimate.upper,
          0,
        );
        const tolerance = Math.max(rule.absolute, total.value * rule.ratio);
        if (
          Math.abs(summedValue - total.value) > tolerance ||
          summedLower > total.upper + tolerance ||
          total.lower > summedUpper + tolerance
        ) {
          invalid(
            providerKind,
            'SEMANTIC_INVALID',
            `$.totals.${rule.field}`,
            'component intervals and total interval are materially inconsistent',
          );
        }
      }
    }

    for (const [index, component] of components.entries()) {
      if (
        component.weight_g.available &&
        component.protein_g.available &&
        component.carbohydrate_g.available &&
        component.fat_g.available &&
        component.protein_g.value +
          component.carbohydrate_g.value +
          component.fat_g.value >
          component.weight_g.upper * 1.2 + 5
      ) {
        invalid(
          providerKind,
          'SEMANTIC_INVALID',
          `$.components[${index}]`,
          'macronutrient mass cannot materially exceed component mass',
        );
      }
    }

    if (
      totals.protein_g.available &&
      totals.carbohydrate_g.available &&
      totals.fat_g.available &&
      totalEnergy >= 50
    ) {
      const atwaterEnergy =
        totals.protein_g.value * 4 +
        totals.carbohydrate_g.value * 4 +
        totals.fat_g.value * 9;
      const atwaterDifference = Math.abs(atwaterEnergy - totalEnergy);
      if (atwaterDifference > Math.max(180, totalEnergy * 0.45)) {
        invalid(
          providerKind,
          'SEMANTIC_INVALID',
          '$.totals',
          'energy is materially inconsistent with protein, carbohydrate and fat',
        );
      }
    }

    if (
      totals.fat_g.available &&
      totals.saturated_fat_g.available &&
      totals.saturated_fat_g.upper > totals.fat_g.upper + 0.1
    ) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.totals.saturated_fat_g',
        'saturated fat cannot exceed total fat',
      );
    }
    if (
      totals.fat_g.available &&
      totals.trans_fat_g.available &&
      totals.trans_fat_g.upper > totals.fat_g.upper + 0.1
    ) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.totals.trans_fat_g',
        'trans fat cannot exceed total fat',
      );
    }
    if (
      totals.carbohydrate_g.available &&
      totals.free_sugars_g.available &&
      totals.free_sugars_g.upper > totals.carbohydrate_g.upper + 0.1
    ) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        '$.totals.free_sugars_g',
        'free sugars cannot exceed total carbohydrate',
      );
    }

  } else if (status === 'needs_retake' && !quality.retake_recommended) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      '$.quality.retake_recommended',
      'needs_retake requires retake_recommended=true',
    );
  }

  return {
    schema_version: 'meal_analysis.v1',
    status,
    meal_name: mealName,
    components,
    totals,
    quality,
  };
}

export function assertRecordableMealAnalysis(
  analysis: MealAnalysisV1,
  providerKind: ProviderKind,
): asserts analysis is MealAnalysisV1 & { status: 'ok' } {
  if (analysis.status === 'ok') {
    return;
  }

  const code =
    analysis.status === 'not_food'
      ? 'NOT_FOOD'
      : analysis.status === 'needs_retake'
        ? 'NEEDS_RETAKE'
        : 'UNQUANTIFIABLE';
  throw new AiProviderError({
    code,
    providerKind,
    message:
      analysis.status === 'not_food'
        ? 'The provider did not detect a food meal in the photo.'
        : analysis.status === 'needs_retake'
          ? 'The photo does not support a defensible nutrition estimate; retake it.'
          : 'The meal cannot be quantified from this photo.',
  });
}

const REPORT_METRIC_LABELS: Readonly<
  Record<ReportMetricId, { readonly en: string; readonly zh: string }>
> = {
  energy: { en: 'energy', zh: '热量' },
  protein: { en: 'protein', zh: '蛋白质' },
  carbohydrate: { en: 'carbohydrate', zh: '碳水化合物' },
  fat: { en: 'total fat', zh: '总脂肪' },
  saturated_fat: { en: 'saturated fat', zh: '饱和脂肪' },
  trans_fat: { en: 'trans fat', zh: '反式脂肪' },
  fiber: { en: 'fiber', zh: '膳食纤维' },
  free_sugars: { en: 'free sugars', zh: '游离糖' },
  sodium: { en: 'sodium', zh: '钠' },
  fruit_vegetable: { en: 'fruit and vegetables', zh: '水果和蔬菜' },
  meal_regularity: { en: 'meal regularity', zh: '用餐规律性' },
  data_coverage: { en: 'data coverage', zh: '数据覆盖率' },
  health_score: { en: 'diet score', zh: '饮食得分' },
};

const REPORT_SUGGESTION_CATEGORIES_BY_METRIC: Readonly<
  Record<ReportMetricId, readonly ReportSuggestionCategory[]>
> = {
  energy: ['portion'],
  protein: ['protein', 'portion'],
  carbohydrate: ['whole_grains', 'portion'],
  fat: ['fat_quality', 'portion'],
  saturated_fat: ['fat_quality'],
  trans_fat: ['fat_quality'],
  fiber: ['whole_grains', 'vegetables', 'fruit'],
  free_sugars: ['sugar'],
  sodium: ['sodium'],
  fruit_vegetable: ['vegetables', 'fruit'],
  meal_regularity: ['meal_timing'],
  data_coverage: ['recording_quality'],
  health_score: ['recording_quality'],
};

function compactNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, '');
}

function reportLanguage(locale: string | undefined): 'en' | 'zh' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function deterministicMetricEvidence(
  metric: ReportMetricInputV1,
  language: 'en' | 'zh',
): string {
  const range =
    metric.lower === metric.upper
      ? `${compactNumber(metric.value)} ${metric.unit}`
      : `${compactNumber(metric.lower)}–${compactNumber(metric.upper)} ${metric.unit}`;
  const target =
    metric.target_min_available && metric.target_max_available
      ? `${compactNumber(metric.target_min)}–${compactNumber(metric.target_max)} ${metric.unit}`
      : metric.target_min_available
        ? `${language === 'zh' ? '至少' : 'at least'} ${compactNumber(metric.target_min)} ${metric.unit}`
        : metric.target_max_available
          ? `${language === 'zh' ? '不高于' : 'no more than'} ${compactNumber(metric.target_max)} ${metric.unit}`
          : language === 'zh'
            ? '未设定参考目标'
            : 'no reference target is configured';
  return language === 'zh'
    ? `应用核验的汇总区间为 ${range}；参考为 ${target}。`
    : `The application-validated aggregate range is ${range}; the reference is ${target}.`;
}

function deterministicPatternStatement(
  metric: ReportMetricInputV1,
  language: 'en' | 'zh',
): string {
  const label = REPORT_METRIC_LABELS[metric.metric_id][language];
  const classification = metric.classification;
  if (language === 'zh') {
    if (classification === 'below_target') return `${label}低于参考范围。`;
    if (classification === 'above_target') return `${label}高于参考范围。`;
    if (classification === 'within_target') return `${label}处于参考范围内。`;
    if (classification === 'indeterminate') return `${label}的估计区间跨越参考边界，暂时无法判定。`;
    return `${label}目前没有可用的目标分类。`;
  }
  if (classification === 'below_target') return `${label} is below the reference range.`;
  if (classification === 'above_target') return `${label} is above the reference range.`;
  if (classification === 'within_target') return `${label} is within the reference range.`;
  if (classification === 'indeterminate') {
    return `The estimated ${label} interval crosses a reference boundary, so it is indeterminate.`;
  }
  return `${label} has no usable target classification.`;
}

function deterministicSuggestionAction(
  metric: ReportMetricInputV1,
  language: 'en' | 'zh',
): string {
  const label = REPORT_METRIC_LABELS[metric.metric_id][language];
  if (language === 'zh') {
    if (metric.classification === 'below_target') {
      return `通过日常食物和渐进的份量调整提高${label}，并继续记录。`;
    }
    if (metric.classification === 'above_target') {
      return `减少${label}的主要食物来源或调整份量，并继续记录。`;
    }
    if (metric.classification === 'within_target') {
      return `维持目前与${label}相关的食物选择和份量。`;
    }
    return `先继续完整记录${label}，待估计区间更明确后再调整。`;
  }
  if (metric.classification === 'below_target') {
    return `Increase ${label} gradually through everyday foods and portion adjustments, and keep recording.`;
  }
  if (metric.classification === 'above_target') {
    return `Reduce the main food sources or portions contributing to ${label}, and keep recording.`;
  }
  if (metric.classification === 'within_target') {
    return `Maintain the current food choices and portions related to ${label}.`;
  }
  return `Keep recording ${label} until the estimate interval is clearer before making a change.`;
}

function deterministicReportSummary(
  metrics: readonly ReportMetricInputV1[],
  language: 'en' | 'zh',
  context?: ReportContextV1,
): string {
  const concerns = metrics.filter(
    (metric) =>
      metric.classification === 'below_target' ||
      metric.classification === 'above_target',
  ).length;
  const within = metrics.filter(
    (metric) => metric.classification === 'within_target',
  ).length;
  const uncertain = metrics.length - concerns - within;
  if (language === 'zh') {
    const periodText = context
      ? `本报告涵盖 ${context.logged_days}/${context.expected_days} 个已记录天。`
      : '';
    return `${periodText}应用核验了 ${metrics.length} 项可用汇总指标：${concerns} 项需关注，${within} 项在参考范围内，${uncertain} 项暂时无法明确分类。`;
  }
  const periodText = context
    ? `This report covers ${context.logged_days}/${context.expected_days} logged days. `
    : '';
  return `${periodText}The application validated ${metrics.length} usable aggregate metrics: ${concerns} need attention, ${within} are within range, and ${uncertain} remain indeterminate.`;
}

export function validateDietReport(
  input: unknown,
  providerKind: ProviderKind,
  expectedPeriod: ReportContextV1['period'],
  sourceMetrics: readonly ReportMetricInputV1[],
  sourceContext?: ReportContextV1,
): DietReportV1 {
  const usableMetrics = new Map(
    sourceMetrics
      .filter(
        (metric) =>
          metric.available && metric.coverage > 0 && metric.confidence > 0,
      )
      .map((metric) => [metric.metric_id, metric] as const),
  );
  const root = objectAt(input, providerKind, '$');
  exactKeys(
    root,
    ['schema_version', 'period', 'summary', 'patterns', 'suggestions', 'uncertainty_note'],
    providerKind,
    '$',
  );
  if (root.schema_version !== 'diet_report.v1') {
    invalid(providerKind, 'SCHEMA_INVALID', '$.schema_version', 'expected diet_report.v1');
  }
  const period = enumAt(root.period, REPORT_PERIODS, providerKind, '$.period');
  if (period !== expectedPeriod) {
    invalid(providerKind, 'SEMANTIC_INVALID', '$.period', 'does not match the requested period');
  }
  stringAt(root.summary, providerKind, '$.summary', 1_600);
  stringAt(
    root.uncertainty_note,
    providerKind,
    '$.uncertainty_note',
    800,
  );

  if (!Array.isArray(root.patterns) || root.patterns.length > 10) {
    invalid(providerKind, 'SCHEMA_INVALID', '$.patterns', 'expected at most 10 patterns');
  }
  const language = reportLanguage(sourceContext?.locale);
  const seenPatternMetricIds = new Set<ReportMetricId>();
  const patterns = root.patterns.map((rawPattern, index) => {
    const path = `$.patterns[${index}]`;
    const pattern = objectAt(rawPattern, providerKind, path);
    exactKeys(pattern, ['kind', 'metric_id', 'statement', 'evidence'], providerKind, path);
    const metricId = enumAt(
      pattern.metric_id,
      REPORT_METRIC_IDS,
      providerKind,
      `${path}.metric_id`,
    );
    const sourceMetric = usableMetrics.get(metricId);
    if (sourceMetric === undefined) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.metric_id`,
        'references a metric absent from the aggregate input',
      );
    }
    if (seenPatternMetricIds.has(metricId)) {
      invalid(providerKind, 'SEMANTIC_INVALID', `${path}.metric_id`, 'duplicate report pattern');
    }
    seenPatternMetricIds.add(metricId);
    const kind = enumAt(
      pattern.kind,
      REPORT_PATTERN_KINDS,
      providerKind,
      `${path}.kind`,
    );
    const expectedKind =
      sourceMetric.classification === 'within_target'
        ? 'positive'
        : sourceMetric.classification === 'below_target' ||
            sourceMetric.classification === 'above_target'
          ? 'concern'
          : 'watch';
    if (kind !== expectedKind) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.kind`,
        `must be ${expectedKind} for source classification ${sourceMetric.classification}`,
      );
    }
    stringAt(pattern.statement, providerKind, `${path}.statement`, 500);
    stringAt(pattern.evidence, providerKind, `${path}.evidence`, 500);
    return {
      kind,
      metric_id: metricId,
      statement: deterministicPatternStatement(sourceMetric, language),
      evidence: deterministicMetricEvidence(sourceMetric, language),
    };
  });

  if (!Array.isArray(root.suggestions) || root.suggestions.length > 8) {
    invalid(providerKind, 'SCHEMA_INVALID', '$.suggestions', 'expected at most 8 suggestions');
  }
  const seenSuggestionMetricIds = new Set<ReportMetricId>();
  const suggestions = root.suggestions.map((rawSuggestion, index) => {
    const path = `$.suggestions[${index}]`;
    const suggestion = objectAt(rawSuggestion, providerKind, path);
    exactKeys(
      suggestion,
      ['priority', 'category', 'metric_id', 'action', 'reason'],
      providerKind,
      path,
    );
    const priority = integer(suggestion.priority, providerKind, `${path}.priority`, 1, 3);
    const metricId = enumAt(
      suggestion.metric_id,
      REPORT_METRIC_IDS,
      providerKind,
      `${path}.metric_id`,
    );
    const sourceMetric = usableMetrics.get(metricId);
    if (sourceMetric === undefined) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.metric_id`,
        'references a metric absent from the aggregate input',
      );
    }
    if (seenSuggestionMetricIds.has(metricId)) {
      invalid(providerKind, 'SEMANTIC_INVALID', `${path}.metric_id`, 'duplicate suggestion metric');
    }
    seenSuggestionMetricIds.add(metricId);
    const category = enumAt(
      suggestion.category,
      REPORT_SUGGESTION_CATEGORIES,
      providerKind,
      `${path}.category`,
    );
    if (!REPORT_SUGGESTION_CATEGORIES_BY_METRIC[metricId].includes(category)) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.category`,
        `is not applicable to ${metricId}`,
      );
    }
    stringAt(suggestion.action, providerKind, `${path}.action`, 500);
    stringAt(suggestion.reason, providerKind, `${path}.reason`, 500);
    return {
      priority: priority as 1 | 2 | 3,
      category,
      metric_id: metricId,
      action: deterministicSuggestionAction(sourceMetric, language),
      reason: deterministicMetricEvidence(sourceMetric, language),
    };
  });

  const usableMetricList = [...usableMetrics.values()];
  const coverageText = sourceContext
    ? `${compactNumber(sourceContext.data_coverage * 100)}%`
    : null;
  const uncertaintyNote =
    language === 'zh'
      ? `本报告只基于已记录餐食${coverageText === null ? '' : `，可评分数据覆盖率为 ${coverageText}`}。当估计区间跨越参考目标时，应用不会判定偏高或偏低；本报告不是医疗诊断。`
      : `This report covers logged meals only${coverageText === null ? '' : `, with ${coverageText} scoreable data coverage`}. When an estimate interval crosses a reference target, the application does not classify it as high or low. This is not a medical diagnosis.`;

  return {
    schema_version: 'diet_report.v1',
    period,
    summary: deterministicReportSummary(
      usableMetricList,
      language,
      sourceContext,
    ),
    patterns,
    suggestions,
    uncertainty_note: uncertaintyNote,
  };
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function validateProviderConfig(config: ProviderConfig): URL {
  const rawConfig = objectAt(config, 'custom_contract', 'config');
  const providerKind = PROVIDER_KINDS.includes(rawConfig.kind as ProviderKind)
    ? (rawConfig.kind as ProviderKind)
    : 'custom_contract';
  exactKeys(
    rawConfig,
    [
      'id',
      'displayName',
      'kind',
      'baseUrl',
      'visionModel',
      'reportModel',
      'apiVersion',
      'authType',
      'customAuthHeader',
      'timeoutMs',
      'allowInsecureLocalhost',
    ],
    providerKind,
    'config',
  );
  stringAt(config.id, providerKind, 'config.id', 100);
  stringAt(config.displayName, providerKind, 'config.displayName', 100);
  enumAt(config.kind, PROVIDER_KINDS, providerKind, 'config.kind');
  enumAt(config.authType, AUTH_TYPES, providerKind, 'config.authType');
  stringAt(config.visionModel, providerKind, 'config.visionModel', 200);
  stringAt(config.reportModel, providerKind, 'config.reportModel', 200);
  stringAt(config.apiVersion, providerKind, 'config.apiVersion', 100, true);
  if (/\r|\n/.test(config.apiVersion)) {
    invalid(providerKind, 'CONFIG_INVALID', 'config.apiVersion', 'must not contain line breaks');
  }
  integer(config.timeoutMs, providerKind, 'config.timeoutMs', 3_000, 120_000);
  booleanAt(
    config.allowInsecureLocalhost,
    providerKind,
    'config.allowInsecureLocalhost',
  );

  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    invalid(providerKind, 'CONFIG_INVALID', 'config.baseUrl', 'must be an absolute URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'config.baseUrl',
      'must not include credentials, query parameters or a fragment',
    );
  }
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      config.allowInsecureLocalhost &&
      isLocalhost(url.hostname)
    )
  ) {
    throw new AiProviderError({
      code: 'INSECURE_ENDPOINT',
      providerKind,
      message: 'Provider endpoint must use HTTPS. HTTP is limited to opted-in localhost development.',
    });
  }

  if (config.authType === 'custom-header') {
    const header = stringAt(
      config.customAuthHeader,
      providerKind,
      'config.customAuthHeader',
      100,
    ).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(header) || FORBIDDEN_AUTH_HEADERS.has(header)) {
      invalid(
        providerKind,
        'CONFIG_INVALID',
        'config.customAuthHeader',
        'is not an allowed authentication header',
      );
    }
  } else if (config.customAuthHeader !== null) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'config.customAuthHeader',
      'must be null unless authType is custom-header',
    );
  }

  if (config.kind === 'openai_responses' && config.authType !== 'bearer') {
    invalid(providerKind, 'CONFIG_INVALID', 'config.authType', 'OpenAI Responses requires bearer');
  }
  if (config.kind === 'gemini_interactions' && config.authType !== 'x-goog-api-key') {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'config.authType',
      'Gemini Interactions requires x-goog-api-key',
    );
  }
  if (config.kind === 'anthropic_messages' && config.authType !== 'x-api-key') {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'config.authType',
      'Anthropic Messages requires x-api-key',
    );
  }
  if (config.kind === 'anthropic_messages' && config.apiVersion.length === 0) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'config.apiVersion',
      'Anthropic Messages requires an API version header value',
    );
  }
  return url;
}

export function validateCredentials(
  config: ProviderConfig,
  credentials: ProviderCredentials,
): void {
  const rawCredentials = objectAt(credentials, config.kind, 'credentials');
  exactKeys(rawCredentials, ['secret'], config.kind, 'credentials');
  if (config.authType === 'none') {
    if (credentials.secret !== '') {
      invalid(
        config.kind,
        'CONFIG_INVALID',
        'credentials.secret',
        'must be empty when authentication is disabled',
      );
    }
    return;
  }
  if (
    typeof credentials.secret !== 'string' ||
    credentials.secret.trim().length === 0 ||
    credentials.secret.length > 4_096 ||
    /[\r\n]/.test(credentials.secret)
  ) {
    throw new AiProviderError({
      code: 'AUTH_MISSING',
      providerKind: config.kind,
      message: 'A valid provider credential is required.',
    });
  }
}

export function validatePhotoInput(photo: PhotoInput, providerKind: ProviderKind): void {
  const rawPhoto = objectAt(photo, providerKind, 'photo');
  exactKeys(
    rawPhoto,
    [
      'base64Data',
      'byteLength',
      'mimeType',
      'sanitized',
      'capturedAt',
      'locale',
      'timezone',
    ],
    providerKind,
    'photo',
  );
  enumAt(photo.mimeType, PHOTO_MIME_TYPES, providerKind, 'photo.mimeType');
  integer(photo.byteLength, providerKind, 'photo.byteLength', 16, 5 * 1024 * 1024);
  if (photo.sanitized !== true) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'photo.sanitized',
      'photo must be decoded and re-encoded without source metadata before upload',
    );
  }
  localeAt(photo.locale, providerKind, 'photo.locale');
  timezoneAt(photo.timezone, providerKind, 'photo.timezone');
  stringAt(photo.capturedAt, providerKind, 'photo.capturedAt', 80);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      photo.capturedAt,
    ) ||
    !Number.isFinite(Date.parse(photo.capturedAt)) ||
    !isValidCalendarDate(photo.capturedAt.slice(0, 10))
  ) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'photo.capturedAt',
      'must be an ISO date-time with a timezone',
    );
  }
  if (
    typeof photo.base64Data !== 'string' ||
    photo.base64Data.length === 0 ||
    photo.base64Data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(photo.base64Data)
  ) {
    invalid(providerKind, 'CONFIG_INVALID', 'photo.base64Data', 'must be standard base64');
  }
  const padding = photo.base64Data.endsWith('==')
    ? 2
    : photo.base64Data.endsWith('=')
      ? 1
      : 0;
  const decodedLength = (photo.base64Data.length * 3) / 4 - padding;
  if (decodedLength !== photo.byteLength) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'photo.byteLength',
      'does not match the supplied base64 image',
    );
  }

  const prefix = decodeBase64Prefix(photo.base64Data, 12);
  const signatureMatches =
    (photo.mimeType === 'image/jpeg' && prefix[0] === 0xff && prefix[1] === 0xd8) ||
    (photo.mimeType === 'image/png' &&
      prefix[0] === 0x89 &&
      prefix[1] === 0x50 &&
      prefix[2] === 0x4e &&
      prefix[3] === 0x47 &&
      prefix[4] === 0x0d &&
      prefix[5] === 0x0a &&
      prefix[6] === 0x1a &&
      prefix[7] === 0x0a) ||
    (photo.mimeType === 'image/webp' &&
      prefix[0] === 0x52 &&
      prefix[1] === 0x49 &&
      prefix[2] === 0x46 &&
      prefix[3] === 0x46 &&
      prefix[8] === 0x57 &&
      prefix[9] === 0x45 &&
      prefix[10] === 0x42 &&
      prefix[11] === 0x50);
  if (!signatureMatches) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'photo.base64Data',
      'image signature does not match photo.mimeType',
    );
  }
}

function decodeBase64Prefix(input: string, maxBytes: number): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of input) {
    if (character === '=' || output.length >= maxBytes) {
      break;
    }
    const value = alphabet.indexOf(character);
    if (value < 0) {
      break;
    }
    accumulator = accumulator * 64 + value;
    bitCount += 6;
    while (bitCount >= 8 && output.length < maxBytes) {
      bitCount -= 8;
      output.push(Math.floor(accumulator / 2 ** bitCount) & 0xff);
      accumulator %= 2 ** bitCount;
    }
  }
  return output;
}

function dateOnly(
  value: unknown,
  providerKind: ProviderKind,
  path: string,
): string {
  const parsed = stringAt(value, providerKind, path, 10);
  if (!isValidCalendarDate(parsed)) {
    invalid(providerKind, 'CONFIG_INVALID', path, 'must use YYYY-MM-DD');
  }
  return parsed;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function expectedMetricClassification(args: {
  available: boolean;
  lower: number;
  upper: number;
  targetMinAvailable: boolean;
  targetMin: number;
  targetMaxAvailable: boolean;
  targetMax: number;
  coverage: number;
  confidence: number;
}): ReportMetricInputV1['classification'] {
  if (!args.available || args.coverage === 0 || args.confidence === 0) {
    return 'insufficient_data';
  }
  if (args.targetMinAvailable && args.upper < args.targetMin) {
    return 'below_target';
  }
  if (args.targetMaxAvailable && args.lower > args.targetMax) {
    return 'above_target';
  }
  if (
    (args.targetMinAvailable && args.lower < args.targetMin) ||
    (args.targetMaxAvailable && args.upper > args.targetMax)
  ) {
    return 'indeterminate';
  }
  if (args.targetMinAvailable || args.targetMaxAvailable) {
    return 'within_target';
  }
  return 'no_target';
}

const REPORT_UNITS_BY_METRIC: Readonly<
  Record<ReportMetricId, readonly string[]>
> = {
  energy: ['kcal', 'kcal/day'],
  protein: ['g', 'g/day', '% energy'],
  carbohydrate: ['g', 'g/day', '% energy'],
  fat: ['g', 'g/day', '% energy'],
  saturated_fat: ['g', 'g/day', '% energy'],
  trans_fat: ['g', 'g/day', '% energy'],
  fiber: ['g', 'g/day'],
  free_sugars: ['g', 'g/day', '% energy'],
  sodium: ['mg', 'mg/day'],
  fruit_vegetable: ['g', 'g/day'],
  meal_regularity: ['ratio', 'meals/day', 'days/week'],
  data_coverage: ['ratio', '%'],
  health_score: ['score/100', 'points'],
};

function inclusiveDateCount(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function validateReportPeriodWindow(
  period: ReportContextV1['period'],
  start: string,
  end: string,
  expectedDays: number,
  providerKind: ProviderKind,
): void {
  const dayCount = inclusiveDateCount(start, end);
  if (dayCount !== expectedDays) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'reportContext.expected_days',
      `must equal the inclusive period span (${dayCount})`,
    );
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  if (period === 'day' && dayCount !== 1) {
    invalid(providerKind, 'CONFIG_INVALID', 'reportContext', 'day period must span one day');
  }
  if (period === 'week' && (startDate.getUTCDay() !== 1 || dayCount > 7)) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'reportContext',
      'week period must begin on Monday and span at most seven elapsed days',
    );
  }
  if (
    period === 'month' &&
    (!start.endsWith('-01') || start.slice(0, 7) !== end.slice(0, 7))
  ) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'reportContext',
      'month period must begin on day 01 and remain in one calendar month',
    );
  }
  if (
    period === 'year' &&
    (!start.endsWith('-01-01') || start.slice(0, 4) !== end.slice(0, 4))
  ) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'reportContext',
      'year period must begin on January 01 and remain in one calendar year',
    );
  }
}

function closeEnough(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function validateReportContext(
  context: ReportContextV1,
  providerKind: ProviderKind,
): ReportContextV1 {
  const root = objectAt(context, providerKind, 'reportContext');
  exactKeys(
    root,
    [
      'period',
      'period_start',
      'period_end',
      'locale',
      'timezone',
      'logged_days',
      'expected_days',
      'meal_count',
      'health_score',
      'data_coverage',
      'goal',
      'dietary_preferences',
      'metrics',
      'score_components',
    ],
    providerKind,
    'reportContext',
  );
  const period = enumAt(root.period, REPORT_PERIODS, providerKind, 'reportContext.period');
  const start = dateOnly(root.period_start, providerKind, 'reportContext.period_start');
  const end = dateOnly(root.period_end, providerKind, 'reportContext.period_end');
  if (start > end) {
    invalid(
      providerKind,
      'CONFIG_INVALID',
      'reportContext',
      'period_start must not be after period_end',
    );
  }
  const expectedDays = integer(
    root.expected_days,
    providerKind,
    'reportContext.expected_days',
    1,
    366,
  );
  validateReportPeriodWindow(period, start, end, expectedDays, providerKind);
  const loggedDays = integer(
    root.logged_days,
    providerKind,
    'reportContext.logged_days',
    0,
    expectedDays,
  );
  const mealCount = integer(
    root.meal_count,
    providerKind,
    'reportContext.meal_count',
    0,
    10_000,
  );
  const healthScore = finiteNumber(
    root.health_score,
    providerKind,
    'reportContext.health_score',
    0,
    100,
  );
  const dataCoverage = assertRatio(
    root.data_coverage,
    providerKind,
    'reportContext.data_coverage',
  );
  const locale = localeAt(root.locale, providerKind, 'reportContext.locale');
  const timezone = timezoneAt(root.timezone, providerKind, 'reportContext.timezone');
  const goal = stringAt(root.goal, providerKind, 'reportContext.goal', 300, true);
  const preferences = stringArray(
    root.dietary_preferences,
    providerKind,
    'reportContext.dietary_preferences',
    20,
    100,
  );

  if (!Array.isArray(root.metrics) || root.metrics.length > REPORT_METRIC_IDS.length) {
    invalid(providerKind, 'SCHEMA_INVALID', 'reportContext.metrics', 'invalid metrics array');
  }
  const seenMetricIds = new Set<ReportMetricId>();
  const metrics = root.metrics.map((rawMetric, index) => {
    const path = `reportContext.metrics[${index}]`;
    const metric = objectAt(rawMetric, providerKind, path);
    exactKeys(
      metric,
      [
        'metric_id',
        'unit',
        'available',
        'value',
        'lower',
        'upper',
        'target_min_available',
        'target_min',
        'target_max_available',
        'target_max',
        'trend',
        'coverage',
        'confidence',
        'classification',
      ],
      providerKind,
      path,
    );
    const metricId = enumAt(metric.metric_id, REPORT_METRIC_IDS, providerKind, `${path}.metric_id`);
    if (seenMetricIds.has(metricId)) {
      invalid(providerKind, 'SEMANTIC_INVALID', `${path}.metric_id`, 'duplicate metric');
    }
    seenMetricIds.add(metricId);
    const unit = stringAt(metric.unit, providerKind, `${path}.unit`, 40);
    if (!REPORT_UNITS_BY_METRIC[metricId].includes(unit)) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.unit`,
        `unsupported unit for ${metricId}`,
      );
    }
    const minAvailable = booleanAt(
      metric.target_min_available,
      providerKind,
      `${path}.target_min_available`,
    );
    const maxAvailable = booleanAt(
      metric.target_max_available,
      providerKind,
      `${path}.target_max_available`,
    );
    const targetMin = finiteNumber(
      metric.target_min,
      providerKind,
      `${path}.target_min`,
      0,
      1_000_000,
    );
    const targetMax = finiteNumber(
      metric.target_max,
      providerKind,
      `${path}.target_max`,
      0,
      1_000_000,
    );
    if ((!minAvailable && targetMin !== 0) || (!maxAvailable && targetMax !== 0)) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        path,
        'unavailable target bounds must use zero placeholders',
      );
    }
    if (minAvailable && maxAvailable && targetMin > targetMax) {
      invalid(providerKind, 'SEMANTIC_INVALID', path, 'target_min exceeds target_max');
    }
    const available = booleanAt(metric.available, providerKind, `${path}.available`);
    const value = finiteNumber(metric.value, providerKind, `${path}.value`, 0, 1_000_000);
    const lower = finiteNumber(metric.lower, providerKind, `${path}.lower`, 0, 1_000_000);
    const upper = finiteNumber(metric.upper, providerKind, `${path}.upper`, 0, 1_000_000);
    const coverage = assertRatio(metric.coverage, providerKind, `${path}.coverage`);
    const confidence = assertRatio(metric.confidence, providerKind, `${path}.confidence`);
    if (
      !available &&
      (value !== 0 ||
        lower !== 0 ||
        upper !== 0 ||
        confidence !== 0 ||
        coverage !== 0)
    ) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        path,
        'unavailable metrics require zero value bounds, confidence and coverage',
      );
    }
    if (available && (lower > value || value > upper)) {
      invalid(providerKind, 'SEMANTIC_INVALID', path, 'requires lower <= value <= upper');
    }
    const classification = enumAt(
      metric.classification,
      REPORT_METRIC_CLASSIFICATIONS,
      providerKind,
      `${path}.classification`,
    );
    const expectedClassification = expectedMetricClassification({
      available,
      lower,
      upper,
      targetMinAvailable: minAvailable,
      targetMin,
      targetMaxAvailable: maxAvailable,
      targetMax,
      coverage,
      confidence,
    });
    if (classification !== expectedClassification) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.classification`,
        `expected deterministic classification ${expectedClassification}`,
      );
    }
    return {
      metric_id: metricId,
      unit,
      available,
      value,
      lower,
      upper,
      target_min_available: minAvailable,
      target_min: targetMin,
      target_max_available: maxAvailable,
      target_max: targetMax,
      trend: enumAt(metric.trend, REPORT_TRENDS, providerKind, `${path}.trend`),
      coverage,
      confidence,
      classification,
    };
  });

  const metricsById = new Map(
    metrics.map((metric) => [metric.metric_id, metric] as const),
  );
  const healthMetric = metricsById.get('health_score');
  if (
    healthMetric === undefined ||
    !healthMetric.available ||
    !closeEnough(healthMetric.value, healthScore, 0.01)
  ) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.health_score',
      'must match an available health_score metric',
    );
  }
  const coverageMetric = metricsById.get('data_coverage');
  if (
    coverageMetric === undefined ||
    !coverageMetric.available ||
    !closeEnough(coverageMetric.value, dataCoverage, 0.001) ||
    !closeEnough(coverageMetric.lower, dataCoverage, 0.001) ||
    !closeEnough(coverageMetric.upper, dataCoverage, 0.001)
  ) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.data_coverage',
      'must match the exact data_coverage metric range',
    );
  }

  if (!Array.isArray(root.score_components) || root.score_components.length > 20) {
    invalid(
      providerKind,
      'SCHEMA_INVALID',
      'reportContext.score_components',
      'invalid score component array',
    );
  }
  const seenScoreMetricIds = new Set<ReportMetricId>();
  const scoreComponents = root.score_components.map((rawComponent, index) => {
    const path = `reportContext.score_components[${index}]`;
    const component = objectAt(rawComponent, providerKind, path);
    exactKeys(component, ['metric_id', 'score', 'weight'], providerKind, path);
    const metricId = enumAt(
      component.metric_id,
      REPORT_METRIC_IDS,
      providerKind,
      `${path}.metric_id`,
    );
    if (seenScoreMetricIds.has(metricId)) {
      invalid(providerKind, 'SEMANTIC_INVALID', `${path}.metric_id`, 'duplicate score metric');
    }
    const sourceMetric = metricsById.get(metricId);
    if (sourceMetric === undefined) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.metric_id`,
        'score component references a metric absent from metrics',
      );
    }
    if (!sourceMetric.available || sourceMetric.coverage === 0) {
      invalid(
        providerKind,
        'SEMANTIC_INVALID',
        `${path}.metric_id`,
        'score component requires an available metric with positive coverage',
      );
    }
    seenScoreMetricIds.add(metricId);
    const weight = finiteNumber(component.weight, providerKind, `${path}.weight`, 0, 100);
    if (weight === 0) {
      invalid(providerKind, 'SEMANTIC_INVALID', `${path}.weight`, 'must be positive');
    }
    return {
      metric_id: metricId,
      score: finiteNumber(component.score, providerKind, `${path}.score`, 0, 100),
      weight,
    };
  });

  const rawWeight = scoreComponents.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  if (rawWeight > 100.001) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.score_components',
      'base score weights must not exceed 100',
    );
  }
  const weighted = scoreComponents.map((component) => ({
    ...component,
    effectiveWeight:
      component.weight * metricsById.get(component.metric_id)!.coverage,
  }));
  const effectiveWeight = weighted.reduce(
    (sum, component) => sum + component.effectiveWeight,
    0,
  );
  if (effectiveWeight <= 0) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.score_components',
      'at least one positively weighted score component is required',
    );
  }
  const derivedCoverage = effectiveWeight / 100;
  if (!closeEnough(derivedCoverage, dataCoverage, 0.002)) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.data_coverage',
      'does not match weighted score-component coverage',
    );
  }
  const derivedHealthScore =
    weighted.reduce(
      (sum, component) =>
        sum + component.score * component.effectiveWeight,
      0,
    ) / effectiveWeight;
  if (!closeEnough(derivedHealthScore, healthScore, 0.05)) {
    invalid(
      providerKind,
      'SEMANTIC_INVALID',
      'reportContext.health_score',
      'does not match the weighted score components',
    );
  }

  return {
    period,
    period_start: start,
    period_end: end,
    locale,
    timezone,
    logged_days: loggedDays,
    expected_days: expectedDays,
    meal_count: mealCount,
    health_score: healthScore,
    data_coverage: dataCoverage,
    goal,
    dietary_preferences: preferences,
    metrics,
    score_components: scoreComponents,
  };
}
