/**
 * SQLite schema owned by the mobile client.
 *
 * Migrations are append-only. Never edit SQL that has shipped; add a new
 * migration and advance LATEST_SCHEMA_VERSION instead.
 */

export const DATABASE_NAME = "diet-steward.sqlite";

export type SchemaMigration = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

export const MIGRATION_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
);
`;

const PROFILE_AND_SETTINGS_SQL = `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  birth_date TEXT,
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
  daily_energy_target_kcal REAL CHECK (
    daily_energy_target_kcal IS NULL OR daily_energy_target_kcal > 0
  ),
  population_group TEXT NOT NULL DEFAULT 'healthy_adult' CHECK (
    population_group IN (
      'healthy_adult',
      'child_or_adolescent',
      'pregnant_or_breastfeeding',
      'clinical_diet'
    )
  ),
  special_conditions_json TEXT NOT NULL DEFAULT '[]',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (length(key) BETWEEN 1 AND 96),
  CHECK (lower(key) NOT LIKE '%secret%'),
  CHECK (lower(key) NOT LIKE '%password%'),
  CHECK (lower(key) NOT LIKE '%credential%'),
  CHECK (lower(key) NOT LIKE '%token%'),
  CHECK (lower(key) NOT LIKE '%apikey%'),
  CHECK (lower(key) NOT LIKE '%api_key%')
);
`;

const NUTRIENT_COLUMNS = `
  calories_kcal_low REAL,
  calories_kcal_estimate REAL,
  calories_kcal_high REAL,
  protein_g_low REAL,
  protein_g_estimate REAL,
  protein_g_high REAL,
  carbohydrate_g_low REAL,
  carbohydrate_g_estimate REAL,
  carbohydrate_g_high REAL,
  total_fat_g_low REAL,
  total_fat_g_estimate REAL,
  total_fat_g_high REAL,
  saturated_fat_g_low REAL,
  saturated_fat_g_estimate REAL,
  saturated_fat_g_high REAL,
  trans_fat_g_low REAL,
  trans_fat_g_estimate REAL,
  trans_fat_g_high REAL,
  free_sugar_g_low REAL,
  free_sugar_g_estimate REAL,
  free_sugar_g_high REAL,
  fiber_g_low REAL,
  fiber_g_estimate REAL,
  fiber_g_high REAL,
  sodium_mg_low REAL,
  sodium_mg_estimate REAL,
  sodium_mg_high REAL,
  fruit_vegetable_g_low REAL,
  fruit_vegetable_g_estimate REAL,
  fruit_vegetable_g_high REAL`;

const MEALS_SQL = `
CREATE TABLE meals (
  id TEXT PRIMARY KEY NOT NULL,
  captured_at_utc TEXT NOT NULL,
  local_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  utc_offset_minutes INTEGER NOT NULL CHECK (
    utc_offset_minutes BETWEEN -840 AND 840
  ),
  meal_name TEXT NOT NULL,
  meal_slot TEXT,
  record_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (
    record_status IN ('confirmed', 'corrected', 'archived')
  ),
  confirmed_at_utc TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  data_coverage REAL NOT NULL CHECK (data_coverage BETWEEN 0 AND 1),
  ${NUTRIENT_COLUMNS},
  nutrient_evidence_json TEXT NOT NULL DEFAULT '{}',
  photo_uri TEXT,
  photo_sha256 TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  CHECK (length(local_date) = 10),
  CHECK (
    (photo_uri IS NULL AND photo_sha256 IS NULL) OR
    (photo_uri IS NOT NULL AND photo_sha256 IS NOT NULL AND length(photo_sha256) = 64)
  ),
  CHECK (
    calories_kcal_low IS NULL OR (
      calories_kcal_low >= 0 AND
      calories_kcal_low <= calories_kcal_estimate AND
      calories_kcal_estimate <= calories_kcal_high
    )
  )
);

CREATE TABLE meal_components (
  id TEXT PRIMARY KEY NOT NULL,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'unknown' CHECK (
    category IN (
      'fruit', 'vegetable', 'whole_grain', 'refined_grain', 'pulse',
      'nuts_seeds', 'lean_protein', 'red_processed_meat', 'dairy',
      'oil_fat', 'sweet', 'drink', 'mixed_dish', 'unknown'
    )
  ),
  preparation_tags_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  estimated_grams_low REAL,
  estimated_grams_estimate REAL,
  estimated_grams_high REAL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  ${NUTRIENT_COLUMNS},
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  created_at_utc TEXT NOT NULL,
  CHECK (
    estimated_grams_low IS NULL OR (
      estimated_grams_low >= 0 AND
      estimated_grams_low <= estimated_grams_estimate AND
      estimated_grams_estimate <= estimated_grams_high
    )
  )
);

