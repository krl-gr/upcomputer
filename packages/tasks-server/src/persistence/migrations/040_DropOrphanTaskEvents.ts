import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Events of tasks that were deleted, or appended to ids no task ever had. Nothing reads
// them, and a task created later with the same id would show them as its history.
export const DropOrphanTaskEventsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM task_events
    WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_events.task_id)`;
});
