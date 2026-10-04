import {
  Task,
  TaskAgent,
  TaskAgentDeleteInput,
  TaskAgentId,
  TaskAgentRun,
  TaskAgentRunId,
  TaskAgentRunSearchInput,
  TaskAgentSearchInput,
  TaskAutomation,
  TaskAutomationId,
  TaskAutomationRun,
  TaskAutomationRunSearchInput,
  TaskAutomationSearchInput,
  TaskDeleteInput,
  TaskEvent,
  TaskId,
  TaskReorderInput,
  TaskSearchInput,
  TaskPageInput,
  TaskPageResult,
  TaskListItemsInput,
  TaskListItemsResult,
  TaskChange,
  TaskRunCountsResult,
  TaskThreadRunCountsInput,
  TaskThreadRunCountsResult,
  TaskThreadTasksInput,
  TaskThreadTasksResult,
  TaskTag,
  TaskTagInput,
  TaskUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Stream from "effect/Stream";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TaskRepositoryError } from "./Errors.ts";

export const PersistTaskInput = Schema.Struct({
  ...Task.fields,
  rank: Schema.optional(Task.fields.rank),
  rootThreadId: Schema.optional(Task.fields.rootThreadId),
  parentTaskId: Schema.optional(Task.fields.parentTaskId),
  parentRunId: Schema.optional(Task.fields.parentRunId),
  notBefore: Schema.optional(Task.fields.notBefore),
  /** Server-computed on every write; any supplied value is ignored. */
  triggerChangedAt: Schema.optional(Task.fields.triggerChangedAt),
  /** Trusted invocation context; never exposed as a tool argument. */
  originThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type PersistTaskInput = typeof PersistTaskInput.Type;

export const PersistTaskEventInput = TaskEvent;
export type PersistTaskEventInput = typeof PersistTaskEventInput.Type;

export const PersistTaskAgentInput = TaskAgent;
export type PersistTaskAgentInput = typeof PersistTaskAgentInput.Type;

export const PersistTaskAgentRunInput = TaskAgentRun;
export type PersistTaskAgentRunInput = typeof PersistTaskAgentRunInput.Type;

export const ReplaceTaskTagsInput = Schema.Struct({
  taskId: TaskId,
  tags: Schema.Array(TaskTag),
});
export type ReplaceTaskTagsInput = typeof ReplaceTaskTagsInput.Type;

export const GetTaskInput = Schema.Struct({ id: TaskId });
export type GetTaskInput = typeof GetTaskInput.Type;

export const TouchTaskInput = Schema.Struct({
  taskId: TaskId,
  updatedAt: IsoDateTime,
});
export type TouchTaskInput = typeof TouchTaskInput.Type;

export const GetTaskAgentInput = Schema.Struct({ id: TaskAgentId });
export type GetTaskAgentInput = typeof GetTaskAgentInput.Type;

export const FindActiveTaskAgentRunInput = Schema.Struct({
  taskId: TaskId,
  agentId: TaskAgentId,
});
export type FindActiveTaskAgentRunInput = typeof FindActiveTaskAgentRunInput.Type;

export const FindActiveTaskAgentRunByThreadInput = Schema.Struct({ threadId: ThreadId });
export type FindActiveTaskAgentRunByThreadInput = typeof FindActiveTaskAgentRunByThreadInput.Type;

export const ClaimTaskAgentRunFinalizationInput = Schema.Struct({
  id: TaskAgentRunId,
  finalizingStatus: TrimmedNonEmptyString,
});
export type ClaimTaskAgentRunFinalizationInput = typeof ClaimTaskAgentRunFinalizationInput.Type;

export interface FindRunStatusTriggerInput {
  readonly taskId: TaskId;
  readonly agentId: TaskAgentId;
  readonly statuses: ReadonlyArray<string>;
  /** Only runs completed after this time qualify (the waiting agent's creation). */
  readonly completedAfter: IsoDateTime;
}

export interface FinalizeTaskAgentRunInput {
  readonly id: TaskAgentRunId;
  readonly finalizingStatus: string;
  readonly status: TaskAgentRun["status"];
  readonly completedAt: IsoDateTime;
  readonly taskId: TaskId;
  readonly taskStatus?: Task["status"];
  readonly taskOutput?: string | null;
  readonly releaseAssignment: boolean;
  readonly events: ReadonlyArray<PersistTaskEventInput>;
}

export const PersistTaskAutomationInput = TaskAutomation;
export type PersistTaskAutomationInput = typeof PersistTaskAutomationInput.Type;

export const PersistTaskAutomationRunInput = TaskAutomationRun;
export type PersistTaskAutomationRunInput = typeof PersistTaskAutomationRunInput.Type;

export const GetTaskAutomationInput = Schema.Struct({ id: TaskAutomationId });
export type GetTaskAutomationInput = typeof GetTaskAutomationInput.Type;

export const CountTaskAutomationDraftsInput = Schema.Struct({ projectId: ProjectId });
export type CountTaskAutomationDraftsInput = typeof CountTaskAutomationDraftsInput.Type;

/**
 * Scheduler-owned columns only.
 *
 * The scheduler works from a snapshot read at the start of a pass, so writing
 * the whole row back would revert anything a person changed in between — a
 * pause would silently resurrect itself. The `status = 'enabled'` guard and
 * this narrow column set keep a pass from touching anything it does not own.
 *
 * `firedAt`/`firedSlot`/`firedTaskId` are `null` when the pass did not create a
 * task, which leaves the stored values untouched rather than clearing them.
 */
export const UpdateTaskAutomationScheduleInput = Schema.Struct({
  id: TaskAutomationId,
  nextRunAt: Schema.NullOr(IsoDateTime),
  firedAt: Schema.NullOr(IsoDateTime),
  firedSlot: Schema.NullOr(IsoDateTime),
  firedTaskId: Schema.NullOr(TaskId),
  lastError: Schema.NullOr(Schema.String),
  failureCount: Schema.Number,
  updatedAt: IsoDateTime,
});
export type UpdateTaskAutomationScheduleInput = typeof UpdateTaskAutomationScheduleInput.Type;

/** Explicit lifecycle change for an automation the scheduler cannot keep running. */
export const ParkTaskAutomationInput = Schema.Struct({
  id: TaskAutomationId,
  status: TaskAutomation.fields.status,
  lastError: Schema.NullOr(Schema.String),
  failureCount: Schema.Number,
  updatedAt: IsoDateTime,
});
export type ParkTaskAutomationInput = typeof ParkTaskAutomationInput.Type;

export const CompleteTaskAutomationRunInput = Schema.Struct({
  automationId: TaskAutomationId,
  slot: IsoDateTime,
  taskId: Schema.NullOr(TaskId),
  outcome: TaskAutomationRun.fields.outcome,
  detail: Schema.NullOr(Schema.String),
});
export type CompleteTaskAutomationRunInput = typeof CompleteTaskAutomationRunInput.Type;

export interface TaskRepositoryShape {
  /** Use for multi-service SQL transactions containing task mutations. Events are emitted only after the outer commit. */
  readonly withChangeTransaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | TaskRepositoryError, R>;
  readonly upsert: (task: PersistTaskInput) => Effect.Effect<Task, TaskRepositoryError>;
  readonly getById: (
    input: GetTaskInput,
  ) => Effect.Effect<Option.Option<Task>, TaskRepositoryError>;
  readonly search: (
    input: TaskSearchInput,
  ) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly page: (input: TaskPageInput) => Effect.Effect<TaskPageResult, TaskRepositoryError>;
  readonly items: (
    input: TaskListItemsInput,
  ) => Effect.Effect<TaskListItemsResult, TaskRepositoryError>;
  readonly changes: Stream.Stream<TaskChange>;
  readonly runCounts: () => Effect.Effect<TaskRunCountsResult, TaskRepositoryError>;
  readonly threadRunCounts: (
    input: TaskThreadRunCountsInput,
  ) => Effect.Effect<TaskThreadRunCountsResult, TaskRepositoryError>;
  readonly threadTasks: (
    input: TaskThreadTasksInput,
  ) => Effect.Effect<TaskThreadTasksResult, TaskRepositoryError>;
  readonly listAllTasks: () => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  /** Open tasks whose notBefore falls in (after, until]. */
  readonly listTasksReachingNotBefore: (input: {
    readonly after: IsoDateTime;
    readonly until: IsoDateTime;
  }) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly update: (input: TaskUpdateInput) => Effect.Effect<Task, TaskRepositoryError>;
  readonly reorder: (input: TaskReorderInput) => Effect.Effect<Task, TaskRepositoryError>;
  readonly deleteTask: (input: TaskDeleteInput) => Effect.Effect<void, TaskRepositoryError>;
  readonly replaceTags: (input: ReplaceTaskTagsInput) => Effect.Effect<Task, TaskRepositoryError>;
  readonly addTag: (
    input: TaskTagInput & { readonly updatedAt: IsoDateTime },
  ) => Effect.Effect<Task, TaskRepositoryError>;
  readonly removeTag: (
    input: TaskTagInput & { readonly updatedAt: IsoDateTime },
  ) => Effect.Effect<Task, TaskRepositoryError>;
  readonly appendEvent: (
    input: PersistTaskEventInput,
  ) => Effect.Effect<TaskEvent, TaskRepositoryError>;
  readonly upsertAgent: (
    input: PersistTaskAgentInput,
  ) => Effect.Effect<TaskAgent, TaskRepositoryError>;
  readonly getAgentById: (
    input: GetTaskAgentInput,
  ) => Effect.Effect<Option.Option<TaskAgent>, TaskRepositoryError>;
  readonly searchAgents: (
    input: TaskAgentSearchInput,
  ) => Effect.Effect<ReadonlyArray<TaskAgent>, TaskRepositoryError>;
  readonly listAllAgents: () => Effect.Effect<ReadonlyArray<TaskAgent>, TaskRepositoryError>;
  readonly deleteAgent: (input: TaskAgentDeleteInput) => Effect.Effect<void, TaskRepositoryError>;
  readonly createAgentRun: (
    input: PersistTaskAgentRunInput,
  ) => Effect.Effect<TaskAgentRun, TaskRepositoryError>;
  /**
   * Creates a run only if, at insert time, its task is open and its agent exists
   * and is enabled, and, unless `startableAt` is null, the task is past its
   * notBefore at that time. None when a close, postponement, disable or delete
   * won the race. Explicit continuations pass null: they ignore notBefore.
   */
  readonly startAgentRun: (
    input: PersistTaskAgentRunInput & { readonly startableAt: string | null },
  ) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly getAgentRunById: (input: {
    readonly id: TaskAgentRunId;
  }) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly findActiveAgentRunForTaskAgent: (
    input: FindActiveTaskAgentRunInput,
  ) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly findActiveAgentRunByThreadId: (
    input: FindActiveTaskAgentRunByThreadInput,
  ) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly findLatestAgentRunByThreadId: (
    input: FindActiveTaskAgentRunByThreadInput,
  ) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly listActiveAgentRunsForTask: (
    input: GetTaskInput,
  ) => Effect.Effect<ReadonlyArray<TaskAgentRun>, TaskRepositoryError>;
  readonly listAllActiveAgentRuns: () => Effect.Effect<
    ReadonlyArray<TaskAgentRun>,
    TaskRepositoryError
  >;
  readonly claimAgentRunFinalization: (
    input: ClaimTaskAgentRunFinalizationInput,
  ) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly finalizeAgentRun: (
    input: FinalizeTaskAgentRunInput,
  ) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly searchAgentRuns: (
    input: TaskAgentRunSearchInput,
  ) => Effect.Effect<ReadonlyArray<TaskAgentRun>, TaskRepositoryError>;
  /**
   * The latest run of another agent on the task that ended in one of the
   * statuses, is that agent's latest run on the task, was not itself started by
   * a run status, and has no run of `agentId` started after it.
   */
  readonly findRunStatusTrigger: (
    input: FindRunStatusTriggerInput,
  ) => Effect.Effect<Option.Option<TaskAgentRun>, TaskRepositoryError>;
  readonly upsertAutomation: (
    input: PersistTaskAutomationInput,
  ) => Effect.Effect<TaskAutomation, TaskRepositoryError>;
  /** Plain insert; fails when the id already exists. Used by the tool path. */
  readonly insertAutomation: (
    input: PersistTaskAutomationInput,
  ) => Effect.Effect<TaskAutomation, TaskRepositoryError>;
  /**
   * Resolves `false` when the automation is no longer enabled, meaning a person
   * paused or deleted it while the scheduler pass was in flight.
   */
  readonly updateAutomationSchedule: (
    input: UpdateTaskAutomationScheduleInput,
  ) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly parkAutomation: (
    input: ParkTaskAutomationInput,
  ) => Effect.Effect<boolean, TaskRepositoryError>;
  /** Open tasks this automation produced, matched on durable task metadata. */
  readonly countOpenAutomationTasks: (
    input: GetTaskAutomationInput,
  ) => Effect.Effect<number, TaskRepositoryError>;
  readonly getAutomationById: (
    input: GetTaskAutomationInput,
  ) => Effect.Effect<Option.Option<TaskAutomation>, TaskRepositoryError>;
  readonly searchAutomations: (
    input: TaskAutomationSearchInput,
  ) => Effect.Effect<ReadonlyArray<TaskAutomation>, TaskRepositoryError>;
  readonly listAutomationsByStatus: (input: {
    readonly status: TaskAutomation["status"];
  }) => Effect.Effect<ReadonlyArray<TaskAutomation>, TaskRepositoryError>;
  readonly countAutomationDrafts: (
    input: CountTaskAutomationDraftsInput,
  ) => Effect.Effect<number, TaskRepositoryError>;
  readonly deleteAutomation: (
    input: GetTaskAutomationInput,
  ) => Effect.Effect<void, TaskRepositoryError>;
  /**
   * Claims one schedule slot. Resolves `false` when the slot was already
   * claimed, which is what makes a restarted or overlapping fire a no-op.
   */
  readonly claimAutomationSlot: (
    input: PersistTaskAutomationRunInput,
  ) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly completeAutomationRun: (
    input: CompleteTaskAutomationRunInput,
  ) => Effect.Effect<void, TaskRepositoryError>;
  readonly searchAutomationRuns: (
    input: TaskAutomationRunSearchInput,
  ) => Effect.Effect<ReadonlyArray<TaskAutomationRun>, TaskRepositoryError>;
}

export class TaskRepository extends Context.Service<TaskRepository, TaskRepositoryShape>()(
  "@t3tools/tasks-server/persistence/TaskRepository",
) {}
