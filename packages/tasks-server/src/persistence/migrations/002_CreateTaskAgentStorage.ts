import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const CreateTaskAgentStorageMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      start_statuses_json TEXT NOT NULL,
      start_tags_json TEXT NOT NULL,
      config_json TEXT NOT NULL,
      concurrency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_agents_project_enabled
    ON task_agents (project_id, enabled)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_agent_runs_task
    ON task_agent_runs (task_id, started_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_agent_runs_agent
    ON task_agent_runs (agent_id, started_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_agent_runs_active_task_agent
    ON task_agent_runs (task_id, agent_id)
    WHERE completed_at IS NULL
  `;
});
