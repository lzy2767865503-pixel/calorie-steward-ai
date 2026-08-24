import type { SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "./database";

type ReportInputDatabase = Pick<SQLiteDatabase, "getFirstAsync" | "runAsync">;

function assertRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Corrupt report input revision.");
  }
  return value;
}

export async function readReportInputRevisionFrom(
  database: ReportInputDatabase,
): Promise<number> {
  const row = await database.getFirstAsync<{ revision: number }>(
    "SELECT revision FROM report_input_state WHERE singleton_id = 1",
  );
  if (!row) throw new Error("Report input revision is missing.");
  return assertRevision(row.revision);
}

/** Returns the persisted dietary-input epoch. It survives process restarts. */
export async function getReportInputRevision(): Promise<number> {
  return readReportInputRevisionFrom(await getDatabase());
}

/**
 * Advances the dietary-input epoch inside the caller's write transaction.
 * Every mutation that can affect a report must call this before commit.
 */
export async function advanceReportInputRevision(
  database: ReportInputDatabase,
  updatedAtUtc = new Date().toISOString(),
): Promise<number> {
  const result = await database.runAsync(
    `UPDATE report_input_state
     SET revision = revision + 1, updated_at_utc = ?
     WHERE singleton_id = 1`,
    updatedAtUtc,
  );
  if (result.changes !== 1) {
    throw new Error("Unable to advance report input revision.");
  }
  return readReportInputRevisionFrom(database);
}
