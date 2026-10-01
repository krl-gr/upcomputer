import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** A cursor must not survive a reorder, rebalance, or filter-membership change. */
export const TaskListRevisionMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE task_list_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)`;
  yield* sql`INSERT INTO task_list_revision VALUES (1, 0)`;
  yield* sql`CREATE TRIGGER task_list_insert AFTER INSERT ON tasks BEGIN
    UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
  END`;
  yield* sql`CREATE TRIGGER task_list_update AFTER UPDATE ON tasks BEGIN
    UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
  END`;
  yield* sql`CREATE TRIGGER task_list_delete AFTER DELETE ON tasks BEGIN
    UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
  END`;
  yield* sql`CREATE TRIGGER task_list_tag_insert AFTER INSERT ON task_tags BEGIN
    UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
  END`;
  yield* sql`CREATE TRIGGER task_list_tag_delete AFTER DELETE ON task_tags BEGIN
    UPDATE task_list_revision SET revision = revision + 1 WHERE id = 1;
  END`;
});
