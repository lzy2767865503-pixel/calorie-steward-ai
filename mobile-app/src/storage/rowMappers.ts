import type {
  FoodCategory,
  NutrientEvidenceMap,
  PopulationGroup,
  SpecialCondition,
} from "../domain/types";
import type {
  MealAnalysisMetadataWrite,
  MealComponentWrite,
  NutrientRangeValue,
  StoredMeal,
  StoredNutrientTotals,
  StoredReport,
  StoredUserProfile,
} from "./types";

const FOOD_CATEGORIES = new Set<FoodCategory>([
  "fruit",
  "vegetable",
  "whole_grain",
  "refined_grain",
  "pulse",
  "nuts_seeds",
  "lean_protein",
  "red_processed_meat",
  "dairy",
  "oil_fat",
  "sweet",
  "drink",
  "mixed_dish",
  "unknown",
]);

const POPULATION_GROUPS = new Set<PopulationGroup>([
  "healthy_adult",
  "child_or_adolescent",
  "pregnant_or_breastfeeding",
  "clinical_diet",
]);

const SPECIAL_CONDITIONS = new Set<SpecialCondition>([
  "kidney_disease",
  "heart_failure",
  "type_1_diabetes",
  "clinician_prescribed_diet",
  "competitive_athlete",
  "other",
]);

export type DatabaseScalar = string | number | null;
export type DatabaseRow = Record<string, DatabaseScalar>;

export const NUTRIENT_COLUMN_PREFIXES = {
  caloriesKcal: "calories_kcal",
  proteinG: "protein_g",
  carbohydrateG: "carbohydrate_g",
  totalFatG: "total_fat_g",
  saturatedFatG: "saturated_fat_g",
  transFatG: "trans_fat_g",
  freeSugarG: "free_sugar_g",
  fiberG: "fiber_g",
  sodiumMg: "sodium_mg",
  fruitVegetableG: "fruit_vegetable_g",
} as const;

export const NUTRIENT_COLUMN_NAMES: readonly string[] = Object.freeze(
  Object.values(NUTRIENT_COLUMN_PREFIXES).flatMap((prefix) => [
    `${prefix}_low`,
    `${prefix}_estimate`,
    `${prefix}_high`,
  ]),
);

type NutrientName = keyof typeof NUTRIENT_COLUMN_PREFIXES;

function requiredString(row: DatabaseRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new Error(`Corrupt storage row: ${name} must be a string.`);
  }
  return value;
}

function nullableString(row: DatabaseRow, name: string): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Corrupt storage row: ${name} must be a string or null.`);
  }
  return value;
}

function requiredNumber(row: DatabaseRow, name: string): number {
  const value = row[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Corrupt storage row: ${name} must be a finite number.`);
  }
  return value;
}

function nullableNumber(row: DatabaseRow, name: string): number | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Corrupt storage row: ${name} must be a finite number or null.`);
  }
  return value;
}

export function assertValidRange(
  value: NutrientRangeValue | null,
  fieldName = "nutrient",
): void {
  if (value === null) return;
  if (
    !Number.isFinite(value.low) ||
    !Number.isFinite(value.estimate) ||
    !Number.isFinite(value.high) ||
    value.low < 0 ||
    value.low > value.estimate ||
    value.estimate > value.high
  ) {
    throw new Error(`${fieldName} must satisfy 0 <= low <= estimate <= high.`);
  }
}

export function readRange(
  row: DatabaseRow,
  prefix: string,
): NutrientRangeValue | null {
  const low = nullableNumber(row, `${prefix}_low`);
  const estimate = nullableNumber(row, `${prefix}_estimate`);
  const high = nullableNumber(row, `${prefix}_high`);

  if (low === null && estimate === null && high === null) return null;
  if (low === null || estimate === null || high === null) {
    throw new Error(`Corrupt storage row: ${prefix} is only partially populated.`);
  }
  const value = { low, estimate, high };
  assertValidRange(value, prefix);
  return value;
}

export function readNutrients(row: DatabaseRow): StoredNutrientTotals {
  const result = {} as StoredNutrientTotals;
  for (const [name, prefix] of Object.entries(NUTRIENT_COLUMN_PREFIXES) as [
    NutrientName,
    string,
  ][]) {
    result[name] = readRange(row, prefix);
  }
  return result;
}

export function nutrientBindValues(
  nutrients: StoredNutrientTotals,
): readonly (number | null)[] {
  const values: (number | null)[] = [];
  for (const name of Object.keys(NUTRIENT_COLUMN_PREFIXES) as NutrientName[]) {
    const range = nutrients[name];
    assertValidRange(range, name);
    values.push(range?.low ?? null, range?.estimate ?? null, range?.high ?? null);
  }
  return values;
}

function parseStringArray(value: string, fieldName: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Corrupt storage row: ${fieldName} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`Corrupt storage row: ${fieldName} must be a string array.`);
  }
  return parsed;
}

function parseObject(value: string, fieldName: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Corrupt storage row: ${fieldName} is not valid JSON.`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Corrupt storage row: ${fieldName} must be an object.`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function parseNutrientEvidence(value: string): NutrientEvidenceMap {
  const parsed = parseObject(value, "nutrient_evidence_json");
  const allowedFields = new Set(Object.keys(NUTRIENT_COLUMN_PREFIXES));
  const allowedKinds = new Set([
    "single_photo_estimate",
    "multi_photo_estimate",
    "nutrition_label",
    "package_database_match",
    "user_confirmed",
  ]);
  for (const [field, evidence] of Object.entries(parsed)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Corrupt storage row: unknown nutrient evidence field ${field}.`);
    }
    if (evidence === null || Array.isArray(evidence) || typeof evidence !== "object") {
      throw new Error(`Corrupt storage row: evidence ${field} must be an object.`);
    }
    const candidate = evidence as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("notes")) {
      throw new Error(`Corrupt storage row: evidence ${field} has unexpected fields.`);
    }
    if (typeof candidate.kind !== "string" || !allowedKinds.has(candidate.kind)) {
      throw new Error(`Corrupt storage row: evidence ${field} has an unknown kind.`);
    }
    if (
      !Array.isArray(candidate.notes) ||
      !candidate.notes.every((note) => typeof note === "string")
    ) {
      throw new Error(`Corrupt storage row: evidence ${field}.notes must be strings.`);
    }
  }
  return parsed as NutrientEvidenceMap;
}

