import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

import { validMeal } from "../ai/__tests__/fixtures";
import { validateMealAnalysis, type AiCallResult, type MealAnalysisV1, type ProviderConfig } from "../ai";
import { normalizeMealAnalysisPayload } from "../ai/normalization";
import { MEAL_PROMPT_VERSION } from "../ai/prompts";
import { addCalendarDays, evaluateDiaryDay, evaluateRolling28ValidDays } from "../domain/periods";
import type { PreparedPhoto } from "../screens/CameraScreen";
import { storedMealsToDiaryDay } from "../storage/domainMappers";
import type { StoredMeal } from "../storage/types";

type ModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

const moduleLoader = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleLoader._load;
const retainedBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
const digestBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
const copied: Array<{ from: string; to: string }> = [];
const deleted: string[] = [];
const queued: string[] = [];
const digestedInputs: Uint8Array[] = [];
let failDigest = false;
let fileStillExistsAfterDelete = false;
let uuidSequence = 0;

class MockFile {
  constructor(readonly uri: string) {}

  async bytes(): Promise<Uint8Array> {
    return retainedBytes;
  }
}

moduleLoader._load = (request, parent, isMain) => {
  if (request === "expo-file-system/legacy") {
    return {
      documentDirectory: "file:///documents/",
      cacheDirectory: "file:///cache/",
      EncodingType: { UTF8: "utf8" },
      makeDirectoryAsync: async () => undefined,
      copyAsync: async ({ from, to }: { from: string; to: string }) => {
        copied.push({ from, to });
      },
      deleteAsync: async (uri: string) => {
        deleted.push(uri);
      },
      getInfoAsync: async () => ({
        exists: fileStillExistsAfterDelete,
        isDirectory: false,
      }),
      writeAsStringAsync: async () => undefined,
    };
  }
  if (request === "expo-file-system") {
    return { File: MockFile };
  }
  if (request === "expo-crypto") {
    return {
      CryptoDigestAlgorithm: { SHA256: "SHA-256" },
      digest: async (algorithm: string, bytes: Uint8Array) => {
        assert.equal(algorithm, "SHA-256");
        digestedInputs.push(Uint8Array.from(bytes));
        if (failDigest) throw new Error("digest unavailable");
        return digestBytes.buffer;
      },
      randomUUID: () => `uuid-${++uuidSequence}`,
    };
  }
  return originalLoad(request, parent, isMain);
};

const { createExportFileUri, deleteLocalPhoto, retainMealPhoto, writeExportFile } = require("./photoFiles") as typeof import("./photoFiles");
const { createMealWrite } = require("./mealMapping") as typeof import("./mealMapping");
moduleLoader._load = originalLoad;

function mealArgs(overrides: {
  retainedPhotoUri?: string | null;
  retainedPhotoSha256?: string | null;
  language?: "zh" | "en";
  inferredComponent?: boolean;
} = {}) {
  const baseMeal = validMeal();
  const result: AiCallResult<MealAnalysisV1> = {
    data: overrides.inferredComponent
      ? {
          ...baseMeal,
          components: baseMeal.components.map((component, index) =>
            index === 0 ? { ...component, visibility: "inferred" as const } : component,
          ),
        }
      : baseMeal,
    metadata: {
      provider_kind: "openai_responses",
      requested_model: "vision-model",
      model: "vision-model",
      actual_model: "vision-model",
      provider_request_id: "request-1",
      received_at: "2026-08-24T02:00:30.000Z",
      latency_ms: 1_200,
    },
  };
  const photo: PreparedPhoto = {
    uri: "file:///cache/reencoded.jpg",
    base64: "/9j/4A==",
    mimeType: "image/jpeg",
    width: 800,
    height: 600,
    capturedAt: "2026-08-24T02:00:00.000Z",
  };
  const config: ProviderConfig = {
    id: "provider-1",
    displayName: "Managed provider",
    kind: "openai_responses",
    baseUrl: "https://gateway.example/v1",
    visionModel: "vision-model",
    reportModel: "report-model",
    apiVersion: "",
    authType: "bearer",
    customAuthHeader: null,
    timeoutMs: 60_000,
    allowInsecureLocalhost: false,
  };
  return {
    result,
    photo,
    config,
    localDate: "2026-08-24",
    timeZone: "Asia/Kuala_Lumpur",
    utcOffsetMinutes: 480,
    portionFactor: 1,
    language: overrides.language ?? "en",
    retainedPhotoUri: overrides.retainedPhotoUri ?? null,
    ...(overrides.retainedPhotoSha256 !== undefined
      ? { retainedPhotoSha256: overrides.retainedPhotoSha256 }
      : {}),
  };
}

