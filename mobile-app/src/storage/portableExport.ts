import { LATEST_SCHEMA_VERSION } from "./schema";
import { assertNonSecretSettingKey } from "./secretPolicy";
import { assertNoSensitivePayload } from "./validation";
import type {
  PortableDataExport,
  PortableMealExport,
  PortableReportExport,
  SettingRecord,
  StoredMeal,
  StoredReport,
  StoredUserProfile,
  DiaryDayStatus,
} from "./types";

/**
 * Portable exports are user-facing dietary records, not device or enterprise
 * configuration backups. New keys must be reviewed for privacy before being
 * added here.
 */
const PORTABLE_SETTING_ALLOWLIST = new Set<string>([
  "privacy.retain.photos",
]);

function isActiveMeal(meal: StoredMeal): boolean {
  return (
    meal.deletedAtUtc === null &&
    (meal.recordStatus === "confirmed" || meal.recordStatus === "corrected")
  );
}

export function toPortableMeal(meal: StoredMeal): PortableMealExport {
  // The portable record contains only user-understandable dietary evidence.
  // Provider routing, gateway hosts, models, request ids, protocol versions,
  // latency, and raw normalized payloads are operational diagnostics and must
  // never cross this export boundary.
  const portable = {
    id: meal.id,
    capturedAtUtc: meal.capturedAtUtc,
    localDate: meal.localDate,
    timeZone: meal.timeZone,
    utcOffsetMinutes: meal.utcOffsetMinutes,
    mealName: meal.mealName,
    mealSlot: meal.mealSlot,
    recordStatus: meal.recordStatus,
    confirmedAtUtc: meal.confirmedAtUtc,
    confidence: meal.confidence,
    dataCoverage: meal.dataCoverage,
    nutrients: meal.nutrients,
    nutrientEvidence: meal.nutrientEvidence,
    components: meal.components,
    analysis: {
      assumptions: meal.analysis.assumptions,
      warnings: meal.analysis.warnings,
    },
  };
  assertNoSensitivePayload(portable, `export.meals.${meal.id}`);
  return portable;
}

function toPortableReport(report: StoredReport): PortableReportExport {
  const portable = {
    id: report.id,
    periodType: report.periodType,
    periodStartLocalDate: report.periodStartLocalDate,
    periodEndLocalDateExclusive: report.periodEndLocalDateExclusive,
    generatedAtUtc: report.generatedAtUtc,
    score: report.score,
    scoreConfidence: report.scoreConfidence,
    dataCoverage: report.dataCoverage,
    totals: report.totals,
    narrative: report.narrative,
    recommendations: report.recommendations,
  };
  assertNoSensitivePayload(portable, `export.reports.${report.id}`);
  return portable;
}

export function buildPortableDataExport(input: {
  exportedAtUtc: string;
  profile: StoredUserProfile | null;
  settings: readonly SettingRecord[];
  diaryDays: readonly DiaryDayStatus[];
  meals: readonly StoredMeal[];
  reports: readonly StoredReport[];
}): PortableDataExport {
  const portableSettings = input.settings.filter((setting) =>
    PORTABLE_SETTING_ALLOWLIST.has(setting.key),
  );
  portableSettings.forEach((setting) => {
    assertNonSecretSettingKey(setting.key);
    assertNoSensitivePayload(setting.value, `export.settings.${setting.key}`);
  });
  const exported: PortableDataExport = {
    format: "diet-steward-export",
    formatVersion: 2,
    schemaVersion: LATEST_SCHEMA_VERSION,
    exportedAtUtc: input.exportedAtUtc,
    privacy: {
      containsApiSecrets: false,
      containsRawPhotos: false,
    },
    profile: input.profile,
    settings: portableSettings,
    diaryDays: input.diaryDays,
    meals: input.meals.filter(isActiveMeal).map(toPortableMeal),
    reports: input.reports.map(toPortableReport),
  };
  return exported;
}
