import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Every default text shipped before this migration, frozen here. A field that
 * still equals one of them was never edited and gets the current default.
 * automationCreation kept its text.
 */
const PREVIOUS_DEFAULTS = {
  taskCreation: [
    `Create focused, independently reviewable tasks. Preserve the user's intent in the description, include enough context to work without reopening the originating chat, and use a status and tags that match the existing project workflow.`,
  ],
  agentCreation: [
    `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose a model and runtime permissions appropriate for the work the agent will perform.`,
    `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default.`,
  ],
  taskExecution: [
    `Work toward a concrete, reviewable outcome. Keep the task status and output current, record blockers clearly, and leave a concise summary that lets a person evaluate the result without reading the full thread.`,
  ],
} as const;

type UpdatedField = keyof typeof PREVIOUS_DEFAULTS;
const UPDATED_FIELDS = ["taskCreation", "agentCreation", "taskExecution"] as const;

/**
 * Replaces unedited task instruction defaults with the current ones. Each
 * replacement is recorded in the instructions history, so it can be reverted;
 * edited fields stay untouched.
 */
export const UpdateDefaultTaskPromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<Record<UpdatedField, string> & { readonly revision: number }>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
      task_execution AS "taskExecution",
      revision
    FROM task_prompt_settings
    WHERE id = 1
  `;
  const row = rows[0];
  if (row === undefined) return;

  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const next = { ...row };
  for (const field of UPDATED_FIELDS) {
    const previous = row[field];
    if (!(PREVIOUS_DEFAULTS[field] as ReadonlyArray<string>).includes(previous)) continue;
    next[field] = DEFAULT_TASK_PROMPT_SETTINGS[field];
    next.revision += 1;
    yield* sql`
      INSERT INTO task_prompt_settings_changes (
        id, revision, field, previous_text, new_text, reason,
        source, thread_id, run_id, reverts_change_id, created_at
      ) VALUES (
        ${`task-prompt-change-default-update-15-${field}`}, ${next.revision}, ${field},
        ${previous}, ${next[field]}, ${"New default from an UpComputer update; the field was unedited."},
        ${"unknown"}, NULL, NULL, NULL, ${createdAt}
      )
    `;
  }
  if (next.revision === row.revision) return;
  yield* sql`
    UPDATE task_prompt_settings SET
      task_creation = ${next.taskCreation},
      agent_creation = ${next.agentCreation},
      task_execution = ${next.taskExecution},
      revision = ${next.revision}
    WHERE id = 1
  `;
});
