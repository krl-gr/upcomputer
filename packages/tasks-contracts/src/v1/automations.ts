import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

import { TaskId, TaskTag } from "./tasks.ts";

export const TaskAutomationId = TrimmedNonEmptyString.pipe(Schema.brand("TaskAutomationId"));
export type TaskAutomationId = typeof TaskAutomationId.Type;

/**
 * Automations are inert until a human enables them.
 *
 * `draft` exists so agent-authored automations can be reviewed before they are
 * allowed to spend money unattended; it is deliberately distinct from
 * `disabled`, which means a human looked at the automation and paused it.
 */
export const TaskAutomationStatus = Schema.Literals(["draft", "enabled", "disabled"]);
export type TaskAutomationStatus = typeof TaskAutomationStatus.Type;

/**
 * Applies only when the scheduler misses a slot by more than its grace window,
 * which on a desktop host mostly means the machine slept or was powered off.
 */
export const TaskAutomationCatchUpPolicy = Schema.Literals(["skip", "fire-once"]);
export type TaskAutomationCatchUpPolicy = typeof TaskAutomationCatchUpPolicy.Type;

export const TaskAutomationRunOutcome = Schema.Literals([
  "created",
  "skipped-open",
  "skipped-catch-up",
  "failed",
]);
export type TaskAutomationRunOutcome = typeof TaskAutomationRunOutcome.Type;

/** Five- or six-field cron expression paired with the zone it is read in. */
export const TaskAutomationSchedule = Schema.Struct({
  cron: TrimmedNonEmptyString,
  timezone: TrimmedNonEmptyString,
});
export type TaskAutomationSchedule = typeof TaskAutomationSchedule.Type;

/** The task an automation writes on each fire. */
export const TaskAutomationTemplate = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: TrimmedNonEmptyString,
  priority: Schema.NullOr(TrimmedNonEmptyString),
  tags: Schema.Array(TaskTag),
});
export type TaskAutomationTemplate = typeof TaskAutomationTemplate.Type;

