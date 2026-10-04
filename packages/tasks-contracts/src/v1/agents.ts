import {
  ProviderInteractionMode,
  IsoDateTime,
  ModelSelection,
  PositiveInt,
  ProjectId,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TaskId, TaskTag } from "./tasks.ts";

export const TaskAgentId = TrimmedNonEmptyString.pipe(Schema.brand("TaskAgentId"));
export type TaskAgentId = typeof TaskAgentId.Type;

export const TaskAgentRunId = TrimmedNonEmptyString.pipe(Schema.brand("TaskAgentRunId"));
export type TaskAgentRunId = typeof TaskAgentRunId.Type;

/**
 * Terminal run statuses another agent can start on. A run started this way
 * never triggers further run-status agents.
 */
export const TaskAgentRunTriggerStatus = Schema.Literals(["failed", "interrupted", "blocked"]);
export type TaskAgentRunTriggerStatus = typeof TaskAgentRunTriggerStatus.Type;

export const TaskAgentConfig = Schema.Struct({
  role: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  tools: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  skills: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  instructions: TrimmedNonEmptyString,
});
export type TaskAgentConfig = typeof TaskAgentConfig.Type;

export const TaskAgent = Schema.Struct({
  id: TaskAgentId,
  projectId: Schema.NullOr(ProjectId),
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  startStatuses: Schema.Array(TrimmedNonEmptyString),
  startTags: Schema.Array(TaskTag),
  /** Non-empty: start only for another agent's latest run on the task ending in one of these. */
  startRunStatuses: Schema.Array(TaskAgentRunTriggerStatus),
  config: TaskAgentConfig,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskAgent = typeof TaskAgent.Type;

export const TaskAgentRun = Schema.Struct({
  id: TaskAgentRunId,
  taskId: TaskId,
  agentId: TaskAgentId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  status: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  /** The run whose terminal status started this one; null for task-state starts. */
  triggerRunId: Schema.NullOr(TaskAgentRunId),
  /** The ended run this one continues in the same thread (agent_run_message); null otherwise. */
  continuesRunId: Schema.NullOr(TaskAgentRunId),
});
export type TaskAgentRun = typeof TaskAgentRun.Type;

export const TaskAgentUpsertInput = Schema.Struct({
  id: Schema.optional(TaskAgentId),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  name: TrimmedNonEmptyString,
  enabled: Schema.optional(Schema.Boolean),
  startStatuses: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  startTags: Schema.optional(Schema.Array(TaskTag)),
  startRunStatuses: Schema.optional(Schema.Array(TaskAgentRunTriggerStatus)),
  config: TaskAgentConfig,
});
export type TaskAgentUpsertInput = typeof TaskAgentUpsertInput.Type;

export const AgentGetInput = Schema.Struct({ id: TaskAgentId });
export type AgentGetInput = typeof AgentGetInput.Type;

export const AgentCreateInput = Schema.Struct({
  id: Schema.optional(TaskAgentId),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  enabled: Schema.optional(Schema.Boolean),
  startStatuses: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  startTags: Schema.optional(Schema.Array(TaskTag)),
  startRunStatuses: Schema.optional(Schema.Array(TaskAgentRunTriggerStatus)),
  config: Schema.optional(TaskAgentConfig),
  modelSelection: Schema.optional(ModelSelection),
  modelAlias: Schema.optional(TrimmedNonEmptyString),
  role: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  tools: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  skills: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  instructions: Schema.optional(TrimmedNonEmptyString),
});
export type AgentCreateInput = typeof AgentCreateInput.Type;

export const AgentUpdateInput = Schema.Struct({
  id: TaskAgentId,
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  name: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.optional(Schema.Boolean),
  startStatuses: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  startTags: Schema.optional(Schema.Array(TaskTag)),
  startRunStatuses: Schema.optional(Schema.Array(TaskAgentRunTriggerStatus)),
  config: Schema.optional(TaskAgentConfig),
  modelSelection: Schema.optional(ModelSelection),
  modelAlias: Schema.optional(TrimmedNonEmptyString),
  role: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  tools: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  skills: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  instructions: Schema.optional(TrimmedNonEmptyString),
});
export type AgentUpdateInput = typeof AgentUpdateInput.Type;

export const AgentDeleteInput = Schema.Struct({ id: TaskAgentId });
export type AgentDeleteInput = typeof AgentDeleteInput.Type;

export const TaskAgentSearchInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  enabled: Schema.optional(Schema.Boolean),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type TaskAgentSearchInput = typeof TaskAgentSearchInput.Type;

export const AgentSearchInput = TaskAgentSearchInput;
export type AgentSearchInput = typeof AgentSearchInput.Type;

export const TaskAgentSearchResult = Schema.Struct({ agents: Schema.Array(TaskAgent) });
export type TaskAgentSearchResult = typeof TaskAgentSearchResult.Type;

export const TaskAgentDeleteInput = Schema.Struct({ id: TaskAgentId });
export type TaskAgentDeleteInput = typeof TaskAgentDeleteInput.Type;

export const AgentRunGetInput = Schema.Struct({ id: TaskAgentRunId });
export type AgentRunGetInput = typeof AgentRunGetInput.Type;

export const AgentRunStopInput = Schema.Struct({ id: TaskAgentRunId });
export type AgentRunStopInput = typeof AgentRunStopInput.Type;

export const AgentRunMessageInput = Schema.Struct({
  runId: TaskAgentRunId,
  text: TrimmedNonEmptyString,
});
export type AgentRunMessageInput = typeof AgentRunMessageInput.Type;

export const TaskAgentRunSearchInput = Schema.Struct({
  cursor: Schema.optional(Schema.Struct({ startedAt: IsoDateTime, id: TaskAgentRunId })),
  activeOnly: Schema.optional(Schema.Boolean),
  taskId: Schema.optional(TaskId),
  agentId: Schema.optional(TaskAgentId),
  status: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type TaskAgentRunSearchInput = typeof TaskAgentRunSearchInput.Type;

export const AgentRunSearchInput = TaskAgentRunSearchInput;
export type AgentRunSearchInput = typeof AgentRunSearchInput.Type;

export const AgentRunTranscriptInput = Schema.Struct({
  runId: Schema.optional(TaskAgentRunId),
  threadId: Schema.optional(ThreadId),
  tail: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
  includeActivities: Schema.optional(Schema.Boolean),
  maxChars: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200_000))),
});
export type AgentRunTranscriptInput = typeof AgentRunTranscriptInput.Type;

export const TaskAgentRunSearchResult = Schema.Struct({ runs: Schema.Array(TaskAgentRun) });
export type TaskAgentRunSearchResult = typeof TaskAgentRunSearchResult.Type;
