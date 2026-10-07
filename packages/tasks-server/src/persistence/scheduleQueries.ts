import {
  TaskId,
  TaskScheduleEntry,
  TaskScheduleEntryId,
  TaskScheduleEntryStatus,
  TaskScheduleForTaskCursor,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

/** Untimed entries sort after timed ones within a date. */
const UNTIMED_LAST = "~";

/** SQL for `task_schedule_entries`. TaskRepositoryLive runs it in its transactions. */
export function makeScheduleQueries(sql: SqlClient.SqlClient) {
  const REMINDER_UPDATE_FROM = (remindAt: string | null) => sql`
    reminder_sent_at = CASE WHEN remind_at IS ${remindAt} THEN reminder_sent_at ELSE NULL END,
    remind_at = ${remindAt}`;
  const REMINDER_UPDATE = sql`
    reminder_sent_at = CASE WHEN task_schedule_entries.remind_at IS excluded.remind_at
      THEN task_schedule_entries.reminder_sent_at ELSE NULL END,
    remind_at = excluded.remind_at`;

  const COLUMNS = sql`
    id,
    task_id AS "taskId",
    date,
    position,
    start_time AS "startTime",
    duration_minutes AS "durationMinutes",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const byIds = SqlSchema.findAll({
    Request: Schema.Struct({ idsJson: Schema.String }),
    Result: TaskScheduleEntry,
    execute: ({ idsJson }) => sql`
      SELECT ${COLUMNS} FROM task_schedule_entries
      WHERE id IN (SELECT value FROM json_each(${idsJson}))
      ORDER BY date, position`,
  });

  const onDates = SqlSchema.findAll({
    Request: Schema.Struct({ datesJson: Schema.String }),
    Result: TaskScheduleEntry,
    execute: ({ datesJson }) => sql`
      SELECT ${COLUMNS} FROM task_schedule_entries
      WHERE date IN (SELECT value FROM json_each(${datesJson}))
      ORDER BY date, position`,
  });

  const inRange = SqlSchema.findAll({
    Request: Schema.Struct({ from: Schema.String, to: Schema.String }),
    Result: TaskScheduleEntry,
    execute: ({ from, to }) => sql`
      SELECT ${COLUMNS} FROM task_schedule_entries
      WHERE date >= ${from} AND date <= ${to}
      ORDER BY date, position`,
  });

  const forTask = SqlSchema.findAll({
    Request: Schema.Struct({
      taskId: TaskId,
      cursor: Schema.NullOr(TaskScheduleForTaskCursor),
      limit: Schema.Number,
    }),
    Result: TaskScheduleEntry,
    execute: ({ taskId, cursor, limit }) => sql`
      SELECT ${COLUMNS} FROM task_schedule_entries
      WHERE task_id = ${taskId}
        AND (${cursor?.date ?? null} IS NULL
          OR (date, COALESCE(start_time, ${UNTIMED_LAST}), position)
            > (${cursor?.date ?? null}, COALESCE(${cursor?.startTime ?? null}, ${UNTIMED_LAST}),
              ${cursor?.position ?? null}))
      ORDER BY date, COALESCE(start_time, ${UNTIMED_LAST}), position
      LIMIT ${limit}`,
  });

  const progress = SqlSchema.findAll({
    Request: Schema.Struct({
      taskIdsJson: Schema.String,
      from: Schema.NullOr(Schema.String),
      to: Schema.NullOr(Schema.String),
    }),
    Result: Schema.Struct({ taskId: TaskId, total: Schema.Number, handled: Schema.Number }),
    execute: ({ taskIdsJson, from, to }) => sql`
      SELECT task_id AS "taskId", COUNT(*) AS total,
        SUM(CASE WHEN status IN ('done', 'skipped') THEN 1 ELSE 0 END) AS handled
      FROM task_schedule_entries
      WHERE task_id IN (SELECT value FROM json_each(${taskIdsJson}))
        AND (${from} IS NULL OR date >= ${from})
        AND (${to} IS NULL OR date <= ${to})
      GROUP BY task_id`,
  });

  /**
   * Writes a whole entry with its reminder instant. A reminder already sent
   * stays sent while the instant is unchanged (wande's
   * `preserveReminderDeliveryState`); a new instant makes it due again.
   */
  const upsert = SqlSchema.void({
    Request: Schema.Struct({ ...TaskScheduleEntry.fields, remindAt: Schema.NullOr(Schema.String) }),
    execute: (entry) => sql`
      INSERT INTO task_schedule_entries (
        id, task_id, date, position, start_time, duration_minutes, status, created_at, updated_at,
        remind_at
      ) VALUES (
        ${entry.id}, ${entry.taskId}, ${entry.date}, ${entry.position}, ${entry.startTime},
        ${entry.durationMinutes}, ${entry.status}, ${entry.createdAt}, ${entry.updatedAt},
        ${entry.remindAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        task_id = excluded.task_id,
        date = excluded.date,
        position = excluded.position,
        start_time = excluded.start_time,
        duration_minutes = excluded.duration_minutes,
        status = excluded.status,
        updated_at = excluded.updated_at,
        ${REMINDER_UPDATE}`,
  });

  /** Recomputed reminder instants of entries that keep everything else. */
  const setRemindAt = (id: TaskScheduleEntryId, remindAt: string | null) =>
    sql`UPDATE task_schedule_entries SET ${REMINDER_UPDATE_FROM(remindAt)}
      WHERE id = ${id}`.pipe(Effect.asVoid);

  /** The single settings row, as a list for decoding. */
  const settings = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({
      scheduleTimeZone: Schema.NullOr(Schema.String),
      remindersEnabled: Schema.Number,
      reminderLeadMinutes: Schema.Number,
    }),
    execute: () => sql`
      SELECT schedule_time_zone AS "scheduleTimeZone",
        reminders_enabled AS "remindersEnabled",
        reminder_lead_minutes AS "reminderLeadMinutes"
      FROM task_settings WHERE id = 1`,
  });

  const updateSettings = (input: {
    readonly scheduleTimeZone: string | null;
    readonly remindersEnabled: boolean;
    readonly reminderLeadMinutes: number;
  }) =>
    sql`UPDATE task_settings SET
        schedule_time_zone = ${input.scheduleTimeZone},
        reminders_enabled = ${input.remindersEnabled ? 1 : 0},
        reminder_lead_minutes = ${input.reminderLeadMinutes}
      WHERE id = 1`.pipe(Effect.asVoid);

  /**
   * Entries whose reminder may change with the settings or the time: unsent
   * ones, and open timed entries from `fromDate` on (older ones have started).
   */
  const reminderCandidates = SqlSchema.findAll({
    Request: Schema.Struct({ fromDate: Schema.String }),
    Result: Schema.Struct({
      id: TaskScheduleEntryId,
      date: Schema.String,
      startTime: Schema.NullOr(Schema.String),
      status: TaskScheduleEntryStatus,
      remindAt: Schema.NullOr(Schema.String),
    }),
    execute: ({ fromDate }) => sql`
      SELECT id, date, start_time AS "startTime", status, remind_at AS "remindAt"
      FROM task_schedule_entries
      WHERE (remind_at IS NOT NULL AND reminder_sent_at IS NULL)
        OR (status = 'open' AND start_time IS NOT NULL AND date >= ${fromDate})`,
  });

  /** Unsent reminders due at `now`, oldest first, with their task (null when deleted). */
  const dueReminders = SqlSchema.findAll({
    Request: Schema.Struct({ now: Schema.String, limit: Schema.Number }),
    Result: Schema.Struct({
      entryId: TaskScheduleEntryId,
      taskId: TaskId,
      date: Schema.String,
      startTime: Schema.NullOr(Schema.String),
      status: TaskScheduleEntryStatus,
      title: Schema.NullOr(Schema.String),
      taskStatus: Schema.NullOr(Schema.String),
      archivedAt: Schema.NullOr(Schema.String),
    }),
    execute: ({ now, limit }) => sql`
      SELECT e.id AS "entryId", e.task_id AS "taskId", e.date, e.start_time AS "startTime",
        e.status, t.title, t.status AS "taskStatus", t.archived_at AS "archivedAt"
      FROM task_schedule_entries e LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.remind_at IS NOT NULL AND e.reminder_sent_at IS NULL AND e.remind_at <= ${now}
      ORDER BY e.remind_at, e.id
      LIMIT ${limit}`,
  });

  const markReminded = (ids: ReadonlyArray<TaskScheduleEntryId>, at: string) =>
    sql`UPDATE task_schedule_entries SET reminder_sent_at = ${at}
      WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
        AND reminder_sent_at IS NULL`.pipe(Effect.asVoid);

  /**
   * Gives existing rows a unique placeholder position first, so rewriting
   * several positions of one date never collides with a row of the same
   * write that has not moved yet.
   */
  const releasePositions = (ids: ReadonlyArray<TaskScheduleEntryId>) =>
    sql`UPDATE task_schedule_entries SET position = ${UNTIMED_LAST} || id
      WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`.pipe(Effect.asVoid);

  const deleteByIds = (ids: ReadonlyArray<TaskScheduleEntryId>) =>
    sql`DELETE FROM task_schedule_entries
      WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`.pipe(Effect.asVoid);

  const deleteForTask = (taskId: TaskId) =>
    sql`DELETE FROM task_schedule_entries WHERE task_id = ${taskId}`.pipe(Effect.asVoid);

  const datesForTask = (taskId: TaskId) =>
    sql<{ date: string }>`SELECT DISTINCT date FROM task_schedule_entries
      WHERE task_id = ${taskId} ORDER BY date`.pipe(
      Effect.map((rows) => rows.map(({ date }) => date)),
    );

  return {
    byIds,
    onDates,
    inRange,
    forTask,
    progress,
    upsert,
    setRemindAt,
    settings,
    updateSettings,
    reminderCandidates,
    dueReminders,
    markReminded,
    releasePositions,
    deleteByIds,
    deleteForTask,
    datesForTask,
  };
}
