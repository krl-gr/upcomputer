import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ImportLegacyTaskAgentsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existingTables = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('task_trigger_rules', 'task_worker_runs')
  `;
  const tableNames = new Set(existingTables.map((row) => row.name));

  if (tableNames.has("task_trigger_rules")) {
    yield* sql`
      INSERT OR IGNORE INTO task_agents (
        id,
        project_id,
        name,
        enabled,
        start_statuses_json,
        start_tags_json,
        config_json,
        concurrency_key,
        created_at,
        updated_at
      )
      SELECT
        id,
        project_id,
        name,
        enabled,
        match_statuses_json,
        match_tags_json,
        CASE
          WHEN json_type(worker_template_json, '$.instructions') IS NULL
            AND json_type(worker_template_json, '$.prompt') IS NOT NULL
          THEN json_remove(
            json_set(
              worker_template_json,
              '$.instructions',
              json_extract(worker_template_json, '$.prompt')
            ),
            '$.prompt'
          )
          ELSE worker_template_json
        END,
        concurrency_key,
        created_at,
        updated_at
      FROM task_trigger_rules
    `;
  }

  if (tableNames.has("task_worker_runs")) {
    yield* sql`
      INSERT OR IGNORE INTO task_agent_runs (
        id,
        task_id,
        agent_id,
        thread_id,
        model_selection_json,
        status,
        started_at,
        completed_at
      )
      SELECT
        id,
        task_id,
        trigger_rule_id,
        thread_id,
        model_selection_json,
        status,
        started_at,
        completed_at
      FROM task_worker_runs
    `;
  }
});
