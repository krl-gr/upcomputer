import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The defaults migrations 27 and 30 shipped, frozen here. They let a run call
 * task_get at the start for the task's events; the run's first message now
 * carries its recent events, so the defaults say not to.
 */
export const PREVIOUS_DEFAULTS = {
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, and the run already holds it.
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
  taskExecution: `Your agent's own instructions come first; where they differ from this, follow them.
- Start from the task in this prompt; it says whether your run already holds the task. Call task_get only when you need its events or it may have changed.
- Keep the task status and output current, so a person can evaluate the result without reading the thread.
- Run every command in the foreground and wait for it; start no background processes.
- Record blockers with evidence. On quota, rate-limit or auth failures, stop and report them; do not retry.
- If your instructions define a queue hand-off, do it before the final update.
- Do everything else first, then make exactly one final task_update with assigneeAgentRunId: null. It ends the run. If you cannot continue, give that update the status Blocked and the blocker in the output; the run then ends as blocked.`,
} as const;

const UPDATED_FIELDS = ["agentCreation", "taskExecution"] as const;
type UpdatedField = (typeof UPDATED_FIELDS)[number];

/**
 * Replaces the unedited global agentCreation and taskExecution texts with the
 * current defaults. Each replacement is recorded in the instructions history,
 * so it can be reverted; edited fields stay untouched.
 */
export const UpdateDefaultFirstMessageEventsPromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<Record<UpdatedField, string> & { readonly revision: number }>`
    SELECT
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
    if (previous !== PREVIOUS_DEFAULTS[field]) continue;
    next[field] = DEFAULT_TASK_PROMPT_SETTINGS[field];
    next.revision += 1;
    yield* sql`
      INSERT INTO task_prompt_settings_changes (
        id, revision, field, previous_text, new_text, reason,
        source, thread_id, run_id, reverts_change_id, created_at
      ) VALUES (
        ${`task-prompt-change-default-update-32-${field}`}, ${next.revision}, ${field},
        ${previous}, ${next[field]}, ${"New default from an UpComputer update; the field was unedited."},
        ${"unknown"}, NULL, NULL, NULL, ${createdAt}
      )
    `;
  }
  if (next.revision === row.revision) return;
  yield* sql`
    UPDATE task_prompt_settings SET
      agent_creation = ${next.agentCreation},
      task_execution = ${next.taskExecution},
      revision = ${next.revision}
    WHERE id = 1
  `;
});
