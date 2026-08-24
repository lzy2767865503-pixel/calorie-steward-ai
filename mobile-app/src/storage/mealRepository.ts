import type { SQLiteBindValue, SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "./database";
import {
  mapAnalysisRow,
  mapComponentRow,
  mapMealRow,
  NUTRIENT_COLUMN_NAMES,
  nutrientBindValues,
  type DatabaseRow,
} from "./rowMappers";
import type { MealListOptions, MealWrite, StoredMeal } from "./types";
import { assertLocalDate, assertMealWrite, assertUtcTimestamp } from "./validation";
import { advanceReportInputRevision } from "./reportInputState";

const MEAL_FIXED_COLUMNS = [
  "id",
  "captured_at_utc",
  "local_date",
  "time_zone",
  "utc_offset_minutes",
  "meal_name",
  "meal_slot",
  "record_status",
  "confirmed_at_utc",
  "confidence",
  "data_coverage",
] as const;

const MEAL_TRAILING_COLUMNS = [
  "nutrient_evidence_json",
  "photo_uri",
  "photo_sha256",
  "revision",
  "created_at_utc",
  "updated_at_utc",
  "deleted_at_utc",
] as const;

const MEAL_COLUMNS = [
  ...MEAL_FIXED_COLUMNS,
  ...NUTRIENT_COLUMN_NAMES,
  ...MEAL_TRAILING_COLUMNS,
];

const MEAL_UPDATE_COLUMNS = [
  ...MEAL_FIXED_COLUMNS.filter((column) => column !== "id"),
  ...NUTRIENT_COLUMN_NAMES,
  "nutrient_evidence_json",
  "photo_uri",
  "photo_sha256",
] as const;

const COMPONENT_FIXED_COLUMNS = [
  "id",
  "meal_id",
  "name",
  "category",
  "preparation_tags_json",
  "sort_order",
  "estimated_grams_low",
  "estimated_grams_estimate",
  "estimated_grams_high",
  "confidence",
] as const;

const COMPONENT_TRAILING_COLUMNS = ["assumptions_json", "created_at_utc"] as const;
const COMPONENT_COLUMNS = [
  ...COMPONENT_FIXED_COLUMNS,
  ...NUTRIENT_COLUMN_NAMES,
  ...COMPONENT_TRAILING_COLUMNS,
];

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

const UPSERT_MEAL_SQL = `
INSERT INTO meals (${MEAL_COLUMNS.join(", ")})
VALUES (${placeholders(MEAL_COLUMNS.length)})
ON CONFLICT(id) DO UPDATE SET
  ${MEAL_UPDATE_COLUMNS.map((column) => `${column} = excluded.${column}`).join(",\n  ")},
  revision = meals.revision + 1,
  updated_at_utc = excluded.updated_at_utc,
  deleted_at_utc = NULL
`;

const INSERT_COMPONENT_SQL = `
INSERT INTO meal_components (${COMPONENT_COLUMNS.join(", ")})
VALUES (${placeholders(COMPONENT_COLUMNS.length)})
`;

const INSERT_ANALYSIS_SQL = `
INSERT INTO analysis_metadata (
  id, meal_id, provider_id, provider_kind, model, endpoint_host, provider_request_id,
  analysis_schema_version, prompt_version, analysis_status,
  request_started_at_utc, received_at_utc, latency_ms,
  normalized_result_json, assumptions_json, warnings_json, created_at_utc
)
VALUES (${placeholders(17)})
`;

function mealValues(meal: MealWrite, now: string): SQLiteBindValue[] {
  return [
    meal.id,
    meal.capturedAtUtc,
    meal.localDate,
    meal.timeZone,
    meal.utcOffsetMinutes,
    meal.mealName,
    meal.mealSlot,
    meal.recordStatus,
    meal.confirmedAtUtc,
    meal.confidence,
    meal.dataCoverage,
    ...nutrientBindValues(meal.nutrients),
    JSON.stringify(meal.nutrientEvidence),
    meal.photoUri,
    meal.photoSha256,
    1,
    now,
    now,
    null,
  ];
}

function componentValues(
  mealId: string,
  component: MealWrite["components"][number],
  now: string,
): SQLiteBindValue[] {
  return [
    component.id,
    mealId,
    component.name,
    component.category,
    JSON.stringify(component.preparationTags),
    component.sortOrder,
    component.estimatedGrams?.low ?? null,
    component.estimatedGrams?.estimate ?? null,
    component.estimatedGrams?.high ?? null,
    component.confidence,
    ...nutrientBindValues(component.nutrients),
    JSON.stringify(component.assumptions),
    now,
  ];
}

async function readMealFrom(
  database: SQLiteDatabase,
  id: string,
  includeDeleted: boolean,
): Promise<StoredMeal | null> {
  const mealRow = await database.getFirstAsync<DatabaseRow>(
    `SELECT * FROM meals WHERE id = ? ${includeDeleted ? "" : "AND deleted_at_utc IS NULL"}`,
    id,
  );
  if (!mealRow) return null;

  const meals = await hydrateMealRows(database, [mealRow]);
  return meals[0] ?? null;
}

async function hydrateMealRows(
  database: SQLiteDatabase,
  mealRows: readonly DatabaseRow[],
): Promise<readonly StoredMeal[]> {
  if (mealRows.length === 0) return [];

  const componentsByMeal = new Map<string, DatabaseRow[]>();
  const analysisByMeal = new Map<string, DatabaseRow>();
  const chunkSize = 400;

  for (let start = 0; start < mealRows.length; start += chunkSize) {
    const chunk = mealRows.slice(start, start + chunkSize);
    const ids = chunk.map((row) => {
      if (typeof row.id !== "string") {
        throw new Error("Corrupt storage row: meal id must be a string.");
      }
      return row.id;
    });
    const inClause = placeholders(ids.length);

    const componentRows = await database.getAllAsync<DatabaseRow>(
      `SELECT * FROM meal_components
       WHERE meal_id IN (${inClause})
       ORDER BY meal_id, sort_order, id`,
      ids,
    );
    for (const component of componentRows) {
      if (typeof component.meal_id !== "string") {
        throw new Error("Corrupt storage row: component meal_id must be a string.");
      }
      const grouped = componentsByMeal.get(component.meal_id) ?? [];
      grouped.push(component);
      componentsByMeal.set(component.meal_id, grouped);
    }

    const analysisRows = await database.getAllAsync<DatabaseRow>(
      `SELECT * FROM analysis_metadata WHERE meal_id IN (${inClause})`,
      ids,
    );
    for (const analysis of analysisRows) {
      if (typeof analysis.meal_id !== "string") {
        throw new Error("Corrupt storage row: analysis meal_id must be a string.");
      }
      analysisByMeal.set(analysis.meal_id, analysis);
    }
  }

  return mealRows.map((mealRow) => {
    if (typeof mealRow.id !== "string") {
      throw new Error("Corrupt storage row: meal id must be a string.");
    }
    const analysis = analysisByMeal.get(mealRow.id);
    if (!analysis) {
      throw new Error(`Corrupt storage: meal ${mealRow.id} has no analysis metadata.`);
    }
    return mapMealRow(
      mealRow,
      (componentsByMeal.get(mealRow.id) ?? []).map(mapComponentRow),
      mapAnalysisRow(analysis),
    );
  });
}

/** Saves and verifies the complete meal inside one commit boundary. */
export async function saveMealBundle(meal: MealWrite): Promise<void> {
  assertMealWrite(meal);
  const database = await getDatabase();
  const now = new Date().toISOString();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const previous = await transaction.getFirstAsync<{ local_date: string }>(
      "SELECT local_date FROM meals WHERE id = ?",
      meal.id,
    );
    await transaction.runAsync(UPSERT_MEAL_SQL, mealValues(meal, now));
    await transaction.runAsync("DELETE FROM meal_components WHERE meal_id = ?", meal.id);
    await transaction.runAsync("DELETE FROM analysis_metadata WHERE meal_id = ?", meal.id);

    for (const component of meal.components) {
      await transaction.runAsync(
        INSERT_COMPONENT_SQL,
        componentValues(meal.id, component, now),
      );
    }

    const analysis = meal.analysis;
    await transaction.runAsync(INSERT_ANALYSIS_SQL, [
      analysis.id,
      meal.id,
      analysis.providerId,
      analysis.providerKind,
      analysis.model,
      analysis.endpointHost,
      analysis.providerRequestId,
      analysis.analysisSchemaVersion,
      analysis.promptVersion,
      analysis.status,
      analysis.requestStartedAtUtc,
      analysis.receivedAtUtc,
      analysis.latencyMs,
      JSON.stringify(analysis.normalizedResult),
      JSON.stringify(analysis.assumptions),
      JSON.stringify(analysis.warnings),
      now,
    ]);

    const affectedDates = new Set([meal.localDate]);
    if (previous?.local_date) affectedDates.add(previous.local_date);
    for (const localDate of affectedDates) {
      await transaction.runAsync(
        `INSERT INTO diary_days(local_date, is_complete, completed_at_utc, updated_at_utc)
         VALUES (?, 0, NULL, ?)
         ON CONFLICT(local_date) DO UPDATE SET
           is_complete = 0,
           completed_at_utc = NULL,
           updated_at_utc = excluded.updated_at_utc`,
        localDate,
        now,
      );
    }
    await advanceReportInputRevision(transaction, now);

    // Hydrate while the transaction is still open. A mapping/read failure now
    // rolls the write back instead of surfacing after an already committed row.
    const verified = await readMealFrom(transaction, meal.id, false);
    if (!verified) {
      throw new Error(`Meal ${meal.id} disappeared before transaction commit.`);
    }
  });
}

