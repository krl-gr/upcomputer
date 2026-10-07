import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * A person's order of automations, as tasks' `rank` (008): one order per
 * environment, so every device lists them the same way. The backfill keeps
 * the order the Automations page showed (latest update first). The tasks
 * index serves the planner's lists of one automation's tasks and their counts.
 */
export const TaskAutomationRankMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE task_automations ADD COLUMN rank TEXT`;
  yield* sql`
    WITH ordered AS (
      SELECT id, row_number() OVER (
        ORDER BY updated_at DESC, created_at DESC, id ASC
      ) AS position
      FROM task_automations
    )
    UPDATE task_automations
    SET rank = (
      SELECT printf('%016x', ordered.position * 4294967296)
      FROM ordered
      WHERE ordered.id = task_automations.id
    )
  `;
  yield* sql`CREATE UNIQUE INDEX task_automations_rank_unique ON task_automations(rank)`;
  yield* sql`
    CREATE TRIGGER task_automations_rank_required_before_insert
    BEFORE INSERT ON task_automations
    WHEN NEW.rank IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'task_automations.rank is required');
    END
  `;
  yield* sql`CREATE INDEX tasks_created_by_rank ON tasks(created_by, rank)`;
});
