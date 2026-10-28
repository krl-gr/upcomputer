import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// When a person last looked at a thread's task runs. A thread row counts a finished run only
// while it finished after this. Threads that already have tasks start as seen now, so the first
// upgrade does not turn their whole history into new counts.
export const TaskThreadSeenMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE task_thread_seen (
    thread_id TEXT PRIMARY KEY,
    seen_at TEXT NOT NULL
  )`;
  yield* sql`INSERT INTO task_thread_seen (thread_id, seen_at)
    SELECT DISTINCT root_thread_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM tasks WHERE root_thread_id IS NOT NULL`;
});