export const TaskAutomation = Schema.Struct({
  id: TaskAutomationId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  status: TaskAutomationStatus,
  schedule: TaskAutomationSchedule,
  template: TaskAutomationTemplate,
  catchUpPolicy: TaskAutomationCatchUpPolicy,
  /** Suppresses a fire while the previously created task is still open. */
  skipIfOpen: Schema.Boolean,
  createdBy: TrimmedNonEmptyString,
  sourceThreadId: Schema.NullOr(ThreadId),
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastFiredAt: Schema.NullOr(IsoDateTime),
  lastFiredSlot: Schema.NullOr(IsoDateTime),
  lastTaskId: Schema.NullOr(TaskId),
  lastError: Schema.NullOr(Schema.String),
  failureCount: Schema.Number,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskAutomation = typeof TaskAutomation.Type;

/** One durable record per claimed schedule slot; the slot is the dedup key. */
export const TaskAutomationRun = Schema.Struct({
  automationId: TaskAutomationId,
  slot: IsoDateTime,
  taskId: Schema.NullOr(TaskId),
  outcome: TaskAutomationRunOutcome,
  detail: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type TaskAutomationRun = typeof TaskAutomationRun.Type;

export const TaskAutomationTemplateInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  status: Schema.optional(TrimmedNonEmptyString),
  priority: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  tags: Schema.optional(Schema.Array(TaskTag)),
});
export type TaskAutomationTemplateInput = typeof TaskAutomationTemplateInput.Type;

export const AutomationGetInput = Schema.Struct({ id: TaskAutomationId });
export type AutomationGetInput = typeof AutomationGetInput.Type;

export const AutomationDeleteInput = Schema.Struct({ id: TaskAutomationId });
export type AutomationDeleteInput = typeof AutomationDeleteInput.Type;

export const TaskAutomationSearchInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  status: Schema.optional(TaskAutomationStatus),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type TaskAutomationSearchInput = typeof TaskAutomationSearchInput.Type;

export const AutomationSearchInput = TaskAutomationSearchInput;
export type AutomationSearchInput = typeof AutomationSearchInput.Type;

export const TaskAutomationSearchResult = Schema.Struct({
  automations: Schema.Array(TaskAutomation),
});
export type TaskAutomationSearchResult = typeof TaskAutomationSearchResult.Type;

export const TaskAutomationRunSearchInput = Schema.Struct({
  automationId: Schema.optional(TaskAutomationId),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type TaskAutomationRunSearchInput = typeof TaskAutomationRunSearchInput.Type;

export const AutomationRunSearchInput = TaskAutomationRunSearchInput;
export type AutomationRunSearchInput = typeof AutomationRunSearchInput.Type;

export const TaskAutomationRunSearchResult = Schema.Struct({
  runs: Schema.Array(TaskAutomationRun),
});
export type TaskAutomationRunSearchResult = typeof TaskAutomationRunSearchResult.Type;

/**
 * Full-control upsert reachable only from the trusted RPC surface, which is
 * why `status` is settable here and absent from every tool-facing input.
 */
export const TaskAutomationUpsertInput = Schema.Struct({
  id: Schema.optional(TaskAutomationId),
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  status: Schema.optional(TaskAutomationStatus),
  schedule: TaskAutomationSchedule,
  template: TaskAutomationTemplateInput,
  catchUpPolicy: Schema.optional(TaskAutomationCatchUpPolicy),
  skipIfOpen: Schema.optional(Schema.Boolean),
  createdBy: Schema.optional(TrimmedNonEmptyString),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type TaskAutomationUpsertInput = typeof TaskAutomationUpsertInput.Type;

/** Human-only lifecycle transition; agents cannot reach this method. */
export const TaskAutomationSetStatusInput = Schema.Struct({
  id: TaskAutomationId,
  status: TaskAutomationStatus,
});
export type TaskAutomationSetStatusInput = typeof TaskAutomationSetStatusInput.Type;

/**
 * Tool-facing create. Automations land in `draft` regardless of what the model
 * asks for, so `status` is intentionally not part of this schema.
 *
 * `id` is absent on purpose: the handler upserts, so accepting a caller-chosen
 * id would let an agent name an existing reviewed automation and overwrite it
 * back into a draft, which is exactly what the review gate exists to prevent.
 */
export const AutomationCreateInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  cron: TrimmedNonEmptyString,
  timezone: Schema.optional(TrimmedNonEmptyString),
  template: TaskAutomationTemplateInput,
  catchUpPolicy: Schema.optional(TaskAutomationCatchUpPolicy),
  skipIfOpen: Schema.optional(Schema.Boolean),
});
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

/** Tool-facing update, accepted only while the automation is still a draft. */
export const AutomationUpdateInput = Schema.Struct({
  id: TaskAutomationId,
  name: Schema.optional(TrimmedNonEmptyString),
  cron: Schema.optional(TrimmedNonEmptyString),
  timezone: Schema.optional(TrimmedNonEmptyString),
  template: Schema.optional(TaskAutomationTemplateInput),
  catchUpPolicy: Schema.optional(TaskAutomationCatchUpPolicy),
  skipIfOpen: Schema.optional(Schema.Boolean),
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

export const DEFAULT_AUTOMATION_TASK_STATUS = "new" as const;
export const DEFAULT_AUTOMATION_TIMEZONE = "UTC" as const;
export const DEFAULT_AUTOMATION_CATCH_UP_POLICY: TaskAutomationCatchUpPolicy = "fire-once";

/** Bounds how many inert drafts one agent loop can pile into a project. */
export const AUTOMATION_DRAFT_LIMIT_PER_PROJECT = 20 as const;

export function isAutomationDueForReview(automation: TaskAutomation): boolean {
  return automation.status === "draft";
}
