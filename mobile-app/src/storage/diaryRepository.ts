import type { DiaryDay } from "../domain/types";
import { storedMealsToDiaryDay } from "./domainMappers";
import { getDatabase } from "./database";
import { listMealsByLocalDateRange } from "./mealRepository";
import type { DiaryDayStatus } from "./types";
import { assertLocalDate, assertUtcTimestamp } from "./validation";
import { advanceReportInputRevision } from "./reportInputState";

function addOneDay(localDate: string): string {
  assertLocalDate(localDate);
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function mapStatus(row: {
  local_date: string;
  is_complete: number;
  completed_at_utc: string | null;
  updated_at_utc: string;
}): DiaryDayStatus {
  return {
    localDate: row.local_date,
    isComplete: row.is_complete === 1,
    completedAtUtc: row.completed_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

export async function setDiaryDayComplete(
  localDate: string,
  isComplete: boolean,
  updatedAtUtc = new Date().toISOString(),
): Promise<DiaryDayStatus> {
  assertLocalDate(localDate);
  assertUtcTimestamp(updatedAtUtc, "updatedAtUtc");
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO diary_days(local_date, is_complete, completed_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(local_date) DO UPDATE SET
         is_complete = excluded.is_complete,
         completed_at_utc = excluded.completed_at_utc,
         updated_at_utc = excluded.updated_at_utc`,
      localDate,
      isComplete ? 1 : 0,
      isComplete ? updatedAtUtc : null,
      updatedAtUtc,
    );
    await advanceReportInputRevision(transaction, updatedAtUtc);
  });
  return {
    localDate,
    isComplete,
    completedAtUtc: isComplete ? updatedAtUtc : null,
    updatedAtUtc,
  };
}

export async function getDiaryDayStatus(localDate: string): Promise<DiaryDayStatus> {
  assertLocalDate(localDate);
  const row = await (await getDatabase()).getFirstAsync<{
    local_date: string;
    is_complete: number;
    completed_at_utc: string | null;
    updated_at_utc: string;
  }>("SELECT * FROM diary_days WHERE local_date = ?", localDate);
  return row
    ? mapStatus(row)
    : {
        localDate,
        isComplete: false,
        completedAtUtc: null,
        updatedAtUtc: null,
      };
}

export async function loadDiaryDay(localDate: string): Promise<DiaryDay> {
  const days = await loadDiaryDays(localDate, addOneDay(localDate));
  const day = days[0];
  if (!day) throw new Error(`Unable to load diary day ${localDate}.`);
  return day;
}

export async function loadDiaryDays(
  startLocalDateInclusive: string,
  endLocalDateExclusive: string,
): Promise<readonly DiaryDay[]> {
  assertLocalDate(startLocalDateInclusive, "startLocalDateInclusive");
  assertLocalDate(endLocalDateExclusive, "endLocalDateExclusive");
  if (startLocalDateInclusive >= endLocalDateExclusive) {
    throw new Error("Diary range end must be after its start.");
  }

  const [statuses, meals] = await Promise.all([
    listDiaryDayStatuses(startLocalDateInclusive, endLocalDateExclusive),
    readAllMealsInRange(startLocalDateInclusive, endLocalDateExclusive),
  ]);
  const statusByDate = new Map(statuses.map((status) => [status.localDate, status]));
  const mealsByDate = new Map<string, typeof meals[number][]>();
  for (const meal of meals) {
    const grouped = mealsByDate.get(meal.localDate) ?? [];
    grouped.push(meal);
    mealsByDate.set(meal.localDate, grouped);
  }

  const days: DiaryDay[] = [];
  for (let date = startLocalDateInclusive; date < endLocalDateExclusive; date = addOneDay(date)) {
    days.push(
      storedMealsToDiaryDay(
        date,
        statusByDate.get(date)?.isComplete ?? false,
        mealsByDate.get(date) ?? [],
      ),
    );
  }
  return days;
}

async function readAllMealsInRange(
  startLocalDateInclusive: string,
  endLocalDateExclusive: string,
) {
  const meals: Awaited<ReturnType<typeof listMealsByLocalDateRange>>[number][] = [];
  const pageSize = 5_000;
  let offset = 0;
  while (true) {
    const page = await listMealsByLocalDateRange(
      startLocalDateInclusive,
      endLocalDateExclusive,
      { limit: pageSize, offset },
    );
    meals.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return meals;
}

export async function listDiaryDayStatuses(
  startLocalDateInclusive: string,
  endLocalDateExclusive: string,
): Promise<readonly DiaryDayStatus[]> {
  assertLocalDate(startLocalDateInclusive, "startLocalDateInclusive");
  assertLocalDate(endLocalDateExclusive, "endLocalDateExclusive");
  const rows = await (await getDatabase()).getAllAsync<{
    local_date: string;
    is_complete: number;
    completed_at_utc: string | null;
    updated_at_utc: string;
  }>(
    `SELECT * FROM diary_days
     WHERE local_date >= ? AND local_date < ?
     ORDER BY local_date`,
    startLocalDateInclusive,
    endLocalDateExclusive,
  );
  return rows.map(mapStatus);
}
