/**
 * Calendar days as the planner stores them: YYYY-MM-DD wall-clock dates in the
 * person's time zone (the browser's), never instants. Arithmetic goes through
 * UTC so daylight-saving changes cannot skip or repeat a day.
 */
export type DateKey = string;

const pad = (value: number) => String(value).padStart(2, "0");

export function dateKeyOf(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now = new Date()): DateKey {
  return dateKeyOf(now);
}

function parts(key: DateKey): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

/** A local Date at midnight of the key, for pickers and formatting. */
export function dateOfKey(key: DateKey): Date {
  const [year, month, day] = parts(key);
  return new Date(year, month - 1, day);
}

export function addDays(key: DateKey, days: number): DateKey {
  const [year, month, day] = parts(key);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 0 is Sunday, as `Date.getDay`. */
export function weekdayOf(key: DateKey): number {
  const [year, month, day] = parts(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The first day of the week containing `key`, for a week starting on `weekStartDay`. */
export function weekStartOf(key: DateKey, weekStartDay: number): DateKey {
  return addDays(key, -((weekdayOf(key) - weekStartDay + 7) % 7));
}

export function dateRange(from: DateKey, count: number): DateKey[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

/** Where the week view starts after "Today" or "Go to date": the week start when seven days show. */
export function viewStartFor(key: DateKey, dayCount: number, weekStartDay: number): DateKey {
  return dayCount === 7 ? weekStartOf(key, weekStartDay) : key;
}

export const DAY_COUNT_OPTIONS = [1, 2, 3, 7] as const;
export type DayCount = (typeof DAY_COUNT_OPTIONS)[number];
