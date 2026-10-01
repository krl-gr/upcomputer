import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Time gate and trigger revision on tasks, run-status triggers on agents, and
 * the triggering run on runs. `trigger_changed_at` starts at the earliest of
 * each agent's latest finished run on the task (else `updated_at`), so no
 * agent sees a change after its own last run: later writes cannot be told
 * apart from output or assignment edits, and the old scheduler started agents
 * on real changes right away, so upgraded tasks are not replayed.
 */
export const TaskTriggerSemanticsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tasks ADD COLUMN not_before TEXT`;
  yield* sql`ALTER TABLE tasks ADD COLUMN trigger_changed_at TEXT`;
  yield* sql`
    UPDATE tasks SET trigger_changed_at = COALESCE(
      (SELECT MIN(r.completed_at) FROM task_agent_runs r
        WHERE r.task_id = tasks.id AND r.completed_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM task_agent_runs n
            WHERE n.task_id = r.task_id AND n.agent_id = r.agent_id
              AND n.completed_at > r.completed_at
          )),
      updated_at
    )
  `;
  yield* sql`CREATE INDEX tasks_not_before ON tasks(not_before) WHERE not_before IS NOT NULL`;
  yield* sql`ALTER TABLE task_agents ADD COLUMN start_run_statuses_json TEXT NOT NULL DEFAULT '[]'`;
  yield* sql`ALTER TABLE task_agent_runs ADD COLUMN trigger_run_id TEXT`;
});
