import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * One row of task-system settings. `inbox_project_id` is the project that
 * takes tasks created without one; it is kept by id, so renaming or moving
 * the project keeps it the Inbox.
 */
export const TaskSettingsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE task_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      inbox_project_id TEXT
    )
  `;
  yield* sql`INSERT INTO task_settings (id, inbox_project_id) VALUES (1, NULL)`;
});
