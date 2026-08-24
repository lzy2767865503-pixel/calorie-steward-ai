import { randomUUID } from "expo-crypto";

import type {
  AiCallResult,
  MealAnalysisV1,
  NutrientEstimate,
  ProviderConfig,
} from "../ai";
import type {
  NutrientEvidenceMap,
  NutrientField,
  NutrientRange,
} from "../domain/types";
import type { PreparedPhoto } from "../screens/CameraScreen";
import type { UiMealAnalysis, UiRange } from "../screens/ReviewScreen";
import { copy as localizedCopy, type AppLanguage } from "../i18n";
import type {
  MealComponentWrite,
  MealWrite,
  StoredNutrientTotals,
} from "../storage";

const NUTRIENT_FIELD_MAP = {
  caloriesKcal: "energy_kcal",
  proteinG: "protein_g",
  carbohydrateG: "carbohydrate_g",
  totalFatG: "fat_g",
  saturatedFatG: "saturated_fat_g",
  transFatG: "trans_fat_g",
  freeSugarG: "free_sugars_g",
  fiberG: "fiber_g",
  sodiumMg: "sodium_mg",
  fruitVegetableG: "fruit_vegetable_g",
} as const;

function scale(value: number, factor: number) {
  return Math.max(0, value * factor);
}

function toRange(estimate: NutrientEstimate, factor = 1): NutrientRange | null {
  if (!estimate.available) return null;
  return {
    low: scale(estimate.lower, factor),
    estimate: scale(estimate.value, factor),
    high: scale(estimate.upper, factor),
  };
}

function toUiRange(estimate: NutrientEstimate): UiRange {
  return {
    available: estimate.available,
    value: estimate.value,
    lower: estimate.lower,
    upper: estimate.upper,
    confidence: estimate.confidence,
  };
}

export function analysisToReview(analysis: MealAnalysisV1): UiMealAnalysis {
  return {
    mealName: analysis.meal_name,
    components: analysis.components.map((component) => ({
      name: component.name,
      preparation: component.preparation,
      weightG: toUiRange(component.weight_g),
      energyKcal: toUiRange(component.energy_kcal),
    })),
    totals: {
      energyKcal: toUiRange(analysis.totals.energy_kcal),
      proteinG: toUiRange(analysis.totals.protein_g),
      carbohydrateG: toUiRange(analysis.totals.carbohydrate_g),
      fatG: toUiRange(analysis.totals.fat_g),
      saturatedFatG: toUiRange(analysis.totals.saturated_fat_g),
      fiberG: toUiRange(analysis.totals.fiber_g),
      freeSugarsG: toUiRange(analysis.totals.free_sugars_g),
      sodiumMg: toUiRange(analysis.totals.sodium_mg),
      fruitVegetableG: toUiRange(analysis.totals.fruit_vegetable_g),
    },
    quality: {
      imageQuality: analysis.quality.image_quality,
      identificationConfidence: analysis.quality.identification_confidence,
      portionConfidence: analysis.quality.portion_confidence,
      nutritionConfidence: analysis.quality.nutrition_confidence,
      dataCoverage: analysis.quality.data_coverage,
      assumptions: analysis.quality.assumptions,
      uncertainties: analysis.quality.uncertainties,
    },
  };
}

function emptyStoredNutrients(): StoredNutrientTotals {
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

function componentWrite(
  component: MealAnalysisV1["components"][number],
  index: number,
  portionFactor: number,
  language: AppLanguage,
): MealComponentWrite {
  const nutrients = emptyStoredNutrients();
  nutrients.caloriesKcal = toRange(component.energy_kcal, portionFactor);
  nutrients.proteinG = toRange(component.protein_g, portionFactor);
  nutrients.carbohydrateG = toRange(component.carbohydrate_g, portionFactor);
  nutrients.totalFatG = toRange(component.fat_g, portionFactor);
  const nutrientConfidences = [
    component.energy_kcal,
    component.protein_g,
    component.carbohydrate_g,
    component.fat_g,
  ].filter((item) => item.available).map((item) => item.confidence);
  return {
    id: randomUUID(),
    name: component.name,
    category: "unknown",
    preparationTags: component.preparation ? [component.preparation] : [],
    sortOrder: index,
    estimatedGrams: toRange(component.weight_g, portionFactor),
    confidence: Math.min(
      component.weight_g.available ? component.weight_g.confidence : 1,
      ...(nutrientConfidences.length > 0 ? nutrientConfidences : [0]),
    ),
    nutrients,
    assumptions: component.visibility === "inferred"
      ? [localizedCopy(language, "该组分为 AI 推断，未完全可见", "This component was inferred by AI and is not fully visible")]
      : [],
  };
}

function evidenceMap(
  analysis: MealAnalysisV1,
): NutrientEvidenceMap {
  const output: Partial<Record<NutrientField, { kind: "single_photo_estimate"; notes: readonly string[] }>> = {};
  const notes = [...analysis.quality.assumptions, ...analysis.quality.uncertainties];
  for (const [domainField, apiField] of Object.entries(NUTRIENT_FIELD_MAP) as Array<
    [NutrientField, keyof MealAnalysisV1["totals"]]
  >) {
    if (analysis.totals[apiField].available) {
      output[domainField] = { kind: "single_photo_estimate", notes };
    }
  }
  return output;
}

function normalizedResult(analysis: MealAnalysisV1): Readonly<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(analysis)) as Record<string, unknown>;
}

