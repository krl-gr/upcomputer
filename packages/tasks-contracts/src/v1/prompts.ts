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

export const DEFAULT_TASK_PROMPT_SETTINGS: TaskPromptSettings = {
  taskCreation: `Create focused, independently reviewable tasks. Preserve the user's intent in the description, include enough context to work without reopening the originating chat, and use a status and tags that match the existing project workflow.`,
  agentCreation: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default.`,
  automationCreation: `Create an automation only for genuinely recurring work. Use the user's timezone, make the generated task template self-contained, avoid duplicate open work when appropriate, and leave agent-created automations as drafts for human review.`,
  taskExecution: `Work toward a concrete, reviewable outcome. Keep the task status and output current, record blockers clearly, and leave a concise summary that lets a person evaluate the result without reading the full thread.`,
};