export async function getMealById(
  id: string,
  includeDeleted = false,
): Promise<StoredMeal | null> {
  if (!id.trim()) throw new Error("Meal id must not be blank.");
  return readMealFrom(await getDatabase(), id, includeDeleted);
}

export async function listMealsByLocalDateRange(
  startLocalDateInclusive: string,
  endLocalDateExclusive: string,
  options: MealListOptions = {},
): Promise<readonly StoredMeal[]> {
  assertLocalDate(startLocalDateInclusive, "startLocalDateInclusive");
  assertLocalDate(endLocalDateExclusive, "endLocalDateExclusive");
  if (startLocalDateInclusive >= endLocalDateExclusive) {
    throw new Error("Meal range end must be after its start.");
  }
  const limit = options.limit ?? 500;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) {
    throw new Error("Meal list limit must be between 1 and 5000.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Meal list offset must be a non-negative integer.");
  }

  const database = await getDatabase();
  const rows = await database.getAllAsync<DatabaseRow>(
    `SELECT * FROM meals
     WHERE local_date >= ? AND local_date < ?
       ${
         options.includeDeleted === true
           ? ""
           : "AND deleted_at_utc IS NULL AND record_status IN ('confirmed', 'corrected')"
       }
     ORDER BY captured_at_utc DESC, id DESC
     LIMIT ? OFFSET ?`,
    startLocalDateInclusive,
    endLocalDateExclusive,
    limit,
    offset,
  );

  return hydrateMealRows(database, rows);
}

