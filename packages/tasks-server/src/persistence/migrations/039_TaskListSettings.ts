import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// How the agents' task list shows (grouping by status, group order, open groups), as JSON.
// NULL until first saved, which reads as the defaults.
export const TaskListSettingsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_settings ADD COLUMN list_settings_json TEXT`;
});
