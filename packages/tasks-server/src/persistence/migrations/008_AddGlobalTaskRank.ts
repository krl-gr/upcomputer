import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The authoritative order is global to this SQLite task store (one environment).
 * The backfill reproduces the repository's pre-rank visible ordering exactly.
 */
export const AddGlobalTaskRankMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE tasks ADD COLUMN rank TEXT`;
  yield* sql`
    WITH ordered AS (
      SELECT id, row_number() OVER (
        ORDER BY updated_at DESC, created_at DESC, id ASC
      ) AS position
      FROM tasks
    )
    UPDATE tasks
    SET rank = (
      SELECT printf('%016x', ordered.position * 4294967296)
      FROM ordered
      WHERE ordered.id = tasks.id
    )
  `;
  yield* sql`CREATE UNIQUE INDEX tasks_rank_unique ON tasks(rank)`;
  yield* sql`
    CREATE TRIGGER tasks_rank_required_before_insert
    BEFORE INSERT ON tasks
    WHEN NEW.rank IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'tasks.rank is required');
    END
  `;
});
