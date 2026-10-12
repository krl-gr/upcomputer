import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The defaults migrations 27 and 29 shipped, frozen here. They said new tasks
 * join the end of the list and the queue hand-off takes the first Backlog
 * task; new tasks now go to the top and queues run from the bottom.
 */
export const PREVIOUS_DEFAULTS = {
  taskCreation: `Create focused, independently reviewable tasks. The description must be self-contained and keep the user's intent: goal, context, target, constraints, verification and expected output, so the agent never needs the originating chat. Include absolute paths of attached images and tell the agent to open them.

Choosing the agent: unless the user's recorded preferences or explicit words already decide it, do not pick one silently. Show the relevant agents from task_context's agents (name, model, start statuses and tags), recommend one with a reason, and let the user decide. If none fits, propose creating one; agent_search also lists disabled agents.

Assignment: add the chosen agent's trigger tag and record its id in metadata.targetAgentId. A run id exists only after the run starts.

Queue: an agent works through its tasks one at a time. task_context's agents shows each agent's queue, so no task_search or agent_get is needed before creating. If the agent has no task in its start status, none In Progress and none active, create the first task directly in its start status so it starts now, and any further ones in Backlog. Otherwise create them all in Backlog; the agent's queue hand-off activates them later. Create several tasks in one task_create call (tasks), in the order they should run: they join the end of the list in that order, so no reorder is needed. An agent without start statuses starts on its tag in any status, so add the tag only when the task should start. Never start several tasks of one queue at once unless the user asked for fan-out.`,
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, and the run already holds it.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the first Backlog task with your tag in task_search order (the list order) to your start status. Never more than one.
- Final mutation: a single task_update to the review status, e.g. Needs Review, with assigneeAgentRunId: null. When blocked, the same update with status Blocked and the blocker in the output.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: the review status, your trigger tag removed, and assigneeAgentRunId: null.`,
} as const;

const UPDATED_FIELDS = ["taskCreation", "agentCreation"] as const;
type UpdatedField = (typeof UPDATED_FIELDS)[number];

/**
 * Replaces the unedited global taskCreation and agentCreation texts with the
 * current defaults. Each replacement is recorded in the instructions history,
 * so it can be reverted; edited fields stay untouched.
 */
export const UpdateDefaultFeedOrderPromptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<Record<UpdatedField, string> & { readonly revision: number }>`
    SELECT
      task_creation AS "taskCreation",
      agent_creation AS "agentCreation",
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
        ${`task-prompt-change-default-update-30-${field}`}, ${next.revision}, ${field},
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
      revision = ${next.revision}
    WHERE id = 1
  `;
});
