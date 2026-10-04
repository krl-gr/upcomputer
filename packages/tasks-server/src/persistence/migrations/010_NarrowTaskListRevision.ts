import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Cosmetic edits and run/output updates cannot change page boundaries. */
export const NarrowTaskListRevisionMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TRIGGER task_list_update`;
  yield* sql`CREATE TRIGGER task_list_update AFTER UPDATE ON tasks
    WHEN OLD.rank IS NOT NEW.rank
      OR OLD.status IS NOT NEW.status
      OR OLD.project_id IS NOT NEW.project_id
    BEGIN
      UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
    END`;
});
