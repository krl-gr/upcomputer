import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Most tasks end up archived or Done. Active lists and their status counts read this index, so
// they never fetch the rows of archived tasks, nor of other statuses than the one they show.
export const ActiveTaskListIndexMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS tasks_active_audience_kind_status_rank
    ON tasks(audience, kind, status, rank, id)
    WHERE archived_at IS NULL
  `;
});