export function createMealWrite(args: {
  result: AiCallResult<MealAnalysisV1>;
  photo: PreparedPhoto;
  config: ProviderConfig;
  localDate: string;
  timeZone: string;
  utcOffsetMinutes: number;
  portionFactor: number;
  language: AppLanguage;
  retainedPhotoUri: string | null;
  retainedPhotoSha256?: string | null;
}): MealWrite {
  const { data, metadata } = args.result;
  const retainedPhotoSha256 = args.retainedPhotoSha256 ?? null;
  if ((args.retainedPhotoUri === null) !== (retainedPhotoSha256 === null)) {
    throw new Error("保留照片路径和 SHA-256 摘要必须同时存在或同时为空。");
  }
  if (retainedPhotoSha256 !== null && !/^[a-f0-9]{64}$/i.test(retainedPhotoSha256)) {
    throw new Error("保留照片的 SHA-256 摘要格式无效。");
  }
  const totals: StoredNutrientTotals = {
    caloriesKcal: toRange(data.totals.energy_kcal, args.portionFactor),
    proteinG: toRange(data.totals.protein_g, args.portionFactor),
    carbohydrateG: toRange(data.totals.carbohydrate_g, args.portionFactor),
    totalFatG: toRange(data.totals.fat_g, args.portionFactor),
    saturatedFatG: toRange(data.totals.saturated_fat_g, args.portionFactor),
    transFatG: toRange(data.totals.trans_fat_g, args.portionFactor),
    freeSugarG: toRange(data.totals.free_sugars_g, args.portionFactor),
    fiberG: toRange(data.totals.fiber_g, args.portionFactor),
    sodiumMg: toRange(data.totals.sodium_mg, args.portionFactor),
    fruitVegetableG: toRange(data.totals.fruit_vegetable_g, args.portionFactor),
  };
  const confirmedAtUtc = new Date().toISOString();
  return {
    id: randomUUID(),
    capturedAtUtc: args.photo.capturedAt,
    localDate: args.localDate,
    timeZone: args.timeZone,
    utcOffsetMinutes: args.utcOffsetMinutes,
    mealName: data.meal_name,
    mealSlot: null,
    recordStatus: "confirmed",
    confirmedAtUtc,
    confidence: data.quality.nutrition_confidence,
    dataCoverage: data.quality.data_coverage,
    nutrients: totals,
    nutrientEvidence: evidenceMap(data),
    photoUri: args.retainedPhotoUri,
    photoSha256: retainedPhotoSha256,
    components: data.components.map((component, index) =>
      componentWrite(component, index, args.portionFactor, args.language),
    ),
    analysis: {
      id: randomUUID(),
      providerId: args.config.id,
      providerKind: metadata.provider_kind,
      model: metadata.model,
      endpointHost: new URL(args.config.baseUrl).host,
      providerRequestId: metadata.provider_request_id,
      analysisSchemaVersion: data.schema_version,
      promptVersion: "meal-photo.v1.0",
      status: "ok",
      requestStartedAtUtc: null,
      receivedAtUtc: metadata.received_at,
      latencyMs: metadata.latency_ms,
      normalizedResult: normalizedResult(data),
      assumptions: data.quality.assumptions,
      warnings: data.quality.uncertainties,
    },
  };
}
