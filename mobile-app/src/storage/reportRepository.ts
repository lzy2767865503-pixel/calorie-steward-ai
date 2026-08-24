import { getDatabase } from "./database";
import {
  mapReportRow,
  nutrientsToColumnObject,
  type DatabaseRow,
} from "./rowMappers";
import type { PeriodType, ReportWrite, StoredReport } from "./types";
import { assertLocalDate, assertReportWrite } from "./validation";
import type { ReportCacheExpectation } from "../app/reportCachePolicy";
import { assertReportInputRevisionCurrent } from "../app/reportCachePolicy";
import { readReportInputRevisionFrom } from "./reportInputState";

const UPSERT_REPORT_SQL = `
INSERT INTO reports (
  id, period_type, period_start_local_date, period_end_local_date_exclusive,
  generated_at_utc, score, score_confidence, data_coverage,
  totals_json, score_result_json, normalized_report_json, narrative, recommendations_json,
  provider_id, provider_kind, model, provider_request_id, report_schema_version,
  prompt_version, input_revision, locale, score_input_version,
  input_fingerprint,
  created_at_utc, updated_at_utc
)
VALUES (${Array.from({ length: 25 }, () => "?").join(", ")})
ON CONFLICT(id) DO UPDATE SET
  period_type = excluded.period_type,
  period_start_local_date = excluded.period_start_local_date,
  period_end_local_date_exclusive = excluded.period_end_local_date_exclusive,
  generated_at_utc = excluded.generated_at_utc,
  score = excluded.score,
  score_confidence = excluded.score_confidence,
  data_coverage = excluded.data_coverage,
  totals_json = excluded.totals_json,
  score_result_json = excluded.score_result_json,
  normalized_report_json = excluded.normalized_report_json,
  narrative = excluded.narrative,
  recommendations_json = excluded.recommendations_json,
  provider_id = excluded.provider_id,
  provider_kind = excluded.provider_kind,
  model = excluded.model,
  provider_request_id = excluded.provider_request_id,
  report_schema_version = excluded.report_schema_version,
  prompt_version = excluded.prompt_version,
  input_revision = excluded.input_revision,
  locale = excluded.locale,
  score_input_version = excluded.score_input_version,
  input_fingerprint = excluded.input_fingerprint,
  updated_at_utc = excluded.updated_at_utc
`;

export async function saveReport(report: ReportWrite): Promise<StoredReport> {
  assertReportWrite(report);
  const database = await getDatabase();
  const now = new Date().toISOString();
  let stored: StoredReport | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const currentRevision = await readReportInputRevisionFrom(transaction);
    assertReportInputRevisionCurrent(report.inputRevision, currentRevision);
    await transaction.runAsync(UPSERT_REPORT_SQL, [
      report.id,
      report.periodType,
      report.periodStartLocalDate,
      report.periodEndLocalDateExclusive,
      report.generatedAtUtc,
      report.score,
      report.scoreConfidence,
      report.dataCoverage,
      JSON.stringify(nutrientsToColumnObject(report.totals)),
      JSON.stringify(report.scoreResult),
      JSON.stringify(report.normalizedReport),
      report.narrative,
      JSON.stringify(report.recommendations),
      report.providerId,
      report.providerKind,
      report.model,
      report.providerRequestId,
      report.reportSchemaVersion,
      report.promptVersion,
      report.inputRevision,
      report.locale,
      report.scoreInputVersion,
      report.inputFingerprint,
      now,
      now,
    ]);
    const row = await transaction.getFirstAsync<DatabaseRow>(
      "SELECT * FROM reports WHERE id = ?",
      report.id,
    );
    stored = row ? mapReportRow(row) : null;
  });
  if (!stored) throw new Error(`Report ${report.id} disappeared after save.`);
  return stored;
}

export async function getReportById(id: string): Promise<StoredReport | null> {
  const row = await (await getDatabase()).getFirstAsync<DatabaseRow>(
    "SELECT * FROM reports WHERE id = ?",
    id,
  );
  return row ? mapReportRow(row) : null;
}

export async function getLatestReport(
  periodType: PeriodType,
  periodStartLocalDate: string,
  periodEndLocalDateExclusive: string,
  expected: ReportCacheExpectation,
): Promise<StoredReport | null> {
  assertLocalDate(periodStartLocalDate, "periodStartLocalDate");
  assertLocalDate(periodEndLocalDateExclusive, "periodEndLocalDateExclusive");
  const database = await getDatabase();
  let row: DatabaseRow | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const currentRevision = await readReportInputRevisionFrom(transaction);
    if (currentRevision !== expected.inputRevision) return;
    row = await transaction.getFirstAsync<DatabaseRow>(
      `SELECT * FROM reports
       WHERE period_type = ?
         AND period_start_local_date = ?
         AND period_end_local_date_exclusive = ?
         AND input_revision = ?
         AND locale = ?
         AND score_input_version = ?
         AND report_schema_version = ?
         AND prompt_version = ?
         AND input_fingerprint = ?
       ORDER BY generated_at_utc DESC, id DESC
       LIMIT 1`,
      periodType,
      periodStartLocalDate,
      periodEndLocalDateExclusive,
      expected.inputRevision,
      expected.locale,
      expected.scoreInputVersion,
      expected.reportSchemaVersion,
      expected.promptVersion,
      expected.inputFingerprint,
    );
  });
  return row ? mapReportRow(row) : null;
}

export async function listReports(
  startLocalDateInclusive: string,
  endLocalDateExclusive: string,
  periodType: PeriodType | null = null,
): Promise<readonly StoredReport[]> {
  assertLocalDate(startLocalDateInclusive, "startLocalDateInclusive");
  assertLocalDate(endLocalDateExclusive, "endLocalDateExclusive");
  if (startLocalDateInclusive >= endLocalDateExclusive) {
    throw new Error("Report range end must be after its start.");
  }
  const database = await getDatabase();
  const rows = periodType
    ? await database.getAllAsync<DatabaseRow>(
        `SELECT * FROM reports
         WHERE period_start_local_date >= ?
           AND period_start_local_date < ?
           AND period_type = ?
         ORDER BY generated_at_utc DESC, id DESC`,
        startLocalDateInclusive,
        endLocalDateExclusive,
        periodType,
      )
    : await database.getAllAsync<DatabaseRow>(
        `SELECT * FROM reports
         WHERE period_start_local_date >= ?
           AND period_start_local_date < ?
         ORDER BY generated_at_utc DESC, id DESC`,
        startLocalDateInclusive,
        endLocalDateExclusive,
      );
  return rows.map(mapReportRow);
}

export async function deleteReport(id: string): Promise<boolean> {
  const result = await (await getDatabase()).runAsync(
    "DELETE FROM reports WHERE id = ?",
    id,
  );
  return result.changes === 1;
}
