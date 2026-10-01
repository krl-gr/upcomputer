import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** No historical inference: old tasks intentionally retain null origins. */
export const TaskOriginsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tasks ADD COLUMN root_thread_id TEXT`;
  yield* sql`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`;
  yield* sql`ALTER TABLE tasks ADD COLUMN parent_run_id TEXT`;
  yield* sql`CREATE INDEX tasks_root_thread_id ON tasks(root_thread_id, id)`;
  yield* sql`CREATE INDEX tasks_parent_task_id ON tasks(parent_task_id)`;
  yield* sql`CREATE INDEX task_agent_runs_thread_origin ON task_agent_runs(thread_id)`;
  yield* sql`CREATE INDEX task_agent_runs_task_status ON task_agent_runs(task_id, status)`;
});