test("retained photos return the SHA-256 of the copied file bytes", async () => {
  copied.length = 0;
  deleted.length = 0;
  digestedInputs.length = 0;
  failDigest = false;

  const retained = await retainMealPhoto("file:///cache/reencoded.jpg", "meal-1");

  assert.deepEqual(copied, [
    {
      from: "file:///cache/reencoded.jpg",
      to: "file:///documents/meal-photos/meal-1.jpg",
    },
  ]);
  assert.deepEqual(digestedInputs, [retainedBytes]);
  assert.equal(retained.uri, "file:///documents/meal-photos/meal-1.jpg");
  assert.equal(
    retained.sha256,
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  );
  assert.deepEqual(deleted, []);
});

test("a retained copy is removed when its digest cannot be produced", async () => {
  deleted.length = 0;
  failDigest = true;

  await assert.rejects(
    retainMealPhoto("file:///cache/reencoded.jpg", "meal-failed"),
    /digest unavailable/,
  );
  assert.deepEqual(deleted, [
    "file:///documents/meal-photos/meal-failed.jpg",
  ]);
  failDigest = false;
});

test("a retained copy that cannot be immediately removed is queued before the digest error returns", async () => {
  deleted.length = 0;
  queued.length = 0;
  failDigest = true;
  fileStillExistsAfterDelete = true;

  await assert.rejects(
    retainMealPhoto(
      "file:///cache/reencoded.jpg",
      "meal-queued",
      async (uri) => {
        queued.push(uri);
      },
    ),
    /digest unavailable/,
  );
  assert.deepEqual(deleted, [
    "file:///documents/meal-photos/meal-queued.jpg",
  ]);
  assert.deepEqual(queued, [
    "file:///documents/meal-photos/meal-queued.jpg",
  ]);
  failDigest = false;
  fileStillExistsAfterDelete = false;
});

test("export files can only be written to the generated private cache family", async () => {
  const uri = createExportFileUri("export-1");
  assert.equal(uri, "file:///cache/calorie-steward-export-export-1.json");
  await writeExportFile(uri, "{}");
  await assert.rejects(
    writeExportFile("file:///documents/calorie-steward-export-secret.json", "{}"),
    /App 私有缓存目录/,
  );
});

test("private file deletion verifies absence before callers discard its database pointer", async () => {
  deleted.length = 0;
  fileStillExistsAfterDelete = false;
  await deleteLocalPhoto("file:///documents/meal-photos/deleted.jpg");
  assert.deepEqual(deleted, ["file:///documents/meal-photos/deleted.jpg"]);

  fileStillExistsAfterDelete = true;
  await assert.rejects(
    deleteLocalPhoto("file:///documents/meal-photos/retry.jpg"),
    /仍然存在|重试/,
  );
  assert.deepEqual(deleted, [
    "file:///documents/meal-photos/deleted.jpg",
    "file:///documents/meal-photos/retry.jpg",
  ]);
  fileStillExistsAfterDelete = false;
});

test("meal writes persist retained photo URI and SHA-256 as a pair", () => {
  const photoSha256 = "a".repeat(64);
  const meal = createMealWrite(
    mealArgs({
      retainedPhotoUri: "file:///documents/meal-photos/meal-1.jpg",
      retainedPhotoSha256: photoSha256,
    }),
  );

  assert.equal(meal.photoUri, "file:///documents/meal-photos/meal-1.jpg");
  assert.equal(meal.photoSha256, photoSha256);
  assert.equal(meal.analysis.promptVersion, MEAL_PROMPT_VERSION);
});

test("inferred-component evidence follows the selected export language", () => {
  const english = createMealWrite(
    mealArgs({ inferredComponent: true, language: "en" }),
  );
  const chinese = createMealWrite(
    mealArgs({ inferredComponent: true, language: "zh" }),
  );

  assert.equal(
    english.components[0]?.assumptions[0],
    "This component was inferred by AI and is not fully visible",
  );
  assert.equal(chinese.components[0]?.assumptions[0], "该组分为 AI 推断，未完全可见");
});

test("meal writes reject partial or malformed retained-photo evidence", () => {
  assert.throws(
    () =>
      createMealWrite(
        mealArgs({ retainedPhotoUri: "file:///documents/orphan.jpg" }),
      ),
    /must exist together|must be present together|必须同时存在/,
  );
  assert.throws(
    () => createMealWrite(mealArgs({ retainedPhotoSha256: "b".repeat(64) })),
    /必须同时存在/,
  );
  assert.throws(
    () =>
      createMealWrite(
        mealArgs({
          retainedPhotoUri: "file:///documents/bad.jpg",
          retainedPhotoSha256: "not-a-sha256",
        }),
      ),
    /SHA-256/,
  );
});

