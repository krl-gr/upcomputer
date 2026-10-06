import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Source-chat wakes as fixed batches: a batch's runs are recorded before its
 * message is sent, so a retry sends the same message and acknowledges only
 * those runs. A batch row lives until the batch is handled.
 */
export const TaskSourceWakeBatchesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_agent_runs ADD COLUMN source_wake_batch_id TEXT`;
  yield* sql`
    CREATE TABLE task_source_wake_batches (
      id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_at TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_agent_runs_source_wake_batch
    ON task_agent_runs (source_wake_batch_id)
    WHERE source_wake_batch_id IS NOT NULL
  `;
});
