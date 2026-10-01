import {
  IsoDateTime,
  OrchestrationProposedPlanId as PublicOrchestrationProposedPlanId,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

import { TaskAgent, TaskAgentId } from "./agents.ts";
import { Task, TaskId } from "./tasks.ts";

/** Core plan identity reused by the proposal-application API. */
export const OrchestrationProposedPlanId = PublicOrchestrationProposedPlanId;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposalAgent = Schema.Struct({
  name: TrimmedNonEmptyString,
  role: Schema.optional(TrimmedNonEmptyString),
  trigger: Schema.optional(TrimmedNonEmptyString),
  startStatuses: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  startTags: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  tools: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  skills: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  instructions: Schema.optional(TrimmedNonEmptyString),
  responsibilities: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type OrchestrationProposalAgent = typeof OrchestrationProposalAgent.Type;

export const OrchestrationProposalTask = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  status: Schema.optional(TrimmedNonEmptyString),
  tags: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  agentName: Schema.optional(TrimmedNonEmptyString),
});
export type OrchestrationProposalTask = typeof OrchestrationProposalTask.Type;

/**
 * Version-one Orchestrator payload.
 *
 * `approvalGates` and `assumptions` remain decodable for legacy payload
 * compatibility even though current instructions ask the model to place those
 * details directly in the relevant agent instructions or task descriptions.
 */
export const OrchestrationProposalSpec = Schema.Struct({
  summary: Schema.optional(TrimmedNonEmptyString),
  mermaid: Schema.optional(TrimmedNonEmptyString),
  agents: Schema.optional(Schema.Array(OrchestrationProposalAgent)),
  tasks: Schema.optional(Schema.Array(OrchestrationProposalTask)),
  approvalGates: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  assumptions: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type OrchestrationProposalSpec = typeof OrchestrationProposalSpec.Type;

export const OrchestrationProposalApplyInput = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});
export type OrchestrationProposalApplyInput = typeof OrchestrationProposalApplyInput.Type;

export const OrchestrationProposalApplyResult = Schema.Struct({
  agents: Schema.Array(TaskAgent),
  tasks: Schema.Array(Task),
});
export type OrchestrationProposalApplyResult = typeof OrchestrationProposalApplyResult.Type;

export const OrchestrationProposalApplicationState = Schema.Literals([
  "pending",
  "applying",
  "applied",
]);
export type OrchestrationProposalApplicationState =
  typeof OrchestrationProposalApplicationState.Type;

/** Durable proposal projection exposed to the Orchestrator web feature. */
export const OrchestrationProposalSnapshot = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
  ownerId: TrimmedNonEmptyString,
  modeId: TrimmedNonEmptyString,
  modeVersion: PositiveInt,
  proposal: OrchestrationProposalSpec,
  applicationState: OrchestrationProposalApplicationState,
  agentIds: Schema.Array(TaskAgentId),
  taskIds: Schema.Array(TaskId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  appliedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProposalSnapshot = typeof OrchestrationProposalSnapshot.Type;

export const OrchestrationProposalGetInput = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});
export type OrchestrationProposalGetInput = typeof OrchestrationProposalGetInput.Type;

export const OrchestrationProposalGetResult = Schema.Struct({
  proposal: Schema.NullOr(OrchestrationProposalSnapshot),
});
export type OrchestrationProposalGetResult = typeof OrchestrationProposalGetResult.Type;

export const OrchestrationProposalSearchInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  applicationState: Schema.optional(OrchestrationProposalApplicationState),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type OrchestrationProposalSearchInput = typeof OrchestrationProposalSearchInput.Type;

export const OrchestrationProposalSearchResult = Schema.Struct({
  proposals: Schema.Array(OrchestrationProposalSnapshot),
});
export type OrchestrationProposalSearchResult = typeof OrchestrationProposalSearchResult.Type;
