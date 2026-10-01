import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

/** User-editable guidance layered on top of the Tasks machine protocol. */
export const TaskPromptSettings = Schema.Struct({
  taskCreation: Schema.String,
  agentCreation: Schema.String,
  automationCreation: Schema.String,
  taskExecution: Schema.String,
});
export type TaskPromptSettings = typeof TaskPromptSettings.Type;

export const TaskPromptSettingsGetInput = Schema.Struct({});
export type TaskPromptSettingsGetInput = typeof TaskPromptSettingsGetInput.Type;

/**
 * The settings page save; fields left out stay as they are. `allChats` is the
 * core `customInstructions` setting: saving it here records it in the
 * instructions history.
 */
export const TaskPromptSettingsUpdateInput = Schema.Struct({
  taskCreation: Schema.optional(Schema.String),
  agentCreation: Schema.optional(Schema.String),
  automationCreation: Schema.optional(Schema.String),
  taskExecution: Schema.optional(Schema.String),
  allChats: Schema.optional(Schema.String),
});
export type TaskPromptSettingsUpdateInput = typeof TaskPromptSettingsUpdateInput.Type;

/** The saved task texts, and `allChats` as stored (trimmed) when the save included it. */
export const TaskPromptSettingsUpdateResult = Schema.Struct({
  ...TaskPromptSettings.fields,
  allChats: Schema.optional(Schema.String),
});
export type TaskPromptSettingsUpdateResult = typeof TaskPromptSettingsUpdateResult.Type;

export const TASK_PROMPT_FIELDS = [
  "taskCreation",
  "agentCreation",
  "automationCreation",
  "taskExecution",
] as const;
export const TaskPromptField = Schema.Literals(TASK_PROMPT_FIELDS);
export type TaskPromptField = typeof TaskPromptField.Type;

/**
 * The fields the instructions tools edit: the four task fields and `allChats`,
 * the core `customInstructions` setting that every chat and task run gets.
 */
export const INSTRUCTIONS_FIELDS = ["allChats", ...TASK_PROMPT_FIELDS] as const;
export const InstructionsField = Schema.Literals(INSTRUCTIONS_FIELDS);
export type InstructionsField = typeof InstructionsField.Type;

/**
 * Who made a change: the settings page, a tool call from a thread (a chat or
 * an opted-in task-agent run), or a tool call without a thread such as the
 * loopback MCP bridge.
 */
export const TaskPromptChangeSource = Schema.Literals([
  "settings-page",
  "thread",
  "mcp",
  "unknown",
]);
export type TaskPromptChangeSource = typeof TaskPromptChangeSource.Type;

/** One recorded edit of one instruction field. History rows are never deleted. */
export const TaskPromptSettingsChange = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** The settings revision this change produced. */
  revision: PositiveInt,
  field: InstructionsField,
  previousText: Schema.String,
  newText: Schema.String,
  reason: Schema.NullOr(Schema.String),
  source: TaskPromptChangeSource,
  threadId: Schema.NullOr(TrimmedNonEmptyString),
  runId: Schema.NullOr(TrimmedNonEmptyString),
  revertsChangeId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type TaskPromptSettingsChange = typeof TaskPromptSettingsChange.Type;

export const InstructionsGetInput = Schema.Struct({});
export type InstructionsGetInput = typeof InstructionsGetInput.Type;

export const InstructionsUpdateInput = Schema.Struct({
  field: InstructionsField,
  text: Schema.String,
  reason: TrimmedNonEmptyString,
  expectedRevision: NonNegativeInt,
});
export type InstructionsUpdateInput = typeof InstructionsUpdateInput.Type;

export const InstructionsHistoryInput = Schema.Struct({
  field: Schema.optional(InstructionsField),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
});
export type InstructionsHistoryInput = typeof InstructionsHistoryInput.Type;

export const InstructionsRevertInput = Schema.Struct({
  changeId: TrimmedNonEmptyString,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type InstructionsRevertInput = typeof InstructionsRevertInput.Type;

export const DEFAULT_TASK_PROMPT_SETTINGS: TaskPromptSettings = {
  taskCreation: `Create focused, independently reviewable tasks. The description must be self-contained and keep the user's intent: goal, context, target, constraints, verification and expected output, so the agent never needs the originating chat. Include absolute paths of attached images and tell the agent to open them.

Choosing the agent: unless the user's recorded preferences or explicit words already decide it, do not pick one silently. Call agent_search, show the relevant agents (name, model, enabled, trigger statuses and tags), recommend one with a reason, and let the user decide. If none fits, propose creating one.

Assignment: add the chosen agent's trigger tag and record its id in metadata.targetAgentId. A run id exists only after the run starts.

Queue: an agent works through its tasks one at a time. If it has no task in its start status and none In Progress (task_search with its tag), create the task directly in its start status so it starts now. Otherwise create it in Backlog; the agent's queue hand-off activates it later. An agent without start statuses starts on its tag in any status, so add the tag only when the task should start. Never start several tasks of one queue at once unless the user asked for fan-out.`,
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: task_get, claim the task with your run id, set In Progress, and read the repository's AGENTS.md or CLAUDE.md.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the oldest Backlog task with your tag to your start status. Never more than one.
- Final mutation: a single task_update to the review status, e.g. Needs Review, with assigneeAgentRunId: null.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: the review status, and your trigger tag removed.`,
  automationCreation: `Create an automation only for genuinely recurring work. Use the user's timezone, make the generated task template self-contained, avoid duplicate open work when appropriate, and leave agent-created automations as drafts for human review.`,
  taskExecution: `Your agent's own instructions come first; where they differ from this, follow them.
- Claim the task first: task_get, then set assigneeAgentRunId to your run id.
- Keep the task status and output current, so a person can evaluate the result without reading the thread.
- Run every command in the foreground and wait for it; start no background processes.
- Record blockers with evidence. On quota, rate-limit or auth failures, stop and report them; do not retry.
- If your instructions define a queue hand-off, do it before the final update.
- Do everything else first, then make exactly one final task_update, then report your task_agent_result.`,
};
