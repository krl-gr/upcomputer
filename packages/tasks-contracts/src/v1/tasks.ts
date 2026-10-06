import {
  IsoDateTime,
  ModelSelection,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const TaskId = TrimmedNonEmptyString.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

export const TaskEventId = TrimmedNonEmptyString.pipe(Schema.brand("TaskEventId"));
export type TaskEventId = typeof TaskEventId.Type;

export const TaskTag = TrimmedNonEmptyString;
export type TaskTag = typeof TaskTag.Type;

/** Opaque, lexicographically sortable position in one environment's global task order. */
export const TaskRank = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{16}$/)),
  Schema.brand("TaskRank"),
);
export type TaskRank = typeof TaskRank.Type;

/** ISO 8601 date-time with an explicit offset, for example 2026-10-02T09:00:00Z. */
export const TaskDateTime = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/),
  ),
);
export type TaskDateTime = typeof TaskDateTime.Type;

export const Task = Schema.Struct({
  id: TaskId,
  rank: TaskRank,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  output: Schema.NullOr(Schema.String),
  status: TrimmedNonEmptyString,
  priority: Schema.NullOr(TrimmedNonEmptyString),
  createdBy: TrimmedNonEmptyString,
  assigneeAgentRunId: Schema.NullOr(TrimmedNonEmptyString),
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceRunId: Schema.NullOr(TrimmedNonEmptyString),
  /** Immutable creation lineage, computed by the server. Null for legacy/unknown origins. */
  rootThreadId: Schema.NullOr(ThreadId),
  parentTaskId: Schema.NullOr(TaskId),
  parentRunId: Schema.NullOr(TrimmedNonEmptyString),
  metadata: Schema.Unknown,
  tags: Schema.Array(TaskTag),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  /** No agent run starts on this task before this time. */
  notBefore: Schema.NullOr(IsoDateTime),
  /**
   * Last real change to title, description, status, tags, notBefore or closedAt,
   * computed by the server. An agent runs again only after such a change.
   */
  triggerChangedAt: IsoDateTime,
});
export type Task = typeof Task.Type;

export const TaskEvent = Schema.Struct({
  id: TaskEventId,
  taskId: TaskId,
  kind: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type TaskEvent = typeof TaskEvent.Type;

export const TaskGetInput = Schema.Struct({ id: TaskId });
export type TaskGetInput = typeof TaskGetInput.Type;

export const TaskDeleteInput = Schema.Struct({ id: TaskId });
export type TaskDeleteInput = typeof TaskDeleteInput.Type;

export const TaskCreateInput = Schema.Struct({
  id: Schema.optional(TaskId),
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  output: Schema.optional(Schema.NullOr(Schema.String)),
  status: TrimmedNonEmptyString,
  priority: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdBy: Schema.optional(TrimmedNonEmptyString),
  assigneeAgentRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  sourceRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optional(Schema.Unknown),
  tags: Schema.optional(Schema.Array(TaskTag)),
  notBefore: Schema.optional(Schema.NullOr(TaskDateTime)),
});
export type TaskCreateInput = typeof TaskCreateInput.Type;

export const TaskToolCreateInput = Schema.Struct({
  id: Schema.optional(TaskId),
  projectId: Schema.optional(ProjectId),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  description: Schema.String,
  output: Schema.optional(Schema.NullOr(Schema.String)),
  status: TrimmedNonEmptyString,
  priority: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdBy: Schema.optional(TrimmedNonEmptyString),
  assigneeAgentRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  sourceRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optional(Schema.Unknown),
  tags: Schema.optional(Schema.Array(TaskTag)),
  notBefore: Schema.optional(Schema.NullOr(TaskDateTime)),
});
export type TaskToolCreateInput = typeof TaskToolCreateInput.Type;

export const TaskToolContextInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  modelAlias: Schema.optional(TrimmedNonEmptyString),
});
export type TaskToolContextInput = typeof TaskToolContextInput.Type;

export const TaskUpdateInput = Schema.Struct({
  id: TaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  output: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(TrimmedNonEmptyString),
  priority: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  assigneeAgentRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  sourceRunId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optional(Schema.Unknown),
  tags: Schema.optional(Schema.Array(TaskTag)),
  closedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  notBefore: Schema.optional(Schema.NullOr(TaskDateTime)),
});
export type TaskUpdateInput = typeof TaskUpdateInput.Type;

export const TaskSearchInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  status: Schema.optional(TrimmedNonEmptyString),
  tags: Schema.optional(Schema.Array(TaskTag)),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type TaskSearchInput = typeof TaskSearchInput.Type;

