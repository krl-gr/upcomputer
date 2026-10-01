import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The ended run a run continues in the same thread; null for every earlier run. */
export const TaskAgentRunContinuationMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_agent_runs ADD COLUMN continues_run_id TEXT`;
});