export async function softDeleteMeal(
  id: string,
  deletedAtUtc = new Date().toISOString(),
): Promise<boolean> {
  assertUtcTimestamp(deletedAtUtc, "deletedAtUtc");
  const database = await getDatabase();
  let changed = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ local_date: string }>(
      "SELECT local_date FROM meals WHERE id = ? AND deleted_at_utc IS NULL",
      id,
    );
    if (!row) return;
    const result = await transaction.runAsync(
      `UPDATE meals
       SET deleted_at_utc = ?, updated_at_utc = ?, revision = revision + 1
       WHERE id = ? AND deleted_at_utc IS NULL`,
      deletedAtUtc,
      deletedAtUtc,
      id,
    );
    changed = result.changes === 1;
    if (changed) {
      await transaction.runAsync(
        `INSERT INTO diary_days(local_date, is_complete, completed_at_utc, updated_at_utc)
         VALUES (?, 0, NULL, ?)
         ON CONFLICT(local_date) DO UPDATE SET
           is_complete = 0, completed_at_utc = NULL, updated_at_utc = excluded.updated_at_utc`,
        row.local_date,
        deletedAtUtc,
      );
      await advanceReportInputRevision(transaction, deletedAtUtc);
    }
  });
  return changed;
}

export async function restoreMeal(
  id: string,
  restoredAtUtc = new Date().toISOString(),
): Promise<boolean> {
  assertUtcTimestamp(restoredAtUtc, "restoredAtUtc");
  const database = await getDatabase();
  let changed = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ local_date: string }>(
      "SELECT local_date FROM meals WHERE id = ? AND deleted_at_utc IS NOT NULL",
      id,
    );
    if (!row) return;
    const result = await transaction.runAsync(
      `UPDATE meals
       SET deleted_at_utc = NULL, updated_at_utc = ?, revision = revision + 1
       WHERE id = ? AND deleted_at_utc IS NOT NULL`,
      restoredAtUtc,
      id,
    );
    changed = result.changes === 1;
    if (changed) {
      await transaction.runAsync(
        `INSERT INTO diary_days(local_date, is_complete, completed_at_utc, updated_at_utc)
         VALUES (?, 0, NULL, ?)
         ON CONFLICT(local_date) DO UPDATE SET
           is_complete = 0, completed_at_utc = NULL, updated_at_utc = excluded.updated_at_utc`,
        row.local_date,
        restoredAtUtc,
      );
      await advanceReportInputRevision(transaction, restoredAtUtc);
    }
  });
  return changed;
}

/**
 * Permanently removes one row after the caller has erased its local photo.
 * Cached AI reports whose periods contained the meal are invalidated in the
 * same transaction so deleted dietary data cannot survive in old reports.
 */
export async function purgeMeal(id: string): Promise<string | null> {
  const database = await getDatabase();
  let photoUri: string | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{
      photo_uri: string | null;
      local_date: string;
    }>(
      "SELECT photo_uri, local_date FROM meals WHERE id = ?",
      id,
    );
    if (!row) return;
    photoUri = row.photo_uri;
    await transaction.runAsync(
      `DELETE FROM reports
       WHERE period_start_local_date <= ?
         AND period_end_local_date_exclusive > ?`,
      row.local_date,
      row.local_date,
    );
    await transaction.runAsync("DELETE FROM meals WHERE id = ?", id);
    const now = new Date().toISOString();
    await transaction.runAsync(
      `INSERT INTO diary_days(local_date, is_complete, completed_at_utc, updated_at_utc)
       VALUES (?, 0, NULL, ?)
       ON CONFLICT(local_date) DO UPDATE SET
         is_complete = 0, completed_at_utc = NULL, updated_at_utc = excluded.updated_at_utc`,
      row.local_date,
      now,
    );
    await advanceReportInputRevision(transaction, now);
  });
  return photoUri;
}
