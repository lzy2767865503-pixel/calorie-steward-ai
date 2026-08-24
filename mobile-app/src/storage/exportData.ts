import { listMealsByLocalDateRange } from "./mealRepository";
import {
  getMostRecentlyUpdatedProfile,
  listSettings,
} from "./profileSettingsRepository";
import { listReports } from "./reportRepository";
import { listDiaryDayStatuses } from "./diaryRepository";
import { buildPortableDataExport } from "./portableExport";
import type { PortableDataExport, StoredMeal } from "./types";

const EXPORT_START_DATE = "0001-01-01";
const EXPORT_END_DATE_EXCLUSIVE = "9999-12-31";
const EXPORT_PAGE_SIZE = 5_000;

async function readAllMeals(): Promise<readonly StoredMeal[]> {
  const meals: StoredMeal[] = [];
  let offset = 0;
  while (true) {
    const page = await listMealsByLocalDateRange(
      EXPORT_START_DATE,
      EXPORT_END_DATE_EXCLUSIVE,
      { limit: EXPORT_PAGE_SIZE, offset },
    );
    meals.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
    offset += page.length;
  }
  return meals;
}

/**
 * Builds a JSON-serializable user dietary export.
 *
 * Soft-deleted meals, API secrets, original photos, and operational settings
 * are excluded by design. This is not an administrative backup.
 */
export async function createPortableDataExport(): Promise<PortableDataExport> {
  const [profile, settings, diaryDays, meals, reports] = await Promise.all([
    getMostRecentlyUpdatedProfile(),
    listSettings(),
    listDiaryDayStatuses(EXPORT_START_DATE, EXPORT_END_DATE_EXCLUSIVE),
    readAllMeals(),
    listReports(EXPORT_START_DATE, EXPORT_END_DATE_EXCLUSIVE),
  ]);
  return buildPortableDataExport({
    exportedAtUtc: new Date().toISOString(),
    profile,
    settings,
    diaryDays,
    meals,
    reports,
  });
}
