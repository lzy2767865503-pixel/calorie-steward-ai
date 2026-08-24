import { addCalendarDays, assertLocalDate, inclusiveDayCount } from "../domain/periods";

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function localDateFor(date: Date | string, timeZone = deviceTimeZone()): string {
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) throw new Error("无法解析时间。");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("无法生成本地日期。");
  return `${year}-${month}-${day}`;
}

export function todayLocalDate(timeZone = deviceTimeZone()): string {
  return localDateFor(new Date(), timeZone);
}

export function formatLocalDateChinese(localDate: string, locale = "zh-CN"): string {
  assertLocalDate(localDate);
  const date = new Date(`${localDate}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatTime(iso: string, timeZone = deviceTimeZone(), locale = "zh-CN"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

export function utcOffsetMinutesNow(): number {
  return -new Date().getTimezoneOffset();
}

export function enumerateDates(start: string, endInclusive: string): string[] {
  assertLocalDate(start);
  assertLocalDate(endInclusive);
  const count = inclusiveDayCount(start, endInclusive);
  return Array.from({ length: count }, (_, index) => addCalendarDays(start, index));
}
