import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// ProjectionStore.listActiveShellIndex lists the active task-agent threads with this exact
// predicate, so the read takes them from the index instead of parsing every thread's payload.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_threads_sidebar_hidden_idx
    ON orchestration_v2_projection_threads(thread_id)
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
      AND CASE WHEN json_valid(payload_json)
        THEN json_extract(payload_json, '$.sidebarHidden') END = 1
  `;
});
