import {
  COMPONENT_VISIBILITIES,
  REPORT_METRIC_IDS,
  REPORT_PATTERN_KINDS,
  REPORT_SUGGESTION_CATEGORIES,
  type DietReportV1,
  type MealAnalysisV1,
  type MealComponentV1,
  type MealNutrientTotalsV1,
  type NutrientEstimate,
  type ReportContextV1,
} from './types';

type JsonObject = Record<string, unknown>;

const unavailableEstimate = (): NutrientEstimate => ({
  available: false,
  value: 0,
  lower: 0,
  upper: 0,
  confidence: 0,
  evidence: 'unsupported',
});

function objectOrEmpty(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function first(object: JsonObject, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim().length <= 32 &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function ratio(value: unknown, fallback: number): number {
  const parsed = finite(value);
  if (parsed === undefined) return fallback;
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, normalized));
}

function affirmative(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return (
    typeof value === 'string' &&
    ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase())
  );
}

function negativeBoolean(value: unknown): boolean {
  if (value === false || value === 0) return true;
  return (
    typeof value === 'string' &&
    ['false', '0', 'no', 'n'].includes(value.trim().toLowerCase())
  );
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function hasTextIdentity(value: unknown): boolean {
  const object = objectOrEmpty(value);
  const identity = first(object, [
    'name',
    'meal_name',
    'mealName',
    'food_name',
    'food',
    'label',
  ]);
  return typeof identity === 'string' && identity.trim().length > 0;
}

function localized(locale: string, chinese: string, english: string): string {
  return locale.trim().toLowerCase().startsWith('zh') ? chinese : english;
}

function normalizeEstimate(value: unknown): NutrientEstimate {
  const object =
    typeof value === 'number' || typeof value === 'string'
      ? { value }
      : objectOrEmpty(value);
  const estimate = finite(first(object, ['value', 'estimate', 'estimated', 'amount']));
  const explicitAvailable = first(object, ['available', 'is_available']);
  const available =
    typeof explicitAvailable === 'boolean'
      ? explicitAvailable
      : estimate !== undefined;

  if (!available || estimate === undefined) return unavailableEstimate();

  let lower = finite(first(object, ['lower', 'min', 'minimum']));
  let upper = finite(first(object, ['upper', 'max', 'maximum']));
  if (lower === undefined || upper === undefined || lower === upper) {
    const halfWidth = Math.max(Math.abs(estimate) * 0.3, estimate === 0 ? 0.5 : 0.1);
    lower = Math.max(0, estimate - halfWidth);
    upper = estimate + halfWidth;
  }
  if (lower >= 0 && estimate >= 0 && upper >= 0) {
    [lower, upper] = [Math.min(lower, estimate, upper), Math.max(lower, estimate, upper)];
  }

  const relativeWidth = (upper - lower) / Math.max(Math.abs(estimate), 1);
  const confidenceCap = Math.min(0.9, 1 / (1 + Math.max(0, relativeWidth) / 2));
  const confidence = Math.min(
    confidenceCap,
    Math.max(0.05, ratio(first(object, ['confidence', 'confidence_score']), 0.45)),
  );

  return {
    available: true,
    value: estimate,
    lower,
    upper,
    confidence,
    evidence: 'visual_estimate',
  };
}

function normalizeComponent(value: unknown, locale: string): MealComponentV1 {
  const object = objectOrEmpty(value);
  const visibilityValue = first(object, ['visibility', 'visible']);
  const visibility =
    typeof visibilityValue === 'string' &&
    COMPONENT_VISIBILITIES.includes(visibilityValue as (typeof COMPONENT_VISIBILITIES)[number])
      ? (visibilityValue as MealComponentV1['visibility'])
      : 'inferred';

  return {
    name: text(first(object, ['name', 'meal_name', 'mealName', 'food_name', 'food', 'label']), localized(locale, '未命名食物', 'Unnamed food')),
    preparation: text(first(object, ['preparation', 'cooking_method', 'method']), 'unknown'),
    visibility,
    weight_g: normalizeEstimate(first(object, ['weight_g', 'weight', 'grams'])),
    energy_kcal: normalizeEstimate(first(object, ['energy_kcal', 'calories', 'kcal'])),
    protein_g: normalizeEstimate(first(object, ['protein_g', 'protein'])),
    carbohydrate_g: normalizeEstimate(
      first(object, ['carbohydrate_g', 'carbs_g', 'carbohydrates', 'carbs']),
    ),
    fat_g: normalizeEstimate(first(object, ['fat_g', 'fat'])),
  };
}

function sumAvailable(
  components: readonly MealComponentV1[],
  field: 'energy_kcal' | 'protein_g' | 'carbohydrate_g' | 'fat_g',
): NutrientEstimate | null {
  if (components.length === 0 || components.some((item) => !item[field].available)) return null;
  const estimates = components.map((item) => item[field]);
  return {
    available: true,
    value: estimates.reduce((sum, item) => sum + item.value, 0),
    lower: estimates.reduce((sum, item) => sum + item.lower, 0),
    upper: estimates.reduce((sum, item) => sum + item.upper, 0),
    confidence: Math.min(...estimates.map((item) => item.confidence)),
    evidence: 'visual_estimate',
  };
}

function normalizeTotals(
  value: unknown,
  components: readonly MealComponentV1[],
): MealNutrientTotalsV1 {
  const object = objectOrEmpty(value);
  const energy = normalizeEstimate(first(object, ['energy_kcal', 'calories', 'kcal']));
  const protein = normalizeEstimate(first(object, ['protein_g', 'protein']));
  const carbohydrate = normalizeEstimate(
    first(object, ['carbohydrate_g', 'carbs_g', 'carbohydrates', 'carbs']),
  );
  const fat = normalizeEstimate(first(object, ['fat_g', 'fat']));

  return {
    energy_kcal: energy.available ? energy : (sumAvailable(components, 'energy_kcal') ?? energy),
    protein_g: protein.available ? protein : (sumAvailable(components, 'protein_g') ?? protein),
    carbohydrate_g: carbohydrate.available
      ? carbohydrate
      : (sumAvailable(components, 'carbohydrate_g') ?? carbohydrate),
    fat_g: fat.available ? fat : (sumAvailable(components, 'fat_g') ?? fat),
    // A single meal photo cannot establish these hidden nutrients reliably.
    saturated_fat_g: unavailableEstimate(),
    trans_fat_g: unavailableEstimate(),
    fiber_g: normalizeEstimate(first(object, ['fiber_g', 'fibre_g', 'fiber', 'fibre'])),
    free_sugars_g: unavailableEstimate(),
    sodium_mg: unavailableEstimate(),
    fruit_vegetable_g: normalizeEstimate(
      first(object, ['fruit_vegetable_g', 'fruit_and_vegetable_g', 'fruit_veg_g']),
    ),
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function normalizeMealStatus(value: unknown): MealAnalysisV1['status'] {
  if (typeof value !== 'string') return 'unquantifiable';
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['ok', 'success', 'recordable', 'food_detected', 'meal_detected'].includes(normalized)) {
    return 'ok';
  }
  if (
    ['not_food', 'no_food', 'non_food', 'notfood', 'empty_plate', 'no_meal'].includes(
      normalized,
    )
  ) {
    return 'not_food';
  }
  if (['needs_retake', 'need_retake', 'retake', 'retry_photo'].includes(normalized)) {
    return 'needs_retake';
  }
  if (
    ['unquantifiable', 'cannot_quantify', 'not_quantifiable', 'insufficient_evidence'].includes(
      normalized,
    )
  ) {
    return 'unquantifiable';
  }
  // Keep an absent or unknown decision unquantifiable here. The caller may
  // promote it only after independently confirming both food identity and a
  // usable bounded calorie estimate.
  return 'unquantifiable';
}

/**
 * Converts common, bounded provider variations into the app contract before
 * safety validation. It never invents a meal or reuses an earlier response.
 */
export function normalizeMealAnalysisPayload(input: unknown, locale = 'zh-CN'): unknown {
  const root = objectOrEmpty(input);
  if (Object.keys(root).length === 0) return input;

  const rawComponents = first(root, ['components', 'foods', 'items']);
  const rootHasFoodIdentity = hasTextIdentity(root);
  const componentHasFoodIdentity =
    Array.isArray(rawComponents) && rawComponents.some(hasTextIdentity);
  const hasRecognizableFoodIdentity = rootHasFoodIdentity || componentHasFoodIdentity;
  const flatFoodCandidate = rootHasFoodIdentity;
  const componentInputs = Array.isArray(rawComponents)
    ? rawComponents.slice(0, 24)
    : flatFoodCandidate
      ? [root]
      : [];
  const components = componentInputs.map((item) => normalizeComponent(item, locale));
  const totalsSource = first(root, ['totals', 'nutrition', 'nutrients']) ?? root;
  const totals = normalizeTotals(totalsSource, components);
  const qualityObject = objectOrEmpty(first(root, ['quality', 'confidence']));
  const availableTotals = Object.values(totals).filter((item) => item.available);
  const dataCoverage = availableTotals.length / Object.keys(totals).length;
  const meanNutrientConfidence =
    availableTotals.length === 0
      ? 0
      : availableTotals.reduce((sum, item) => sum + item.confidence, 0) /
        availableTotals.length;
  const imageQuality = ratio(first(qualityObject, ['image_quality', 'image']), 0.6);
  const identificationConfidence = ratio(
    first(qualityObject, ['identification_confidence', 'identification']),
    0.55,
  );
  const portionConfidence = ratio(
    first(qualityObject, ['portion_confidence', 'portion']),
    0.4,
  );
  const nutritionConfidence = Math.min(
    ratio(first(qualityObject, ['nutrition_confidence', 'nutrition']), 0.4),
    imageQuality,
    identificationConfidence,
    portionConfidence,
    meanNutrientConfidence,
  );
  const retakeRecommended = affirmative(
    first(qualityObject, ['retake_recommended', 'needs_retake']),
  );

  const rawStatus = first(root, ['status', 'result_status']);
  let status = normalizeMealStatus(rawStatus);
  const providerStatus = status;
  const explicitNotFood =
    providerStatus === 'not_food' ||
    affirmative(first(root, ['not_food', 'no_food', 'is_not_food'])) ||
    negativeBoolean(first(root, ['is_food', 'food_detected', 'contains_food']));
  const hasUsableCalorieEstimate =
    hasRecognizableFoodIdentity &&
    components.length > 0 &&
    totals.energy_kcal.available &&
    totals.energy_kcal.value > 0;
  let bestEffortPromotion = false;
  if (explicitNotFood) status = 'not_food';
  else if (hasUsableCalorieEstimate) {
    bestEffortPromotion = providerStatus !== 'ok' || retakeRecommended;
    status = 'ok';
  } else if (retakeRecommended) {
    status = 'needs_retake';
  } else if (status === 'ok') {
    status = 'unquantifiable';
  }

  const uncertainties = textArray(
    first(qualityObject, ['uncertainties', 'limitations', 'warnings']),
  );
  if (bestEffortPromotion) {
    uncertainties.push(
      localized(
        locale,
        '本次为低置信度视觉估算；App 已保留较宽范围，可直接记录或选择重拍。',
        'This is a low-confidence visual estimate. The app kept a wider range; you can save it or retake the photo.',
      ),
    );
  }

  const normalized: MealAnalysisV1 = {
    schema_version: 'meal_analysis.v1',
    status,
    meal_name: text(
      first(root, ['meal_name', 'mealName', 'name', 'title']),
      components.map((item) => item.name).filter(Boolean).join(localized(locale, '、', ', ')) || localized(locale, '识别到的餐食', 'Identified meal'),
    ),
    components,
    totals,
    quality: {
      image_quality: imageQuality,
      identification_confidence: identificationConfidence,
      portion_confidence: portionConfidence,
      nutrition_confidence: nutritionConfidence,
      data_coverage: dataCoverage,
      retake_recommended: status === 'needs_retake' || (status === 'ok' && retakeRecommended),
      assumptions: textArray(first(qualityObject, ['assumptions', 'assumption'])),
      uncertainties: uncertainties.slice(0, 12),
    },
  };

  if (safeJson(input) !== safeJson(normalized)) {
    normalized.quality.uncertainties = [
      ...normalized.quality.uncertainties,
      localized(locale, 'App 已对本次 AI 返回的缺失或兼容字段做保守规范化。', 'The app conservatively normalized missing or compatible fields in this AI response.'),
    ].slice(0, 12);
  }
  return normalized;
}

export function normalizeDietReportPayload(
  input: unknown,
  context: ReportContextV1,
): unknown {
  const root = objectOrEmpty(input);
  if (Object.keys(root).length === 0) return input;
  const availableMetrics = new Set(context.metrics.map((metric) => metric.metric_id));
  const seenPatterns = new Set<string>();
  const patterns = (Array.isArray(root.patterns) ? root.patterns : [])
    .map(objectOrEmpty)
    .filter((item) => {
      const metric = item.metric_id;
      const kind = item.kind;
      if (
        typeof metric !== 'string' ||
        !REPORT_METRIC_IDS.includes(metric as (typeof REPORT_METRIC_IDS)[number]) ||
        !availableMetrics.has(metric as (typeof REPORT_METRIC_IDS)[number]) ||
        seenPatterns.has(metric) ||
        typeof kind !== 'string' ||
        !REPORT_PATTERN_KINDS.includes(kind as (typeof REPORT_PATTERN_KINDS)[number])
      ) return false;
      seenPatterns.add(metric);
      return true;
    })
    .slice(0, 10)
    .map((item) => ({
      kind: item.kind,
      metric_id: item.metric_id,
      statement: text(item.statement, localized(context.locale, '基于本期记录的饮食模式。', 'Diet pattern based on records from this period.')),
      evidence: text(item.evidence, localized(context.locale, '依据本期已记录指标。', 'Based on recorded metrics from this period.')),
    }));
  const seenSuggestions = new Set<string>();
  const suggestions = (Array.isArray(root.suggestions) ? root.suggestions : [])
    .map(objectOrEmpty)
    .filter((item) => {
      const metric = item.metric_id;
      const category = item.category;
      if (
        typeof metric !== 'string' ||
        !REPORT_METRIC_IDS.includes(metric as (typeof REPORT_METRIC_IDS)[number]) ||
        !availableMetrics.has(metric as (typeof REPORT_METRIC_IDS)[number]) ||
        seenSuggestions.has(metric) ||
        typeof category !== 'string' ||
        !REPORT_SUGGESTION_CATEGORIES.includes(
          category as (typeof REPORT_SUGGESTION_CATEGORIES)[number],
        )
      ) return false;
      seenSuggestions.add(metric);
      return true;
    })
    .slice(0, 8)
    .map((item) => ({
      priority: Math.max(1, Math.min(3, Math.round(finite(item.priority) ?? 3))) as 1 | 2 | 3,
      category: item.category,
      metric_id: item.metric_id,
      action: text(item.action, localized(context.locale, '根据本期记录逐步调整饮食。', 'Adjust the diet gradually based on this period.')),
      reason: text(item.reason, localized(context.locale, '依据本期已记录指标。', 'Based on recorded metrics from this period.')),
    }));

  const normalized: DietReportV1 = {
    schema_version: 'diet_report.v1',
    period: context.period,
    summary: text(root.summary, localized(context.locale, '本报告基于当前已记录的餐食。', 'This report is based on currently recorded meals.')),
    patterns: patterns as DietReportV1['patterns'],
    suggestions: suggestions as DietReportV1['suggestions'],
    uncertainty_note: text(
      first(root, ['uncertainty_note', 'limitations', 'warning']),
      localized(context.locale, '结论仅覆盖已记录餐食，并受照片估算误差影响。', 'Conclusions cover recorded meals only and are affected by photo-estimation uncertainty.'),
    ),
  };
  return normalized;
}
