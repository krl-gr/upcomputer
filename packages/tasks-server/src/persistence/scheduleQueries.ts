import {
  TaskId,
  TaskScheduleEntry,
  TaskScheduleForTaskCursor,
  type TaskScheduleEntryId,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

/** Untimed entries sort after timed ones within a date. */
const UNTIMED_LAST = "~";

/** SQL for `task_schedule_entries`. TaskRepositoryLive runs it in its transactions. */
export function makeScheduleQueries(sql: SqlClient.SqlClient) {
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

  const upsert = SqlSchema.void({
    Request: TaskScheduleEntry,
    execute: (entry) => sql`
      INSERT INTO task_schedule_entries (
        id, task_id, date, position, start_time, duration_minutes, status, created_at, updated_at
      ) VALUES (
        ${entry.id}, ${entry.taskId}, ${entry.date}, ${entry.position}, ${entry.startTime},
        ${entry.durationMinutes}, ${entry.status}, ${entry.createdAt}, ${entry.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        task_id = excluded.task_id,
        date = excluded.date,
        position = excluded.position,
        start_time = excluded.start_time,
        duration_minutes = excluded.duration_minutes,
        status = excluded.status,
        updated_at = excluded.updated_at`,
  });

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
    releasePositions,
    deleteByIds,
    deleteForTask,
    datesForTask,
  };
}
