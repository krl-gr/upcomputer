import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// A bot works in its one project, and memory suggestions are gone from the app. Bots saved
// with more projects keep only their working one, and waiting suggestions read as rejected.
export const BotOneProjectMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE bots SET allowed_projects_json = json_array(project_id)`;
  yield* sql`UPDATE bot_memories SET status = 'rejected' WHERE status = 'proposed'`;
});
