import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const CreateTaskAutomationStorageMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_automations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      template_json TEXT NOT NULL,
      catch_up_policy TEXT NOT NULL,
      skip_if_open INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      source_thread_id TEXT,
      next_run_at TEXT,
      last_fired_at TEXT,
      last_fired_slot TEXT,
      last_task_id TEXT,
      last_error TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_automations_status_due
    ON task_automations (status, next_run_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_automations_project_status
    ON task_automations (project_id, status)
  `;

  // The composite primary key is the idempotency guarantee: a slot can only be
  // claimed once, so a restart mid-fire or a catch-up pass cannot duplicate the
  // task an automation already produced.
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_automation_runs (
      automation_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      task_id TEXT,
      outcome TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (automation_id, slot)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_automation_runs_automation
    ON task_automation_runs (automation_id, created_at)
  `;
});
