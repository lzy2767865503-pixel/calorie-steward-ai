import type { MealAnalysisV1, ReportContextV1 } from '../types';

export function estimate(
  value: number,
  lower = value,
  upper = value,
  confidence = 0.8,
) {
  return {
    available: true,
    value,
    lower,
    upper,
    confidence,
    evidence: 'visual_estimate' as const,
  };
}

function unavailable() {
  return {
    available: false,
    value: 0,
    lower: 0,
    upper: 0,
    confidence: 0,
    evidence: 'unsupported' as const,
  };
}

export function validMeal(): MealAnalysisV1 {
  return {
    schema_version: 'meal_analysis.v1',
    status: 'ok',
    meal_name: 'Rice and chicken',
    components: [
      {
        name: 'Rice and chicken',
        preparation: 'cooked',
        visibility: 'visible',
        weight_g: estimate(280, 220, 350, 0.65),
        energy_kcal: estimate(300, 240, 390, 0.65),
        protein_g: estimate(20, 15, 26, 0.65),
        carbohydrate_g: estimate(40, 30, 52, 0.65),
        fat_g: estimate(6, 3, 12, 0.55),
      },
    ],
    totals: {
      energy_kcal: estimate(300, 240, 390, 0.65),
      protein_g: estimate(20, 15, 26, 0.65),
      carbohydrate_g: estimate(40, 30, 52, 0.65),
      fat_g: estimate(6, 3, 12, 0.55),
      saturated_fat_g: unavailable(),
      trans_fat_g: unavailable(),
      fiber_g: estimate(4, 2, 7, 0.45),
      free_sugars_g: unavailable(),
      sodium_mg: unavailable(),
      fruit_vegetable_g: unavailable(),
    },
    quality: {
      image_quality: 0.9,
      identification_confidence: 0.8,
      portion_confidence: 0.65,
      nutrition_confidence: 0.6,
      data_coverage: 0.5,
      retake_recommended: false,
      assumptions: ['Serving scale is inferred from the plate.'],
      uncertainties: ['Hidden cooking oil cannot be observed.'],
    },
  };
}

export function validContext(): ReportContextV1 {
  return {
    period: 'day',
    period_start: '2026-08-24',
    period_end: '2026-08-24',
    locale: 'zh-CN',
    timezone: 'Asia/Kuala_Lumpur',
    logged_days: 1,
    expected_days: 1,
    meal_count: 3,
    health_score: 80,
    data_coverage: 0.85,
    goal: '',
    dietary_preferences: [],
    metrics: [
      {
        metric_id: 'energy',
        unit: 'kcal',
        available: true,
        value: 1_900,
        lower: 1_850,
        upper: 2_050,
        target_min_available: true,
        target_min: 1_800,
        target_max_available: true,
        target_max: 2_200,
        trend: 'stable',
        coverage: 0.85,
        confidence: 0.8,
        classification: 'within_target',
      },
      {
        metric_id: 'data_coverage',
        unit: 'ratio',
        available: true,
        value: 0.85,
        lower: 0.85,
        upper: 0.85,
        target_min_available: true,
        target_min: 0.7,
        target_max_available: false,
        target_max: 0,
        trend: 'stable',
        coverage: 1,
        confidence: 1,
        classification: 'within_target',
      },
      {
        metric_id: 'health_score',
        unit: 'score/100',
        available: true,
        value: 80,
        lower: 75,
        upper: 85,
        target_min_available: true,
        target_min: 70,
        target_max_available: true,
        target_max: 100,
        trend: 'stable',
        coverage: 1,
        confidence: 0.85,
        classification: 'within_target',
      },
    ],
    score_components: [{ metric_id: 'energy', score: 80, weight: 100 }],
  };
}
