import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Per-project additions to the task instruction fields, empty by default.
 * Their changes share the history table: `project_id` is null for the global
 * texts, and each scope counts its own revisions, so the table is rebuilt
 * with a per-scope unique revision. Existing texts and history stay as they are.
 */
export const ProjectTaskPromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE task_project_prompt_settings (
      project_id TEXT PRIMARY KEY,
      task_creation TEXT NOT NULL DEFAULT '',
      agent_creation TEXT NOT NULL DEFAULT '',
      automation_creation TEXT NOT NULL DEFAULT '',
      task_execution TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`
    CREATE TABLE task_prompt_settings_changes_scoped (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      revision INTEGER NOT NULL,
      field TEXT NOT NULL,
      previous_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL,
      thread_id TEXT,
      run_id TEXT,
      reverts_change_id TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO task_prompt_settings_changes_scoped (
      id, project_id, revision, field, previous_text, new_text, reason,
      source, thread_id, run_id, reverts_change_id, created_at
    )
    SELECT
      id, NULL, revision, field, previous_text, new_text, reason,
      source, thread_id, run_id, reverts_change_id, created_at
    FROM task_prompt_settings_changes
  `;
  yield* sql`DROP TABLE task_prompt_settings_changes`;
  yield* sql`ALTER TABLE task_prompt_settings_changes_scoped RENAME TO task_prompt_settings_changes`;
  // NULLs are distinct in a plain UNIQUE, so the global scope is keyed as ''.
  yield* sql`
    CREATE UNIQUE INDEX task_prompt_settings_changes_scope_revision
    ON task_prompt_settings_changes (COALESCE(project_id, ''), revision)
  `;
  yield* sql`
    CREATE INDEX task_prompt_settings_changes_field
    ON task_prompt_settings_changes (project_id, field, revision)
  `;
});
