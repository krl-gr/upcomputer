import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The agentCreation default migration 32 shipped, frozen here. It did not tell
 * a bot from a worker, so an agent asked for a bot made a worker.
 */
export const PREVIOUS_DEFAULTS = {
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, its output and its recent events, and the run already holds it, so do not call task_get at the start.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Backlog task with your tag to your start status: task_search with your tag, status Backlog, from "bottom" and limit 1 returns it. Never more than one.
- Final mutation: a single task_update to the review status, e.g. Needs Review, with assigneeAgentRunId: null. When blocked, the same update with status Blocked and the blocker in the output.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: the review status, your trigger tag removed, and assigneeAgentRunId: null.`,
} as const;

/**
 * Replaces the unedited global agentCreation text with the current default.
 * The replacement is recorded in the instructions history, so it can be
 * reverted; an edited text stays untouched.
 */
export const UpdateDefaultBotCreationPromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly agentCreation: string; readonly revision: number }>`
    SELECT agent_creation AS "agentCreation", revision
    FROM task_prompt_settings
    WHERE id = 1
  `;
  const row = rows[0];
  if (row === undefined || row.agentCreation !== PREVIOUS_DEFAULTS.agentCreation) return;

  const revision = row.revision + 1;
  const next = DEFAULT_TASK_PROMPT_SETTINGS.agentCreation;
  yield* sql`
    INSERT INTO task_prompt_settings_changes (
      id, revision, field, previous_text, new_text, reason,
      source, thread_id, run_id, reverts_change_id, created_at
    ) VALUES (
      ${"task-prompt-change-default-update-41-agentCreation"}, ${revision}, ${"agentCreation"},
      ${row.agentCreation}, ${next}, ${"New default from an UpComputer update; the field was unedited."},
      ${"unknown"}, NULL, NULL, NULL, ${DateTime.formatIso(yield* DateTime.now)}
    )
  `;
  yield* sql`
    UPDATE task_prompt_settings SET agent_creation = ${next}, revision = ${revision}
    WHERE id = 1
  `;
});