// Keyset cursor for one environment and one filtered query.
export const TaskPageCursor = Schema.Struct({
  rank: TaskRank,
  id: TaskId,
});
export type TaskPageCursor = typeof TaskPageCursor.Type;
export const TaskPageInput = Schema.Struct({
  ...TaskSearchInput.fields,
  cursor: Schema.optional(TaskPageCursor),
});
export type TaskPageInput = typeof TaskPageInput.Type;
export const TaskRunCount = Schema.Struct({ status: Schema.String, count: PositiveInt });
export type TaskRunCount = typeof TaskRunCount.Type;
export const TaskListItem = Schema.Struct({
  ...Task.fields,
  runCounts: Schema.Array(TaskRunCount),
  /** Raw status of the task's latest run (latest start); null without runs. Absent from older servers. */
  latestRunStatus: Schema.optional(Schema.NullOr(Schema.String)),
});
export const TaskPageResult = Schema.Struct({
  tasks: Schema.Array(TaskListItem),
  nextCursor: Schema.NullOr(TaskPageCursor),
  statuses: Schema.Array(Schema.String),
});
export type TaskPageResult = typeof TaskPageResult.Type;

export const TaskListItemsInput = Schema.Struct({
  ids: Schema.Array(TaskId).check(Schema.isMaxLength(500)),
});
export type TaskListItemsInput = typeof TaskListItemsInput.Type;
export const TaskListItemsResult = Schema.Struct({ tasks: Schema.Array(TaskListItem) });
export type TaskListItemsResult = typeof TaskListItemsResult.Type;

// Every connection starts with sync. Sequence gaps (e.g. a slow subscriber)
// also require a snapshot refresh; no unbounded event log is retained.
export const TaskChange = Schema.Struct({
  kind: Schema.Literals(["sync", "changed"]),
  sequence: Schema.Number,
  taskIds: Schema.Array(TaskId),
  listChanged: Schema.Boolean,
  runsChanged: Schema.Boolean,
  rootThreadIds: Schema.Array(ThreadId),
});
export type TaskChange = typeof TaskChange.Type;

export const TaskSearchResult = Schema.Struct({ tasks: Schema.Array(Task) });
export type TaskSearchResult = typeof TaskSearchResult.Type;

/**
 * Reorders one task using durable neighbors in the same authoritative task store.
 * Callers never calculate or submit raw ranks.
 */
export const TaskReorderInput = Schema.Struct({
  id: TaskId,
  beforeTaskId: Schema.optional(TaskId),
  afterTaskId: Schema.optional(TaskId),
});
export type TaskReorderInput = typeof TaskReorderInput.Type;

export const TaskTagInput = Schema.Struct({
  taskId: TaskId,
  tag: TaskTag,
});
export type TaskTagInput = typeof TaskTagInput.Type;

export const TaskAppendEventInput = Schema.Struct({
  id: Schema.optional(TaskEventId),
  taskId: TaskId,
  kind: TrimmedNonEmptyString,
  payload: Schema.optional(Schema.Unknown),
});
export type TaskAppendEventInput = typeof TaskAppendEventInput.Type;

export class TaskError extends Schema.TaggedError<TaskError>()("TaskError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const TaskThreadRunCountsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(500)),
});
export type TaskThreadRunCountsInput = typeof TaskThreadRunCountsInput.Type;
export const TaskThreadRunCountsResult = Schema.Struct({
  threads: Schema.Array(
    Schema.Struct({ threadId: ThreadId, runCounts: Schema.Array(TaskRunCount) }),
  ),
});
export type TaskThreadRunCountsResult = typeof TaskThreadRunCountsResult.Type;

/** Run counts of every task in the environment, by the same rules as a thread's counts. */
export const TaskRunCountsInput = Schema.Struct({});
export type TaskRunCountsInput = typeof TaskRunCountsInput.Type;
export const TaskRunCountsResult = Schema.Struct({ runCounts: Schema.Array(TaskRunCount) });
export type TaskRunCountsResult = typeof TaskRunCountsResult.Type;

/** Tasks whose chain started in one thread: open first, then closed, each in global order. */
export const TaskThreadTasksInput = Schema.Struct({
  threadId: ThreadId,
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
});
export type TaskThreadTasksInput = typeof TaskThreadTasksInput.Type;
export const TaskThreadTasksResult = Schema.Struct({ tasks: Schema.Array(TaskListItem) });
export type TaskThreadTasksResult = typeof TaskThreadTasksResult.Type;
