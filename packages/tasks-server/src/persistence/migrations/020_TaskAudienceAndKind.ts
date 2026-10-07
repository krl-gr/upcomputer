import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Who a task is for (`agent` or `person`) and whether it is a routine. Every
 * existing task becomes an agent task, so nothing changes on upgrade. SQLite
 * cannot add a CHECK over two columns, so triggers keep routines person
 * tasks. Both columns decide which filtered lists a task is in, so they bump
 * the revision page cursors check.
 */
export const TaskAudienceAndKindMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tasks ADD COLUMN audience TEXT NOT NULL DEFAULT 'agent'
    CHECK (audience IN ('agent', 'person'))`;
  yield* sql`ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'
    CHECK (kind IN ('task', 'routine'))`;
  yield* sql`CREATE TRIGGER tasks_routine_is_person_insert BEFORE INSERT ON tasks
    WHEN NEW.kind = 'routine' AND NEW.audience <> 'person'
    BEGIN SELECT RAISE(ABORT, 'routines are person tasks'); END`;
  yield* sql`CREATE TRIGGER tasks_routine_is_person_update BEFORE UPDATE OF kind, audience ON tasks
    WHEN NEW.kind = 'routine' AND NEW.audience <> 'person'
    BEGIN SELECT RAISE(ABORT, 'routines are person tasks'); END`;
  yield* sql`CREATE INDEX tasks_audience_kind_rank ON tasks(audience, kind, rank)`;
  yield* sql`DROP TRIGGER IF EXISTS task_list_update`;
  yield* sql`CREATE TRIGGER task_list_update AFTER UPDATE ON tasks
    WHEN OLD.rank IS NOT NEW.rank
      OR OLD.status IS NOT NEW.status
      OR OLD.project_id IS NOT NEW.project_id
      OR OLD.archived_at IS NOT NEW.archived_at
      OR OLD.audience IS NOT NEW.audience
      OR OLD.kind IS NOT NEW.kind
    BEGIN
      UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
    END`;
});
