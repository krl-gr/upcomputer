import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Add the current human-facing result summary to each task. */
export const AddTaskOutputMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(tasks)
  `;
  if (!columns.some((column) => column.name === "output")) {
    yield* sql`
      ALTER TABLE tasks
      ADD COLUMN output TEXT
    `;
  }

  // Existing agent summaries are already durable task events. Materialize the
  // latest one so upgraded tasks immediately expose the same result as new ones.
  yield* sql`
    UPDATE tasks
    SET output = (
      SELECT json_extract(task_events.payload_json, '$.summary')
      FROM task_events
      WHERE task_events.task_id = tasks.id
        AND task_events.kind = 'task.agent-result'
        AND json_type(task_events.payload_json, '$.summary') = 'text'
      ORDER BY task_events.created_at DESC, task_events.id DESC
      LIMIT 1
    )
    WHERE output IS NULL
      AND EXISTS (
        SELECT 1
        FROM task_events
        WHERE task_events.task_id = tasks.id
          AND task_events.kind = 'task.agent-result'
          AND json_type(task_events.payload_json, '$.summary') = 'text'
      )
  `;
});
