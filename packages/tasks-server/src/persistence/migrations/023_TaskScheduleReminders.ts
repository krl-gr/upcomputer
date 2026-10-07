import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Reminders for timed schedule entries. `remind_at` is the instant a
 * reminder is due, computed on every entry write and settings change;
 * `reminder_sent_at` marks it claimed, once. The schedule's time zone (null:
 * the server's) and the reminder settings live in the tasks settings row.
 */
export const TaskScheduleRemindersMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_schedule_entries ADD COLUMN remind_at TEXT`;
  yield* sql`ALTER TABLE task_schedule_entries ADD COLUMN reminder_sent_at TEXT`;
  yield* sql`CREATE INDEX task_schedule_entries_due_reminders
    ON task_schedule_entries(remind_at)
    WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL`;
  yield* sql`ALTER TABLE task_settings ADD COLUMN schedule_time_zone TEXT`;
  yield* sql`ALTER TABLE task_settings ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (reminders_enabled IN (0, 1))`;
  yield* sql`ALTER TABLE task_settings ADD COLUMN reminder_lead_minutes INTEGER NOT NULL DEFAULT 10
    CHECK (reminder_lead_minutes BETWEEN 0 AND 1440)`;
});
