import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Schedule entries: a person plans a task on a date, optionally at a time for
 * a duration. Rows are the only storage; reads join `tasks` for titles and
 * projects. No foreign key, like the rest of the schema: deleting a task
 * deletes its entries in the same transaction. `position` orders the entries
 * of one date, in the task rank format.
 */
export const TaskScheduleEntriesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE task_schedule_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      date TEXT NOT NULL,
      position TEXT NOT NULL,
      start_time TEXT,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('open', 'done', 'skipped')),
      CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
      CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]')
    )
  `;
  yield* sql`CREATE UNIQUE INDEX task_schedule_entries_date_position
    ON task_schedule_entries(date, position)`;
  yield* sql`CREATE INDEX task_schedule_entries_task_date
    ON task_schedule_entries(task_id, date)`;
});
