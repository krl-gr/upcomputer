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

export const TaskPromptSettingsUpdateInput = TaskPromptSettings;
export type TaskPromptSettingsUpdateInput = typeof TaskPromptSettingsUpdateInput.Type;

export const TASK_PROMPT_FIELDS = [
  "taskCreation",
  "agentCreation",
  "automationCreation",
  "taskExecution",
] as const;
export const TaskPromptField = Schema.Literals(TASK_PROMPT_FIELDS);
export type TaskPromptField = typeof TaskPromptField.Type;

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
  field: TaskPromptField,
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
  field: TaskPromptField,
  text: Schema.String,
  reason: TrimmedNonEmptyString,
  expectedRevision: NonNegativeInt,
});
export type InstructionsUpdateInput = typeof InstructionsUpdateInput.Type;

export const InstructionsHistoryInput = Schema.Struct({
  field: Schema.optional(TaskPromptField),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
});
export type InstructionsHistoryInput = typeof InstructionsHistoryInput.Type;

export const InstructionsRevertInput = Schema.Struct({
  changeId: TrimmedNonEmptyString,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type InstructionsRevertInput = typeof InstructionsRevertInput.Type;

export const DEFAULT_TASK_PROMPT_SETTINGS: TaskPromptSettings = {
  taskCreation: `Create focused, independently reviewable tasks. Preserve the user's intent in the description, include enough context to work without reopening the originating chat, and use a status and tags that match the existing project workflow.`,
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default.`,
  automationCreation: `Create an automation only for genuinely recurring work. Use the user's timezone, make the generated task template self-contained, avoid duplicate open work when appropriate, and leave agent-created automations as drafts for human review.`,
  taskExecution: `Work toward a concrete, reviewable outcome. Keep the task status and output current, record blockers clearly, and leave a concise summary that lets a person evaluate the result without reading the full thread.`,
};
