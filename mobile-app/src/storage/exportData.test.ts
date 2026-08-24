import assert from "node:assert/strict";
import test from "node:test";

import { buildPortableDataExport } from "./portableExport";
import { storedMealToDomain } from "./domainMappers";
import type { StoredMeal, StoredNutrientTotals, StoredReport } from "./types";

const emptyNutrients: StoredNutrientTotals = {
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

const storedMeal: StoredMeal = {
  id: "meal-1",
  capturedAtUtc: "2026-08-24T02:00:00.000Z",
  localDate: "2026-08-24",
  timeZone: "Asia/Kuala_Lumpur",
  utcOffsetMinutes: 480,
  mealName: "测试餐",
  mealSlot: null,
  recordStatus: "confirmed",
  confirmedAtUtc: "2026-08-24T02:01:00.000Z",
  confidence: 0.8,
  dataCoverage: 0.7,
  nutrients: emptyNutrients,
  nutrientEvidence: {},
  photoUri: "file:///private/meal.jpg",
  photoSha256: "a".repeat(64),
  components: [],
  analysis: {
    id: "analysis-1",
    providerId: "custom-provider",
    providerKind: "custom",
    model: "vision-model",
    endpointHost: "example.test",
    providerRequestId: null,
    analysisSchemaVersion: "1",
    promptVersion: "1",
    status: "ok",
    requestStartedAtUtc: null,
    receivedAtUtc: "2026-08-24T02:00:30.000Z",
    latencyMs: 30000,
    normalizedResult: {},
    assumptions: [],
    warnings: [],
  },
  revision: 1,
  createdAtUtc: "2026-08-24T02:01:00.000Z",
  updatedAtUtc: "2026-08-24T02:01:00.000Z",
  deletedAtUtc: null,
};

const storedReport: StoredReport = {
  id: "report-1",
  periodType: "week",
  periodStartLocalDate: "2026-08-18",
  periodEndLocalDateExclusive: "2026-08-25",
  generatedAtUtc: "2026-08-24T06:00:00.000Z",
  score: 72,
  scoreConfidence: 0.75,
  dataCoverage: 0.8,
  totals: emptyNutrients,
  scoreResult: { internalFormula: "INTERNAL_SCORE_DIAGNOSTIC" },
  normalizedReport: {
    schema_version: "diet_report.v1",
    internalPayload: "INTERNAL_NORMALIZED_REPORT",
  },
  narrative: "本周蔬菜摄入仍可增加。",
  recommendations: ["下一餐增加一份蔬菜。"],
  providerId: "enterprise-provider-internal",
  providerKind: "custom_contract",
  model: "enterprise-report-model-internal",
  providerRequestId: "report-request-internal",
  reportSchemaVersion: "diet_report.v1",
  promptVersion: "diet-report.internal.v9",
  inputRevision: 9,
  locale: "zh-CN",
  scoreInputVersion: "diet-score.internal.v9",
  inputFingerprint: "a".repeat(64),
  createdAtUtc: "2026-08-24T06:00:00.000Z",
  updatedAtUtc: "2026-08-24T06:00:00.000Z",
};

test("portable export structurally excludes secrets and photo references", () => {
  const exported = buildPortableDataExport({
    exportedAtUtc: "2026-08-24T03:00:00.000Z",
    profile: null,
    settings: [{ key: "privacy.retain.photos", value: false, updatedAtUtc: "2026-08-24T00:00:00.000Z" }],
    diaryDays: [],
    meals: [storedMeal],
    reports: [],
  });
  const json = JSON.stringify(exported);
  assert.equal(exported.formatVersion, 2);
  assert.equal(exported.privacy.containsApiSecrets, false);
  assert.equal(exported.privacy.containsRawPhotos, false);
  assert.doesNotMatch(json, /private\/meal\.jpg/);
  assert.doesNotMatch(json, /photoUri|photoSha256|apiKey|api_key/i);
});

test("portable export removes provider, gateway, model, and diagnostic metadata", () => {
  const mealWithInternalMetadata: StoredMeal = {
    ...storedMeal,
    nutrients: {
      ...emptyNutrients,
      caloriesKcal: { low: 480, estimate: 560, high: 680 },
    },
    analysis: {
      ...storedMeal.analysis,
      providerId: "enterprise-provider-internal",
      providerKind: "custom_contract",
      model: "enterprise-vision-model-internal",
      endpointHost: "gateway.private-enterprise.example",
      providerRequestId: "meal-request-internal",
      analysisSchemaVersion: "meal_analysis.internal.v9",
      promptVersion: "meal-photo.internal.v9",
      requestStartedAtUtc: "2026-08-24T01:59:59.000Z",
      receivedAtUtc: "2026-08-24T02:00:30.000Z",
      latencyMs: 31000,
      normalizedResult: {
        schema_version: "meal_analysis.v1",
        internalPayload: "INTERNAL_NORMALIZED_MEAL",
      },
      assumptions: ["酱汁用量按照片估算"],
      warnings: ["隐藏油量无法由单张照片确认"],
    },
  };
  const exported = buildPortableDataExport({
    exportedAtUtc: "2026-08-24T07:00:00.000Z",
    profile: null,
    settings: [],
    diaryDays: [],
    meals: [mealWithInternalMetadata],
    reports: [storedReport],
  });

  const json = JSON.stringify(exported);
  assert.doesNotMatch(
    json,
    /gateway\.private-enterprise\.example|enterprise-provider-internal|enterprise-vision-model-internal|enterprise-report-model-internal|meal-request-internal|report-request-internal|INTERNAL_/,
  );
  assert.doesNotMatch(
    json,
    /"(?:endpointHost|providerId|providerKind|providerRequestId|model|analysisSchemaVersion|reportSchemaVersion|promptVersion|requestStartedAtUtc|receivedAtUtc|latencyMs|normalizedResult|normalizedReport|scoreResult)"/,
  );
  assert.equal(exported.meals[0]?.nutrients.caloriesKcal?.estimate, 560);
  assert.deepEqual(exported.meals[0]?.analysis.assumptions, ["酱汁用量按照片估算"]);
  assert.deepEqual(exported.meals[0]?.analysis.warnings, ["隐藏油量无法由单张照片确认"]);
  assert.equal(exported.reports[0]?.narrative, "本周蔬菜摄入仍可增加。");
  assert.deepEqual(exported.reports[0]?.recommendations, ["下一餐增加一份蔬菜。"]);
});

test("portable export omits soft-deleted meals", () => {
  const deletedMeal: StoredMeal = {
    ...storedMeal,
    id: "meal-deleted",
    mealName: "已删除餐食不应导出",
    deletedAtUtc: "2026-08-24T04:00:00.000Z",
  };
  const exported = buildPortableDataExport({
    exportedAtUtc: "2026-08-24T05:00:00.000Z",
    profile: null,
    settings: [],
    diaryDays: [],
    meals: [storedMeal, deletedMeal],
    reports: [],
  });

  assert.deepEqual(exported.meals.map((meal) => meal.id), ["meal-1"]);
  assert.doesNotMatch(JSON.stringify(exported), /已删除餐食不应导出/);
});

test("portable export uses an explicit user-preference settings allowlist", () => {
  const updatedAtUtc = "2026-08-24T00:00:00.000Z";
  const exported = buildPortableDataExport({
    exportedAtUtc: "2026-08-24T05:00:00.000Z",
    profile: null,
    settings: [
      { key: "privacy.retain.photos", value: true, updatedAtUtc },
      {
        key: "ai.provider.config.v1",
        value: { baseUrl: "https://private-ai.example.test", model: "vision-private" },
        updatedAtUtc,
      },
      {
        key: "enterprise.deployment.profile.v1",
        value: { organization: "Private Enterprise", environment: "production" },
        updatedAtUtc,
      },
      { key: "endpoint.health.last-check", value: { ok: true }, updatedAtUtc },
      { key: "health.experimental.config", value: { enabled: true }, updatedAtUtc },
    ],
    diaryDays: [],
    meals: [],
    reports: [],
  });

  assert.deepEqual(exported.settings, [
    { key: "privacy.retain.photos", value: true, updatedAtUtc },
  ]);
  const json = JSON.stringify(exported);
  assert.doesNotMatch(json, /private-ai\.example\.test|vision-private|Private Enterprise/);
  assert.doesNotMatch(json, /ai\.provider|enterprise\.deployment|endpoint\.health|health\.experimental/);
});

test("stored meals map into deterministic scoring records without filling nulls", () => {
  const domainMeal = storedMealToDomain(storedMeal);
  assert.equal(domainMeal.nutrients.carbohydrateG, null);
  assert.equal(domainMeal.analysis.providerId, "custom-provider");
  assert.equal(domainMeal.capturedAt, storedMeal.capturedAtUtc);
});
