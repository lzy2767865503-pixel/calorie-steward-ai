import { REPORT_PROMPT_VERSION } from "../ai/prompts";
import { CURRENT_DIET_SCORE, WHO_FAO_ADULT_STANDARD } from "../domain/standards";
import type { StoredReport } from "../storage/types";

export const REPORT_SCHEMA_VERSION = "diet_report.v1";
export const REPORT_SCORE_INPUT_VERSION = `${CURRENT_DIET_SCORE.version}|${WHO_FAO_ADULT_STANDARD.version}`;

export type ReportCacheExpectation = Readonly<{
  inputRevision: number;
  locale: string;
  scoreInputVersion: string;
  reportSchemaVersion: string;
  promptVersion: string;
  inputFingerprint: string;
}>;

export function currentReportCacheExpectation(
  inputRevision: number,
  locale: string,
  inputFingerprint: string,
): ReportCacheExpectation {
  return {
    inputRevision,
    locale,
    scoreInputVersion: REPORT_SCORE_INPUT_VERSION,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    promptVersion: REPORT_PROMPT_VERSION,
    inputFingerprint,
  };
}

export function reportMatchesCacheExpectation(
  report: Pick<
    StoredReport,
    | "inputRevision"
    | "locale"
    | "scoreInputVersion"
    | "reportSchemaVersion"
    | "promptVersion"
    | "inputFingerprint"
  >,
  expected: ReportCacheExpectation,
): boolean {
  return (
    report.inputRevision === expected.inputRevision &&
    report.locale === expected.locale &&
    report.scoreInputVersion === expected.scoreInputVersion &&
    report.reportSchemaVersion === expected.reportSchemaVersion &&
    report.promptVersion === expected.promptVersion &&
    report.inputFingerprint === expected.inputFingerprint
  );
}

export function assertReportInputRevisionCurrent(
  capturedRevision: number,
  currentRevision: number,
): void {
  if (capturedRevision !== currentRevision) {
    throw new Error(
      "Dietary inputs changed while the AI report was running; discard the stale result.",
    );
  }
}