CREATE TABLE analysis_metadata (
  id TEXT PRIMARY KEY NOT NULL,
  meal_id TEXT NOT NULL UNIQUE REFERENCES meals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint_host TEXT,
  provider_request_id TEXT,
  analysis_schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  analysis_status TEXT NOT NULL CHECK (analysis_status = 'ok'),
  request_started_at_utc TEXT,
  received_at_utc TEXT NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  normalized_result_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at_utc TEXT NOT NULL
);
`;

const REPORTS_AND_INDEXES_SQL = `
CREATE TABLE diary_days (
  local_date TEXT PRIMARY KEY NOT NULL,
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
  completed_at_utc TEXT,
  updated_at_utc TEXT NOT NULL,
  CHECK (length(local_date) = 10)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  period_type TEXT NOT NULL CHECK (
    period_type IN ('day', 'week', 'month', 'year')
  ),
  period_start_local_date TEXT NOT NULL,
  period_end_local_date_exclusive TEXT NOT NULL,
  generated_at_utc TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_confidence REAL NOT NULL CHECK (score_confidence BETWEEN 0 AND 1),
  data_coverage REAL NOT NULL CHECK (data_coverage BETWEEN 0 AND 1),
  totals_json TEXT NOT NULL,
  score_result_json TEXT NOT NULL,
  normalized_report_json TEXT NOT NULL,
  narrative TEXT NOT NULL,
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  provider_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  report_schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (period_start_local_date < period_end_local_date_exclusive)
);

CREATE INDEX idx_meals_active_local_date
  ON meals(local_date, captured_at_utc DESC)
  WHERE deleted_at_utc IS NULL AND record_status IN ('confirmed', 'corrected');

CREATE INDEX idx_meal_components_meal
  ON meal_components(meal_id, sort_order);

CREATE INDEX idx_reports_period
  ON reports(period_type, period_start_local_date, period_end_local_date_exclusive, generated_at_utc DESC);
`;

const REPORT_INPUT_AND_SECRET_CLEANUP_SQL = `
CREATE TABLE report_input_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at_utc TEXT NOT NULL
);

INSERT INTO report_input_state(singleton_id, revision, updated_at_utc)
VALUES (1, 1, '1970-01-01T00:00:00.000Z');

ALTER TABLE reports ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN locale TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN score_input_version TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN input_fingerprint TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_reports_current_input
  ON reports(
    period_type,
    period_start_local_date,
    period_end_local_date_exclusive,
    input_revision,
    locale,
    score_input_version,
    input_fingerprint,
    report_schema_version,
    prompt_version,
    generated_at_utc DESC
  );

-- This queue stores opaque provider identifiers only. API secret values stay
-- exclusively in Keychain/Keystore and are never written to SQLite.
CREATE TABLE pending_api_secret_cleanup (
  provider_id TEXT PRIMARY KEY NOT NULL,
  queued_at_utc TEXT NOT NULL,
  CHECK (length(provider_id) BETWEEN 1 AND 64)
);
`;

export const MIGRATIONS: readonly SchemaMigration[] = Object.freeze([
  { version: 1, name: "profile-and-settings", sql: PROFILE_AND_SETTINGS_SQL },
  { version: 2, name: "meals-components-analysis", sql: MEALS_SQL },
  { version: 3, name: "reports-and-indexes", sql: REPORTS_AND_INDEXES_SQL },
  {
    version: 4,
    name: "report-input-epoch-and-secret-cleanup",
    sql: REPORT_INPUT_AND_SECRET_CLEANUP_SQL,
  },
]);

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

export function validateMigrationPlan(
  migrations: readonly SchemaMigration[] = MIGRATIONS,
): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Storage migrations must be contiguous: expected ${expected}, received ${migration.version}.`,
      );
    }
    if (!migration.name.trim() || !migration.sql.trim()) {
      throw new Error(`Storage migration ${migration.version} is incomplete.`);
    }
  });
}
