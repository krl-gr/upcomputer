import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Archive replaces close: `closed_at` becomes `archived_at`, so every closed
 * task is archived and keeps its timestamp. Archiving changes which tasks a
 * default list shows, so it also bumps the revision page cursors check. Task
 * history is read per task, newest first.
 */
export const TaskArchiveMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tasks RENAME COLUMN closed_at TO archived_at`;
  yield* sql`DROP TRIGGER IF EXISTS task_list_update`;
  yield* sql`CREATE TRIGGER task_list_update AFTER UPDATE ON tasks
    WHEN OLD.rank IS NOT NEW.rank
      OR OLD.status IS NOT NEW.status
      OR OLD.project_id IS NOT NEW.project_id
      OR OLD.archived_at IS NOT NEW.archived_at
    BEGIN
      UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
    END`;
  yield* sql`CREATE INDEX IF NOT EXISTS task_events_task_created
    ON task_events(task_id, created_at)`;
});
