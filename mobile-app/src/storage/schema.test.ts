import assert from "node:assert/strict";
import test from "node:test";

import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  validateMigrationPlan,
} from "./schema";

test("migrations are contiguous and end at the declared schema version", () => {
  assert.doesNotThrow(() => validateMigrationPlan());
  assert.equal(MIGRATIONS.at(-1)?.version, LATEST_SCHEMA_VERSION);
  assert.deepEqual(
    MIGRATIONS.map((migration) => migration.version),
    [1, 2, 3, 4],
  );
});

test("schema contains every permanent record table and no API-secret column", () => {
  const sql = MIGRATIONS.map((migration) => migration.sql).join("\n").toLowerCase();
  for (const table of [
    "profiles",
    "settings",
    "meals",
    "meal_components",
    "analysis_metadata",
    "diary_days",
    "reports",
    "report_input_state",
    "pending_api_secret_cleanup",
  ]) {
    assert.match(sql, new RegExp(`create table ${table}\\b`));
  }
  assert.doesNotMatch(sql, /api[_-]?key\s+(?:text|blob)/);
  assert.doesNotMatch(sql, /secret\s+(?:text|blob)/);
  assert.doesNotMatch(sql, /photo_(?:bytes|base64|blob)/);
  assert.match(sql, /pending_api_secret_cleanup[\s\S]*provider_id text/);
  assert.doesNotMatch(sql, /pending_api_secret_cleanup[\s\S]*secret_value/);
});

test("migration validator rejects a missing version", () => {
  assert.throws(
    () => validateMigrationPlan([{ version: 2, name: "bad", sql: "SELECT 1" }]),
    /contiguous/,
  );
});
