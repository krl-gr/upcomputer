export type CalendarScheduleMode = "daily" | "weekly" | "monthly" | "custom";

export interface CalendarSchedule {
  readonly mode: CalendarScheduleMode;
  readonly time: string;
  readonly weekdays: readonly number[];
  readonly monthDay: number;
  readonly customCron: string;
}

export const WEEKDAYS = [
  { value: 1, shortLabel: "Mo", label: "Monday" },
  { value: 2, shortLabel: "Tu", label: "Tuesday" },
  { value: 3, shortLabel: "We", label: "Wednesday" },
  { value: 4, shortLabel: "Th", label: "Thursday" },
  { value: 5, shortLabel: "Fr", label: "Friday" },
  { value: 6, shortLabel: "Sa", label: "Saturday" },
  { value: 0, shortLabel: "Su", label: "Sunday" },
] as const;

const WEEKDAY_ORDER = new Map<number, number>(WEEKDAYS.map((day, index) => [day.value, index]));

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

function ordinal(value: number): string {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function describeCalendarSchedule(schedule: CalendarSchedule): string {
  if (schedule.mode === "custom") return `Custom schedule · ${schedule.customCron.trim()}`;
  if (schedule.mode === "daily") return `Every day at ${schedule.time}`;
  if (schedule.mode === "monthly") {
    return `Monthly on the ${ordinal(schedule.monthDay)} at ${schedule.time}`;
  }
  const labels = WEEKDAYS.filter((day) => schedule.weekdays.includes(day.value)).map(
    (day) => day.shortLabel,
  );
  const days = labels.length === 7 ? "every day" : labels.join(", ");
  return `Every week on ${days} at ${schedule.time}`;
}

export function describeCron(cron: string): string {
  return describeCalendarSchedule(calendarScheduleFromCron(cron));
}
