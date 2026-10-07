/**
 * When a schedule entry's reminder is due; ported from wande's
 * `convex/lib/pushReminders.ts` (`computeReminderFields`). Entry dates and
 * times are wall-clock values in the schedule's time zone, so the zone turns
 * them into instants here and nowhere else.
 */
import type { TaskScheduleEntryStatus } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export interface ReminderSettings {
  readonly timeZone: string;
  readonly enabled: boolean;
  readonly leadMinutes: number;
}

export interface ReminderSource {
  readonly date: string;
  readonly startTime: string | null;
  readonly status: TaskScheduleEntryStatus;
}

/** The zone the server runs in, which a schedule without its own zone follows. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isTimeZone(value: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0).length > 0;
  } catch {
    return false;
  }
}

/**
 * The instant a wall-clock date and HH:MM time mean in `timeZone`, in epoch
 * milliseconds. A time skipped by a daylight-saving change resolves to the
 * later instant, a repeated one to the earlier. Null for an unknown zone.
 */
export function scheduledInstant(date: string, time: string, timeZone: string): number | null {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return DateTime.makeZoned(Date.UTC(year, month - 1, day, hours, minutes), {
    timeZone,
    adjustForTimeZone: true,
  }).pipe(Option.map(DateTime.toEpochMillis), Option.getOrNull);
}

/**
 * When to remind of an entry, as an ISO instant, or null for no reminder:
 * reminders off, an untimed or handled entry, or one that already started.
 * A lead longer than the time left gives an instant already past, so the
 * reminder goes out at the next sweep.
 */
export function reminderAt(
  source: ReminderSource,
  settings: ReminderSettings,
  now: number,
): string | null {
  if (!settings.enabled || source.startTime === null || source.status !== "open") return null;
  const startsAt = scheduledInstant(source.date, source.startTime, settings.timeZone);
  if (startsAt === null || startsAt <= now) return null;
  return new Date(startsAt - settings.leadMinutes * 60_000).toISOString();
}