export function mapComponentRow(row: DatabaseRow): MealComponentWrite {
  const category = requiredString(row, "category") as FoodCategory;
  if (!FOOD_CATEGORIES.has(category)) {
    throw new Error(`Corrupt storage row: unknown food category ${category}.`);
  }
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    category,
    preparationTags: parseStringArray(
      requiredString(row, "preparation_tags_json"),
      "preparation_tags_json",
    ),
    sortOrder: requiredNumber(row, "sort_order"),
    estimatedGrams: readRange(row, "estimated_grams"),
    confidence: requiredNumber(row, "confidence"),
    nutrients: readNutrients(row),
    assumptions: parseStringArray(requiredString(row, "assumptions_json"), "assumptions_json"),
  };
}

export function mapAnalysisRow(row: DatabaseRow): MealAnalysisMetadataWrite {
  const status = requiredString(row, "analysis_status");
  if (status !== "ok") {
    throw new Error("Only validated analysis_status=ok rows are recordable.");
  }
  return {
    id: requiredString(row, "id"),
    providerId: requiredString(row, "provider_id"),
    providerKind: requiredString(row, "provider_kind"),
    model: requiredString(row, "model"),
    endpointHost: nullableString(row, "endpoint_host"),
    providerRequestId: nullableString(row, "provider_request_id"),
    analysisSchemaVersion: requiredString(row, "analysis_schema_version"),
    promptVersion: requiredString(row, "prompt_version"),
    status,
    requestStartedAtUtc: nullableString(row, "request_started_at_utc"),
    receivedAtUtc: requiredString(row, "received_at_utc"),
    latencyMs: requiredNumber(row, "latency_ms"),
    normalizedResult: parseObject(
      requiredString(row, "normalized_result_json"),
      "normalized_result_json",
    ),
    assumptions: parseStringArray(requiredString(row, "assumptions_json"), "assumptions_json"),
    warnings: parseStringArray(requiredString(row, "warnings_json"), "warnings_json"),
  };
}

