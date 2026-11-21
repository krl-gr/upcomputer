import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// When an agent was archived; NULL keeps every existing agent in the working set.
export const TaskAgentArchiveMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_agents ADD COLUMN archived_at TEXT`;
});
