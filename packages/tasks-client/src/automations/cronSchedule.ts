/**
 * An automation's cron schedule as the calendar picker edits it: daily, weekly or monthly at a
 * time, or a custom expression. The desktop's automation window and the iPhone app share it.
 */
export type CalendarScheduleMode = "daily" | "weekly" | "monthly" | "custom";

export interface CalendarSchedule {
  readonly mode: CalendarScheduleMode;
  readonly time: string;
  readonly weekdays: readonly number[];
  readonly monthDay: number;
  readonly customCron: string;
}

/** Cron weekday numbers in the week's display order, Monday first. */
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAY_ORDER = new Map<number, number>(WEEKDAY_VALUES.map((day, index) => [day, index]));

function parseInteger(value: string, minimum: number, maximum: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseWeekdays(value: string): readonly number[] | null {
  const selected = new Set<number>();
  for (const part of value.split(",")) {
    const range = part.split("-");
    if (range.length === 1) {
      const day = parseInteger(range[0] ?? "", 0, 7);
      if (day === null) return null;
      selected.add(day === 7 ? 0 : day);
      continue;
    }
    if (range.length !== 2) return null;
    const start = parseInteger(range[0] ?? "", 0, 7);
    const end = parseInteger(range[1] ?? "", 0, 7);
    if (start === null || end === null || start > end) return null;
    for (let day = start; day <= end; day += 1) selected.add(day === 7 ? 0 : day);
  }
  return [...selected].sort(
    (left, right) => (WEEKDAY_ORDER.get(left) ?? 0) - (WEEKDAY_ORDER.get(right) ?? 0),
  );
}

function timeFromParts(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function calendarScheduleFromCron(cron: string): CalendarSchedule {
  const fallback: CalendarSchedule = {
    mode: "custom",
    time: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 1,
    customCron: cron,
  };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return fallback;
  const [minuteValue, hourValue, monthDayValue, monthValue, weekdayValue] = fields;
  const minute = parseInteger(minuteValue ?? "", 0, 59);
  const hour = parseInteger(hourValue ?? "", 0, 23);
  if (minute === null || hour === null || monthValue !== "*") return fallback;
  const time = timeFromParts(hour, minute);

  if (monthDayValue === "*" && weekdayValue === "*") {
    return { ...fallback, mode: "daily", time };
  }
  if (monthDayValue === "*") {
    const weekdays = parseWeekdays(weekdayValue ?? "");
    if (weekdays && weekdays.length > 0) {
      return { ...fallback, mode: "weekly", time, weekdays };
    }
  }
  if (weekdayValue === "*") {
    const monthDay = parseInteger(monthDayValue ?? "", 1, 31);
    if (monthDay !== null) return { ...fallback, mode: "monthly", time, monthDay };
  }
  return fallback;
}

function cronTime(time: string): { readonly hour: number; readonly minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = parseInteger(match[1] ?? "", 0, 23);
  const minute = parseInteger(match[2] ?? "", 0, 59);
  return hour === null || minute === null ? null : { hour, minute };
}

export function calendarScheduleToCron(schedule: CalendarSchedule): string | null {
  if (schedule.mode === "custom") {
    const cron = schedule.customCron.trim();
    const count = cron.split(/\s+/).filter(Boolean).length;
    return count === 5 || count === 6 ? cron : null;
  }
  const time = cronTime(schedule.time);
  if (!time) return null;
  const prefix = `${time.minute} ${time.hour}`;
  if (schedule.mode === "daily") return `${prefix} * * *`;
  if (schedule.mode === "monthly") {
    if (schedule.monthDay < 1 || schedule.monthDay > 31) return null;
    return `${prefix} ${schedule.monthDay} * *`;
  }
  const weekdays = [...new Set(schedule.weekdays)].sort(
    (left, right) => (WEEKDAY_ORDER.get(left) ?? 0) - (WEEKDAY_ORDER.get(right) ?? 0),
  );
  if (weekdays.length === 0 || weekdays.some((day) => !WEEKDAY_ORDER.has(day))) return null;
  return `${prefix} * * ${weekdays.join(",")}`;
}

/** A time today, else a short date (and the year when it is not this year), in `locale`. */
export function shortDateTime(value: string, locale?: string, now = new Date()): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
  const time = parsed.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const date = parsed.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(parsed.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date} ${time}`;
}
