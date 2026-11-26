import { gtFallback, mFallback, msg, type useGT, type useMessages } from "gt-react";
import {
  calendarScheduleFromCron,
  type CalendarSchedule,
} from "@t3tools/tasks-client/automations/cronSchedule";

export {
  calendarScheduleFromCron,
  calendarScheduleToCron,
  type CalendarSchedule,
  type CalendarScheduleMode,
} from "@t3tools/tasks-client/automations/cronSchedule";

export const WEEKDAYS = [
  { value: 1, shortLabel: msg("Mo"), label: msg("Monday") },
  { value: 2, shortLabel: msg("Tu"), label: msg("Tuesday") },
  { value: 3, shortLabel: msg("We"), label: msg("Wednesday") },
  { value: 4, shortLabel: msg("Th"), label: msg("Thursday") },
  { value: 5, shortLabel: msg("Fr"), label: msg("Friday") },
  { value: 6, shortLabel: msg("Sa"), label: msg("Saturday") },
  { value: 0, shortLabel: msg("Su"), label: msg("Sunday") },
] as const;

/**
 * The schedule in words. Components pass their `useGT()` and `useMessages()`; without them the
 * text stays English.
 */
export function describeCalendarSchedule(
  schedule: CalendarSchedule,
  gt: ReturnType<typeof useGT> = gtFallback,
  m: ReturnType<typeof useMessages> = mFallback,
): string {
  const { time } = schedule;
  if (schedule.mode === "custom") {
    return gt("Custom schedule · {cron}", { cron: schedule.customCron.trim() });
  }
  if (schedule.mode === "daily") return gt("Every day at {time}", { time });
  if (schedule.mode === "monthly") {
    return gt(
      "Monthly on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} at {time}",
      { day: schedule.monthDay, time },
    );
  }
  const labels = WEEKDAYS.filter((day) => schedule.weekdays.includes(day.value)).map((day) =>
    m(day.shortLabel),
  );
  if (labels.length === 7) return gt("Every week on every day at {time}", { time });
  return gt("Every week on {days} at {time}", { days: labels.join(", "), time });
}

export function describeCron(
  cron: string,
  gt: ReturnType<typeof useGT> = gtFallback,
  m: ReturnType<typeof useMessages> = mFallback,
): string {
  return describeCalendarSchedule(calendarScheduleFromCron(cron), gt, m);
}
