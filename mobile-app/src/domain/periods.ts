import { aggregateDiaryDays } from './aggregation';
import { scoreNutritionAggregate } from './scoring';
import { CURRENT_DIET_SCORE } from './standards';
import type {
  DiaryDay,
  LocalDate,
  Period,
  PeriodEvaluation,
  UserProfile,
} from './types';

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertLocalDate(value: LocalDate): void {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Invalid local date: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local date: ${value}`);
  }
}

function parseLocalDate(value: LocalDate): Date {
  assertLocalDate(value);
  const [yearText, monthText, dayText] = value.split('-');
  return new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)),
  );
}

function formatLocalDate(date: Date): LocalDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: LocalDate, amount: number): LocalDate {
  if (!Number.isInteger(amount)) {
    throw new Error('Calendar-day offset must be an integer.');
  }
  const parsed = parseLocalDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return formatLocalDate(parsed);
}

export function inclusiveDayCount(start: LocalDate, end: LocalDate): number {
  const startMs = parseLocalDate(start).getTime();
  const endMs = parseLocalDate(end).getTime();
  if (endMs < startMs) {
    return 0;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function earlierDate(left: LocalDate, right: LocalDate): LocalDate {
  assertLocalDate(left);
  assertLocalDate(right);
  return left <= right ? left : right;
}

export function createCalendarPeriod(
  kind: 'day' | 'week' | 'month' | 'year',
  anchorDate: LocalDate,
  asOfDate: LocalDate,
): Period {
  const anchor = parseLocalDate(anchorDate);
  assertLocalDate(asOfDate);

  if (kind === 'day') {
    return {
      kind,
      startDate: anchorDate,
      endDate: anchorDate,
      asOfDate,
    };
  }

  if (kind === 'week') {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    const startDate = addCalendarDays(anchorDate, -mondayOffset);
    return {
      kind,
      startDate,
      endDate: addCalendarDays(startDate, 6),
      asOfDate,
    };
  }

  if (kind === 'month') {
    const start = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
    );
    return {
      kind,
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
      asOfDate,
    };
  }

  return {
    kind,
    startDate: `${String(anchor.getUTCFullYear()).padStart(4, '0')}-01-01`,
    endDate: `${String(anchor.getUTCFullYear()).padStart(4, '0')}-12-31`,
    asOfDate,
  };
}

function validateUniqueDays(days: readonly DiaryDay[]): void {
  const seen = new Set<LocalDate>();
  for (const day of days) {
    assertLocalDate(day.date);
    if (seen.has(day.date)) {
      throw new Error(`Duplicate diary day: ${day.date}`);
    }
    seen.add(day.date);
  }
}

export function evaluateDiaryDay(
  day: DiaryDay,
  profile: UserProfile,
): PeriodEvaluation {
  validateUniqueDays([day]);
  const aggregate = aggregateDiaryDays([day]);
  const period: Period = {
    kind: 'day',
    startDate: day.date,
    endDate: day.date,
    asOfDate: day.date,
  };
  return {
    period,
    aggregate,
    score: scoreNutritionAggregate(aggregate, profile, {
      completionKind: 'day',
      recordingComplete: day.isComplete,
      minimumEligibleDays: 1,
    }),
    elapsedDayCount: 1,
    completeDayCount: day.isComplete ? 1 : 0,
    recordingCompleteness: day.isComplete ? 1 : 0,
    includedDates: [day.date],
  };
}

export function evaluateCalendarPeriod(
  days: readonly DiaryDay[],
  profile: UserProfile,
  period: Period,
): PeriodEvaluation {
  if (period.kind === 'rolling_28_valid_days') {
    throw new Error('Use evaluateRolling28ValidDays for a rolling period.');
  }
  assertLocalDate(period.startDate);
  assertLocalDate(period.endDate);
  assertLocalDate(period.asOfDate);
  if (period.endDate < period.startDate) {
    throw new Error('Period endDate cannot precede startDate.');
  }
  validateUniqueDays(days);

  const effectiveEnd = earlierDate(period.endDate, period.asOfDate);
  const hasElapsedDays = effectiveEnd >= period.startDate;
  const elapsedDayCount = hasElapsedDays
    ? inclusiveDayCount(period.startDate, effectiveEnd)
    : 0;
  const inScope = hasElapsedDays
    ? days.filter(
        (day) =>
          day.date >= period.startDate && day.date <= effectiveEnd,
      )
    : [];
  const completeDays = inScope
    .filter((day) => day.isComplete)
    .sort((left, right) => left.date.localeCompare(right.date));
  const aggregate = aggregateDiaryDays(completeDays);
  const recordingCompleteness =
    elapsedDayCount === 0 ? 0 : completeDays.length / elapsedDayCount;
  const recordingComplete =
    recordingCompleteness >= CURRENT_DIET_SCORE.minimumRecordingCompleteness;

  return {
    period,
    aggregate,
    score: scoreNutritionAggregate(aggregate, profile, {
      completionKind: period.kind === 'day' ? 'day' : 'period',
      recordingComplete,
      minimumEligibleDays: 1,
    }),
    elapsedDayCount,
    completeDayCount: completeDays.length,
    recordingCompleteness,
    includedDates: completeDays.map((day) => day.date),
  };
}

/**
 * Selects the latest 28 individually valid days, then recomputes the rolling
 * score from their raw meal nutrient ranges (never from rounded daily scores).
 */
export function evaluateRolling28ValidDays(
  days: readonly DiaryDay[],
  profile: UserProfile,
  asOfDate: LocalDate,
): PeriodEvaluation {
  assertLocalDate(asOfDate);
  validateUniqueDays(days);

  const selected = days
    .filter((day) => day.date <= asOfDate)
    .map((day) => ({ day, evaluation: evaluateDiaryDay(day, profile) }))
    .filter(({ evaluation }) => evaluation.score.isValid)
    .sort((left, right) => right.day.date.localeCompare(left.day.date))
    .slice(0, CURRENT_DIET_SCORE.maximumRollingValidDays)
    .map(({ day }) => day)
    .sort((left, right) => left.date.localeCompare(right.date));

  const aggregate = aggregateDiaryDays(selected);
  const startDate = selected[0]?.date ?? asOfDate;
  const elapsedDayCount = inclusiveDayCount(startDate, asOfDate);
  const period: Period = {
    kind: 'rolling_28_valid_days',
    startDate,
    endDate: asOfDate,
    asOfDate,
  };

  return {
    period,
    aggregate,
    score: scoreNutritionAggregate(aggregate, profile, {
      completionKind: 'period',
      recordingComplete: true,
      minimumEligibleDays: CURRENT_DIET_SCORE.minimumRollingValidDays,
    }),
    elapsedDayCount,
    completeDayCount: selected.length,
    recordingCompleteness:
      elapsedDayCount === 0 ? 0 : selected.length / elapsedDayCount,
    includedDates: selected.map((day) => day.date),
  };
}