test("validated photo-only meals produce valid v1.1 daily and rolling scores without inventing hidden nutrients", () => {
  const normalized = normalizeMealAnalysisPayload(
    {
      status: "ok",
      meal_name: "Photographed balanced meal",
      components: [
        {
          name: "Visible balanced plate",
          preparation: "cooked",
          visibility: "visible",
          weight_g: { value: 300, lower: 280, upper: 320, confidence: 0.9 },
          energy_kcal: { value: 667, lower: 645, upper: 685, confidence: 0.9 },
          protein_g: { value: 21.7, lower: 20.7, upper: 22.7, confidence: 0.9 },
          carbohydrate_g: { value: 91.7, lower: 90, upper: 93.3, confidence: 0.9 },
          fat_g: { value: 18.3, lower: 17.3, upper: 19.3, confidence: 0.9 },
        },
      ],
      totals: {
        energy_kcal: { value: 667, lower: 645, upper: 685, confidence: 0.9 },
        protein_g: { value: 21.7, lower: 20.7, upper: 22.7, confidence: 0.9 },
        carbohydrate_g: { value: 91.7, lower: 90, upper: 93.3, confidence: 0.9 },
        fat_g: { value: 18.3, lower: 17.3, upper: 19.3, confidence: 0.9 },
        fiber_g: { value: 10, lower: 9.3, upper: 10.7, confidence: 0.85 },
        fruit_vegetable_g: { value: 150, lower: 140, upper: 160, confidence: 0.85 },
        // Even if a provider guesses these, the compatibility normalizer and
        // strict validator must keep them unsupported in photo-only v1.
        saturated_fat_g: { value: 10, lower: 8, upper: 12, confidence: 0.7 },
        trans_fat_g: { value: 0.5, lower: 0.2, upper: 0.8, confidence: 0.7 },
        free_sugars_g: { value: 20, lower: 15, upper: 25, confidence: 0.7 },
        sodium_mg: { value: 1500, lower: 1200, upper: 1800, confidence: 0.7 },
      },
      quality: {
        image_quality: 0.95,
        identification_confidence: 0.9,
        portion_confidence: 0.9,
        nutrition_confidence: 0.85,
        assumptions: ["Serving scale is inferred from the visible plate."],
        uncertainties: ["Hidden seasonings cannot be observed."],
      },
    },
    "en-US",
  );
  const analysis = validateMealAnalysis(normalized, "openai_responses");

  assert.equal(analysis.quality.data_coverage, 0.6);
  assert.equal(analysis.totals.saturated_fat_g.available, false);
  assert.equal(analysis.totals.trans_fat_g.available, false);
  assert.equal(analysis.totals.free_sugars_g.available, false);
  assert.equal(analysis.totals.sodium_mg.available, false);

  const write = createMealWrite({
    ...mealArgs(),
    result: {
      data: analysis,
      metadata: {
        provider_kind: "openai_responses",
        requested_model: "vision-model",
        model: "vision-model",
        actual_model: "vision-model",
        provider_request_id: "photo-score-regression",
        received_at: "2026-08-24T02:00:30.000Z",
        latency_ms: 1_200,
      },
    },
  });

  assert.equal(write.nutrients.saturatedFatG, null);
  assert.equal(write.nutrients.transFatG, null);
  assert.equal(write.nutrients.freeSugarG, null);
  assert.equal(write.nutrients.sodiumMg, null);
  assert.equal(write.nutrientEvidence.sodiumMg, undefined);

  const asStoredMeal = (date: string, index: number): StoredMeal => ({
    ...write,
    id: `photo-meal-${index}`,
    capturedAtUtc: `${date}T02:00:00.000Z`,
    localDate: date,
    confirmedAtUtc: `${date}T02:01:00.000Z`,
    analysis: {
      ...write.analysis,
      id: `photo-analysis-${index}`,
      receivedAtUtc: `${date}T02:00:30.000Z`,
    },
    revision: 1,
    createdAtUtc: `${date}T02:01:00.000Z`,
    updatedAtUtc: `${date}T02:01:00.000Z`,
    deletedAtUtc: null,
  });

  const firstDate = "2026-08-18";
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addCalendarDays(firstDate, index);
    return storedMealsToDiaryDay(
      date,
      true,
      Array.from({ length: 3 }, (_, mealIndex) =>
        asStoredMeal(date, index * 3 + mealIndex),
      ),
    );
  });
  const daily = evaluateDiaryDay(days[0]!, {
    id: "photo-score-profile",
    populationGroup: "healthy_adult",
    birthDate: "1995-01-01",
    weightKg: 70,
    dailyEnergyTargetKcal: 2000,
    specialConditions: [],
  });

  assert.equal(daily.score.version, "DietScore-v1.1");
  assert.equal(daily.score.coverage, 1);
  assert.equal(daily.score.isValid, true);
  assert.equal(daily.score.score?.estimate, 100);
  assert.equal(
    daily.score.metrics.some((metric) => metric.key === "sodium"),
    false,
  );

  const rolling = evaluateRolling28ValidDays(
    days,
    {
      id: "photo-score-profile",
      populationGroup: "healthy_adult",
      birthDate: "1995-01-01",
      weightKg: 70,
      dailyEnergyTargetKcal: 2000,
      specialConditions: [],
    },
    addCalendarDays(firstDate, 6),
  );

  assert.equal(rolling.includedDates.length, 7);
  assert.equal(rolling.score.version, "DietScore-v1.1");
  assert.equal(rolling.score.coverage, 1);
  assert.equal(rolling.score.isValid, true);
  assert.equal(rolling.score.score?.estimate, 100);
});
