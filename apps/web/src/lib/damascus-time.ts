/** Civil periods for Syria. The week starts Saturday, matching the Damascus calendar. */

const ZONE = "Asia/Damascus";

export type CivilDate = { year: number; month: number; day: number };
export type InstantRange = { start: Date; end: Date };
export type TripLogPeriod = "all" | "today" | "tomorrow" | "lastWeek" | "lastMonth";

const dayLabel = new Intl.DateTimeFormat("ar-SY", {
  timeZone: ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const clockLabel = new Intl.DateTimeFormat("ar-SY", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  let hour = pick("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), hour, pick("minute"), pick("second"));
  return asUtc - instant.getTime();
}

function startOfCivilDay(civil: CivilDate): Date {
  const guess = Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(guess));
  let utc = guess - offset;
  const corrected = zoneOffsetMs(new Date(utc));
  if (corrected !== offset) utc = guess - corrected;
  return new Date(utc);
}

function addCivilDays(civil: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function weekdayIndex(civil: CivilDate): number {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
}

export function damascusToday(now = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** Inclusive start and exclusive end, both at Damascus midnight. */
export function tripLogRange(period: Exclude<TripLogPeriod, "all">, now = new Date()): InstantRange {
  const today = damascusToday(now);
  if (period === "today") {
    return { start: startOfCivilDay(today), end: startOfCivilDay(addCivilDays(today, 1)) };
  }
  if (period === "tomorrow") {
    const tomorrow = addCivilDays(today, 1);
    return { start: startOfCivilDay(tomorrow), end: startOfCivilDay(addCivilDays(tomorrow, 1)) };
  }
  if (period === "lastWeek") {
    const sinceSaturday = (weekdayIndex(today) + 1) % 7;
    const thisSaturday = addCivilDays(today, -sinceSaturday);
    const lastSaturday = addCivilDays(thisSaturday, -7);
    return { start: startOfCivilDay(lastSaturday), end: startOfCivilDay(thisSaturday) };
  }
  const thisMonth = { year: today.year, month: today.month, day: 1 };
  const previous = today.month === 1 ? { year: today.year - 1, month: 12, day: 1 } : { year: today.year, month: today.month - 1, day: 1 };
  return { start: startOfCivilDay(previous), end: startOfCivilDay(thisMonth) };
}

export function formatDamascusDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dayLabel.format(date);
}

export function formatDamascusClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return clockLabel.format(date);
}

export function formatDamascusRange(range: InstantRange): string {
  const lastIncluded = new Date(range.end.getTime() - 1);
  const start = dayLabel.format(range.start);
  const end = dayLabel.format(lastIncluded);
  return start === end ? start : `${start} – ${end}`;
}
