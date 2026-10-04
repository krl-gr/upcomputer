import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Every instruction edit is recorded and bumps the revision; existing texts stay as they are. */
export const TaskPromptSettingsHistoryMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE task_prompt_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`;
  yield* sql`
    CREATE TABLE task_prompt_settings_changes (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL UNIQUE,
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
    CREATE INDEX task_prompt_settings_changes_field
    ON task_prompt_settings_changes (field, revision)
  `;
});