export function mapMealRow(
  row: DatabaseRow,
  components: readonly MealComponentWrite[],
  analysis: MealAnalysisMetadataWrite,
): StoredMeal {
  const recordStatus = requiredString(row, "record_status");
  if (recordStatus !== "confirmed" && recordStatus !== "corrected" && recordStatus !== "archived") {
    throw new Error(`Corrupt storage row: unknown record_status ${recordStatus}.`);
  }
  return {
    id: requiredString(row, "id"),
    capturedAtUtc: requiredString(row, "captured_at_utc"),
    localDate: requiredString(row, "local_date"),
    timeZone: requiredString(row, "time_zone"),
    utcOffsetMinutes: requiredNumber(row, "utc_offset_minutes"),
    mealName: requiredString(row, "meal_name"),
    mealSlot: nullableString(row, "meal_slot"),
    recordStatus,
    confirmedAtUtc: requiredString(row, "confirmed_at_utc"),
    confidence: requiredNumber(row, "confidence"),
    dataCoverage: requiredNumber(row, "data_coverage"),
    nutrients: readNutrients(row),
    nutrientEvidence: parseNutrientEvidence(
      requiredString(row, "nutrient_evidence_json"),
    ),
    photoUri: nullableString(row, "photo_uri"),
    photoSha256: nullableString(row, "photo_sha256"),
    components,
    analysis,
    revision: requiredNumber(row, "revision"),
    createdAtUtc: requiredString(row, "created_at_utc"),
    updatedAtUtc: requiredString(row, "updated_at_utc"),
    deletedAtUtc: nullableString(row, "deleted_at_utc"),
  };
}

export function mapProfileRow(row: DatabaseRow): StoredUserProfile {
  const populationGroup = requiredString(row, "population_group") as PopulationGroup;
  if (!POPULATION_GROUPS.has(populationGroup)) {
    throw new Error(`Corrupt storage row: unknown population_group ${populationGroup}.`);
  }
  const specialConditions = parseStringArray(
    requiredString(row, "special_conditions_json"),
    "special_conditions_json",
  );
  if (!specialConditions.every((condition) => SPECIAL_CONDITIONS.has(condition as SpecialCondition))) {
    throw new Error("Corrupt storage row: unknown special condition.");
  }
  return {
    id: requiredString(row, "id"),
    birthDate: nullableString(row, "birth_date"),
    weightKg: nullableNumber(row, "weight_kg"),
    dailyEnergyTargetKcal: nullableNumber(row, "daily_energy_target_kcal"),
    populationGroup,
    specialConditions: specialConditions as readonly SpecialCondition[],
    locale: requiredString(row, "locale"),
    createdAtUtc: requiredString(row, "created_at_utc"),
    updatedAtUtc: requiredString(row, "updated_at_utc"),
  };
}

export function mapReportRow(row: DatabaseRow): StoredReport {
  const periodType = requiredString(row, "period_type");
  if (periodType !== "day" && periodType !== "week" && periodType !== "month" && periodType !== "year") {
    throw new Error(`Corrupt storage row: unknown period_type ${periodType}.`);
  }
  return {
    id: requiredString(row, "id"),
    periodType,
    periodStartLocalDate: requiredString(row, "period_start_local_date"),
    periodEndLocalDateExclusive: requiredString(row, "period_end_local_date_exclusive"),
    generatedAtUtc: requiredString(row, "generated_at_utc"),
    score: requiredNumber(row, "score"),
    scoreConfidence: requiredNumber(row, "score_confidence"),
    dataCoverage: requiredNumber(row, "data_coverage"),
    totals: readNutrients(JSON.parse(requiredString(row, "totals_json")) as DatabaseRow),
    scoreResult: parseObject(requiredString(row, "score_result_json"), "score_result_json"),
    normalizedReport: parseObject(
      requiredString(row, "normalized_report_json"),
      "normalized_report_json",
    ),
    narrative: requiredString(row, "narrative"),
    recommendations: parseStringArray(
      requiredString(row, "recommendations_json"),
      "recommendations_json",
    ),
    providerId: requiredString(row, "provider_id"),
    providerKind: requiredString(row, "provider_kind"),
    model: requiredString(row, "model"),
    providerRequestId: nullableString(row, "provider_request_id"),
    reportSchemaVersion: requiredString(row, "report_schema_version"),
    promptVersion: requiredString(row, "prompt_version"),
    inputRevision: requiredNumber(row, "input_revision"),
    locale: requiredString(row, "locale"),
    scoreInputVersion: requiredString(row, "score_input_version"),
    inputFingerprint: requiredString(row, "input_fingerprint"),
    createdAtUtc: requiredString(row, "created_at_utc"),
    updatedAtUtc: requiredString(row, "updated_at_utc"),
  };
}

export function nutrientsToColumnObject(
  nutrients: StoredNutrientTotals,
): DatabaseRow {
  const row: DatabaseRow = {};
  for (const [name, prefix] of Object.entries(NUTRIENT_COLUMN_PREFIXES) as [
    NutrientName,
    string,
  ][]) {
    const value = nutrients[name];
    assertValidRange(value, name);
    row[`${prefix}_low`] = value?.low ?? null;
    row[`${prefix}_estimate`] = value?.estimate ?? null;
    row[`${prefix}_high`] = value?.high ?? null;
  }
  return row;
}
