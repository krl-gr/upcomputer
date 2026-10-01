import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Repair task-agent threads created before core persisted sidebarVisible. */
export const BackfillTaskAgentThreadVisibilityMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'projection_threads'
  `;
  if (tables.length === 0) return;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "sidebar_visible")) return;

  yield* sql`
    UPDATE projection_threads
    SET sidebar_visible = 0
    WHERE thread_id IN (SELECT thread_id FROM task_agent_runs)
  `;
});
