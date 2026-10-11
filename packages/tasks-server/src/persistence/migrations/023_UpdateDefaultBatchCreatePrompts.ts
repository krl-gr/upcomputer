import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The taskCreation default migration 20 shipped, frozen here. It had chats
 * create one task per call, one model turn each, before any work started.
 */
export const PREVIOUS_TASK_CREATION = `Create focused, independently reviewable tasks. The description must be self-contained and keep the user's intent: goal, context, target, constraints, verification and expected output, so the agent never needs the originating chat. Include absolute paths of attached images and tell the agent to open them.

Choosing the agent: unless the user's recorded preferences or explicit words already decide it, do not pick one silently. Call agent_search, show the relevant agents (name, model, enabled, trigger statuses and tags), recommend one with a reason, and let the user decide. If none fits, propose creating one.

Assignment: add the chosen agent's trigger tag and record its id in metadata.targetAgentId. A run id exists only after the run starts.

Queue: an agent works through its tasks one at a time. If it has no task in its start status and none In Progress (task_search with its tag), create the task directly in its start status so it starts now. Otherwise create it in Backlog; the agent's queue hand-off activates it later. New tasks join the end of the list, so create queued tasks in the order they should run; no reorder is needed. An agent without start statuses starts on its tag in any status, so add the tag only when the task should start. Never start several tasks of one queue at once unless the user asked for fan-out.`;

/**
 * Replaces the unedited global taskCreation text with the current default,
 * which creates several tasks in one task_create call. The replacement is
 * recorded in the instructions history, so it can be reverted; an edited
 * text stays untouched.
 */
export const UpdateDefaultBatchCreatePromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly taskCreation: string; readonly revision: number }>`
    SELECT task_creation AS "taskCreation", revision
    FROM task_prompt_settings
    WHERE id = 1
  `;
  const row = rows[0];
  if (row === undefined || row.taskCreation !== PREVIOUS_TASK_CREATION) return;

  const revision = row.revision + 1;
  const next = DEFAULT_TASK_PROMPT_SETTINGS.taskCreation;
  yield* sql`
    INSERT INTO task_prompt_settings_changes (
      id, revision, field, previous_text, new_text, reason,
      source, thread_id, run_id, reverts_change_id, created_at
    ) VALUES (
      ${"task-prompt-change-default-update-23-taskCreation"}, ${revision}, ${"taskCreation"},
      ${row.taskCreation}, ${next}, ${"New default from an UpComputer update; the field was unedited."},
      ${"unknown"}, NULL, NULL, NULL, ${DateTime.formatIso(yield* DateTime.now)}
    )
  `;
  yield* sql`
    UPDATE task_prompt_settings SET task_creation = ${next}, revision = ${revision}
    WHERE id = 1
  `;
});
