import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * When a finished run's source chat was told about it. Runs that ended before
 * this migration count as told, so an imported database wakes no old chats.
 */
export const TaskAgentRunSourceWakeMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_agent_runs ADD COLUMN source_wake_at TEXT`;
  yield* sql`
    UPDATE task_agent_runs
    SET source_wake_at = completed_at
    WHERE completed_at IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_agent_runs_source_wake_pending
    ON task_agent_runs (completed_at)
    WHERE completed_at IS NOT NULL AND source_wake_at IS NULL
  `;
});
