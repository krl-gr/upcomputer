import {
  Task,
  TaskAgent,
  TaskAgentId,
  TaskAgentRun,
  TaskAgentRunId,
  AUTOMATION_TASK_CREATOR_PREFIX,
  automationTaskCreator,
  TaskAutomation,
  TaskAutomationId,
  TaskAutomationRun,
  TaskArchiveFilter,
  TaskAudience,
  TaskAudienceFilter,
  TaskEvent,
  TaskEventId,
  TaskId,
  TaskKind,
  TaskKindFilter,
  TaskTag,
  TASK_ARCHIVED_EVENT,
  TASK_STATUS_CHANGED_EVENT,
  TASK_UNARCHIVED_EVENT,
  type TaskActor,
  type TaskSearchInput,
  type TaskPageInput,
  type TaskThreadTasksInput,
  TaskRank,
  TaskRunCount,
  type TaskChange,
  type TaskReminder,
  type TaskScheduleEntry,
  type TaskScheduleSettings,
  TaskThreadRunCountsResult,
  DEFAULT_TASK_REMINDER_LEAD_MINUTES,
  PERSON_DONE_STATUS,
  personTaskStatusError,
  statusForPersonAudience,
  taskKindAudienceError,
} from "@t3tools/tasks-contracts/v1";
import { ModelSelection, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { SqlError } from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  TaskPersistenceSqlError,
  toTaskPersistenceDecodeError,
  toTaskPersistenceSqlError,
} from "./Errors.ts";
import {
  reminderAt,
  scheduledInstant,
  serverTimeZone,
  type ReminderSettings,
} from "../schedule/reminders.ts";
import {
  followTaskState,
  movesEntries,
  reopensTask,
  type FollowedTaskState,
} from "../schedule/followTaskState.ts";
import { makeScheduleQueries } from "./scheduleQueries.ts";
import {
  CompleteTaskAutomationRunInput,
  ClaimTaskAgentRunFinalizationInput,
  CountTaskAutomationDraftsInput,
  GetTaskAutomationInput,
  ParkTaskAutomationInput,
  UpdateTaskAutomationScheduleInput,
  GetTaskInput,
  GetTaskAgentInput,
  FindActiveTaskAgentRunByThreadInput,
  FindActiveTaskAgentRunInput,
  PersistTaskAgentInput,
  PersistTaskAgentRunInput,
  PersistTaskAutomationInput,
  PersistTaskAutomationRunInput,
  PersistTaskEventInput,
  TaskRepository,
  TouchTaskInput,
  type SetTasksArchivedInput,
  type SetTasksArchivedResult,
  type TaskRepositoryShape,
} from "./TaskRepository.ts";
import {
  TASK_RANK_STEP,
  encodeTaskRank,
  centeredTaskRanks,
  rebalancedTaskRanks,
  taskRankBetween,
  taskRanksBetween,
} from "./taskRank.ts";

const TaskDbRow = Schema.Struct({
  id: TaskId,
  rank: Task.fields.rank,
  projectId: Task.fields.projectId,
  title: Task.fields.title,
  description: Task.fields.description,
  output: Task.fields.output,
  status: Task.fields.status,
  priority: Task.fields.priority,
  createdBy: Task.fields.createdBy,
  assigneeAgentRunId: Task.fields.assigneeAgentRunId,
  sourceThreadId: Task.fields.sourceThreadId,
  sourceRunId: Task.fields.sourceRunId,
  rootThreadId: Task.fields.rootThreadId,
  parentTaskId: Task.fields.parentTaskId,
  parentRunId: Task.fields.parentRunId,
  metadata: Schema.fromJsonString(Schema.Unknown),
  createdAt: Task.fields.createdAt,
  updatedAt: Task.fields.updatedAt,
  archivedAt: Task.fields.archivedAt,
  notBefore: Task.fields.notBefore,
  triggerChangedAt: Task.fields.triggerChangedAt,
  audience: TaskAudience,
  kind: TaskKind,
});

const TaskTagDbRow = Schema.Struct({
  taskId: TaskId,
  tag: TaskTag,
});

const TaskEventDbRow = Schema.Struct({
  id: TaskEventId,
  taskId: TaskId,
  kind: TaskEvent.fields.kind,
  payload: Schema.fromJsonString(Schema.Unknown),
  createdAt: TaskEvent.fields.createdAt,
});

const TaskAgentDbRow = Schema.Struct({
  id: TaskAgentId,
  projectId: TaskAgent.fields.projectId,
  name: TaskAgent.fields.name,
  enabled: Schema.Number,
  startStatuses: Schema.fromJsonString(TaskAgent.fields.startStatuses),
  startTags: Schema.fromJsonString(TaskAgent.fields.startTags),
  startRunStatuses: Schema.fromJsonString(TaskAgent.fields.startRunStatuses),
  config: Schema.fromJsonString(TaskAgent.fields.config),
  createdAt: TaskAgent.fields.createdAt,
  updatedAt: TaskAgent.fields.updatedAt,
});

const TaskAgentRunDbRow = Schema.Struct({
  id: TaskAgentRunId,
  taskId: TaskId,
  agentId: TaskAgentId,
  threadId: TaskAgentRun.fields.threadId,
  modelSelection: Schema.fromJsonString(ModelSelection),
  status: TaskAgentRun.fields.status,
  startedAt: TaskAgentRun.fields.startedAt,
  completedAt: TaskAgentRun.fields.completedAt,
  triggerRunId: TaskAgentRun.fields.triggerRunId,
  continuesRunId: TaskAgentRun.fields.continuesRunId,
});

const TaskAutomationDbRow = Schema.Struct({
  id: TaskAutomationId,
  rank: Schema.NullOr(TaskRank),
  projectId: TaskAutomation.fields.projectId,
  name: TaskAutomation.fields.name,
  status: TaskAutomation.fields.status,
  schedule: Schema.fromJsonString(TaskAutomation.fields.schedule),
  template: Schema.fromJsonString(TaskAutomation.fields.template),
  catchUpPolicy: TaskAutomation.fields.catchUpPolicy,
  skipIfOpen: Schema.Number,
  createdBy: TaskAutomation.fields.createdBy,
  sourceThreadId: TaskAutomation.fields.sourceThreadId,
  nextRunAt: TaskAutomation.fields.nextRunAt,
  lastFiredAt: TaskAutomation.fields.lastFiredAt,
  lastFiredSlot: TaskAutomation.fields.lastFiredSlot,
  lastTaskId: TaskAutomation.fields.lastTaskId,
  lastError: TaskAutomation.fields.lastError,
  failureCount: Schema.Number,
  createdAt: TaskAutomation.fields.createdAt,
  updatedAt: TaskAutomation.fields.updatedAt,
});

const TaskAutomationRunDbRow = Schema.Struct({
  automationId: TaskAutomationId,
  slot: TaskAutomationRun.fields.slot,
  taskId: TaskAutomationRun.fields.taskId,
  outcome: TaskAutomationRun.fields.outcome,
  detail: TaskAutomationRun.fields.detail,
  createdAt: TaskAutomationRun.fields.createdAt,
});

function toSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toTaskPersistenceDecodeError(decodeOperation)(cause)
      : toTaskPersistenceSqlError(sqlOperation)(cause);
}

function uniqueTags(tags: ReadonlyArray<TaskTag>): TaskTag[] {
  const seen = new Set<string>();
  const result: TaskTag[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

function attachTags(
  taskRows: ReadonlyArray<typeof TaskDbRow.Type>,
  tagRows: ReadonlyArray<typeof TaskTagDbRow.Type>,
): Task[] {
  const tagsByTaskId = new Map<TaskId, TaskTag[]>();
  for (const row of tagRows) {
    const existing = tagsByTaskId.get(row.taskId);
    if (existing) {
      existing.push(row.tag);
    } else {
      tagsByTaskId.set(row.taskId, [row.tag]);
    }
  }

  return taskRows.map((row) => ({
    ...row,
    tags: tagsByTaskId.get(row.id) ?? [],
  }));
}

/** Whether a write changes what agent triggers react to (see Task.triggerChangedAt). */
function triggerFieldsChanged(
  previous: Task,
  next: Pick<
    Task,
    | "title"
    | "description"
    | "status"
    | "tags"
    | "notBefore"
    | "archivedAt"
    | "projectId"
    | "audience"
    | "kind"
  >,
): boolean {
  const previousTags = new Set(previous.tags);
  const nextTags = new Set(next.tags);
  return (
    previous.title !== next.title ||
    previous.projectId !== next.projectId ||
    previous.audience !== next.audience ||
    previous.kind !== next.kind ||
    previous.description !== next.description ||
    previous.status !== next.status ||
    previous.archivedAt !== next.archivedAt ||
    previous.notBefore !== next.notBefore ||
    previousTags.size !== nextTags.size ||
    [...nextTags].some((tag) => !previousTags.has(tag))
  );
}

const decodeTaskRows = Schema.decodeUnknownEffect(Schema.Array(TaskDbRow));
const decodeTaskTagRows = Schema.decodeUnknownEffect(Schema.Array(TaskTagDbRow));

const decodeLatestRunRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ taskId: TaskId, status: Schema.NullOr(Schema.String) })),
);

function filterTasksByTags(tasks: ReadonlyArray<Task>, tags: ReadonlyArray<TaskTag> | undefined) {
  if (!tags || tags.length === 0) {
    return tasks;
  }
  const requiredTags = new Set(tags);
  return tasks.filter((task) => {
    const taskTags = new Set(task.tags);
    for (const tag of requiredTags) {
      if (!taskTags.has(tag)) {
        return false;
      }
    }
    return true;
  });
}

/** The audience, kind and excluded statuses of a list, with their defaults. */
function listFilters(input: TaskSearchInput) {
  const excluded = [...new Set(input.excludeStatuses ?? [])];
  return {
    audience: input.audience ?? "all",
    kind: input.kind ?? "task",
    excludeStatusesJson: excluded.length > 0 ? JSON.stringify(excluded) : null,
    createdBy: input.createdBy ?? null,
    excludeAutomationTasks: input.excludeAutomationTasks === true ? 1 : 0,
  } as const;
}

function mapAgentRow(row: typeof TaskAgentDbRow.Type): TaskAgent {
  return {
    ...row,
    enabled: row.enabled !== 0,
  };
}

function mapAutomationRow({ rank, ...row }: typeof TaskAutomationDbRow.Type): TaskAutomation {
  return {
    ...row,
    ...(rank === null ? {} : { rank }),
    skipIfOpen: row.skipIfOpen !== 0,
  };
}

function stringifyJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null) ?? "null";
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type PendingTaskChange = Omit<TaskChange, "kind" | "sequence">;

/** The dates of merged changes, as an optional field: absent when none. */
function scheduleDatesOf(events: ReadonlyArray<PendingTaskChange>) {
  const dates = [...new Set(events.flatMap((event) => event.scheduleDates ?? []))].toSorted();
  return dates.length > 0 ? { scheduleDates: dates } : {};
}
/** Dates whose entries followed their task during a write, for that write's change. */
class FollowedScheduleDates extends Context.Reference<string[] | undefined>(
  "@t3tools/tasks-server/FollowedScheduleDates",
  { defaultValue: () => undefined },
) {}

class TaskChangeBatch extends Context.Reference<
  | {
      readonly owner: object;
      readonly events: PendingTaskChange[];
    }
  | undefined
>("@t3tools/tasks-server/TaskChangeBatch", { defaultValue: () => undefined }) {}

const makeTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const events = yield* PubSub.sliding<TaskChange>(256);
  yield* Effect.addFinalizer(() => PubSub.shutdown(events));
  let sequence = 0;
  const changes = Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before announcing sync: writes racing the initial HTTP/RPC
      // snapshot stay queued. A gap in this bounded queue forces another sync.
      const queue = yield* PubSub.subscribe(events);
      return Stream.concat(
        Stream.succeed({
          kind: "sync" as const,
          sequence,
          taskIds: [],
          rootThreadIds: [],
          listChanged: true,
          runsChanged: true,
        }),
        Stream.fromSubscription(queue),
      );
    }),
  );
  const listRevision = () =>
    sql<{ revision: number }>`SELECT revision FROM task_list_revision WHERE id = 1`.pipe(
      Effect.map((rows) => rows[0]!.revision),
    );

  const TASK_COLUMNS = sql`
    id,
    rank,
    project_id AS "projectId",
    title,
    description,
    output,
    status,
    priority,
    created_by AS "createdBy",
    assignee_worker_id AS "assigneeAgentRunId",
    source_thread_id AS "sourceThreadId",
    source_run_id AS "sourceRunId",
    root_thread_id AS "rootThreadId",
    parent_task_id AS "parentTaskId",
    parent_run_id AS "parentRunId",
    metadata_json AS "metadata",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    archived_at AS "archivedAt",
    not_before AS "notBefore",
    trigger_changed_at AS "triggerChangedAt",
    audience,
    kind
  `;
  const schedule = makeScheduleQueries(sql);

  const publishChange = (event: PendingTaskChange) =>
    Effect.suspend(() =>
      PubSub.publish(events, {
        ...event,
        kind: "changed" as const,
        sequence: ++sequence,
      }),
    );
  const withChangeTransaction: TaskRepositoryShape["withChangeTransaction"] = (effect) =>
    Effect.gen(function* () {
      const existing = yield* TaskChangeBatch;
      const batch = { owner: events, events: [] as PendingTaskChange[] };
      const result = yield* sql.withTransaction(
        effect.pipe(Effect.provideService(TaskChangeBatch, batch)),
      );
      if (existing?.owner === events) existing.events.push(...batch.events);
      else if (batch.events.length > 0)
        yield* publishChange({
          taskIds: [...new Set(batch.events.flatMap((event) => event.taskIds))],
          rootThreadIds: [...new Set(batch.events.flatMap((event) => event.rootThreadIds))],
          listChanged: batch.events.some((event) => event.listChanged),
          runsChanged: batch.events.some((event) => event.runsChanged),
          ...scheduleDatesOf(batch.events),
          ...(batch.events.some((event) => event.agentsChanged) ? { agentsChanged: true } : {}),
        });
      return result;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof SqlError
          ? toTaskPersistenceSqlError("TaskRepository.transaction")(cause)
          : cause,
      ),
      Effect.uninterruptible,
    );

  // All UI, tool, automation and agent mutations pass this repository boundary.
  // Multi-write batches use withChangeTransaction to defer until the OUTER commit.
  // Failed transactions never emit changes; notifications cannot be interrupted
  // after commit. Slow consumers cannot block writes (the bus is sliding).
  const withChanges = <A>(
    effect: Effect.Effect<A, import("./Errors.ts").TaskRepositoryError>,
    ids: (result: A) => ReadonlyArray<TaskId>,
    runsChanged = false,
    rootMembershipTaskId?: TaskId,
    scheduleDates?: (result: A) => ReadonlyArray<string>,
  ) => {
    const followed: string[] = [];
    return sql
      .withTransaction(
        Effect.gen(function* () {
          const before = yield* listRevision();
          const rootsBefore = rootMembershipTaskId
            ? yield* rootsForTasks([rootMembershipTaskId])
            : [];
          const result = yield* effect.pipe(Effect.provideService(FollowedScheduleDates, followed));
          const rootsAfter = runsChanged
            ? yield* rootsForTasks(ids(result))
            : rootMembershipTaskId
              ? yield* rootsForTasks([rootMembershipTaskId])
              : [];
          // Recreating a deleted task ID can reattach historical runs; notify both
          // membership changes and run writes, but never cosmetic task upserts.
          const changedRuns =
            runsChanged ||
            rootsBefore.length !== rootsAfter.length ||
            rootsBefore.some((id, index) => id !== rootsAfter[index]);
          const rootThreadIds = changedRuns ? [...new Set([...rootsBefore, ...rootsAfter])] : [];
          const after = yield* listRevision();
          return { result, listChanged: before !== after, rootThreadIds, changedRuns };
        }),
      )
      .pipe(
        Effect.tap(({ result, listChanged, rootThreadIds, changedRuns }) =>
          Effect.gen(function* () {
            const taskIds = ids(result);
            if (taskIds.length === 0) return;
            const dates = [
              ...new Set([...(scheduleDates?.(result) ?? []), ...followed]),
            ].toSorted();
            const event = {
              taskIds,
              listChanged,
              runsChanged: changedRuns,
              rootThreadIds,
              ...(dates.length > 0 ? { scheduleDates: dates } : {}),
            };
            const batch = yield* TaskChangeBatch;
            if (batch?.owner === events) batch.events.push(event);
            else yield* publishChange(event);
          }),
        ),
        Effect.map(({ result }) => result),
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.notify:query", "TaskRepository.notify:decode"),
        ),
        Effect.uninterruptible,
      );
  };

  const rootsForTasks = Effect.fn("TaskRepository.rootsForTasks")(function* (
    ids: readonly TaskId[],
  ) {
    if (ids.length === 0) return [];
    const rows = yield* sql<{ id: string }>`SELECT DISTINCT root_thread_id AS id FROM tasks
      WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)})) AND root_thread_id IS NOT NULL`;
    return rows.map(({ id }) => ThreadId.make(id));
  });

  // A blocked run only awaits input while it is its task's latest run (same
  // order as the run lists: started_at DESC, id ASC). Once a newer run exists
  // it is history and is counted as `blocked:superseded`.
  const countedRunStatus = sql.literal(`CASE WHEN r.status = 'blocked' AND EXISTS (
      SELECT 1 FROM task_agent_runs n WHERE n.task_id = r.task_id
        AND (n.started_at > r.started_at OR (n.started_at = r.started_at AND n.id < r.id))
    ) THEN 'blocked:superseded' ELSE r.status END`);

  const archiveCondition = (archive: TaskArchiveFilter) =>
    sql.literal(
      archive === "all"
        ? "1 = 1"
        : archive === "archived"
          ? "archived_at IS NOT NULL"
          : "archived_at IS NULL",
    );

  /** Audience and kind filters; `all` leaves that column unfiltered. */
  const membershipCondition = (audience: TaskAudienceFilter, kind: TaskKindFilter) => {
    const audienceCondition =
      audience === "all" ? sql.literal("1 = 1") : sql`audience = ${audience}`;
    return kind === "all" ? audienceCondition : sql`${audienceCondition} AND kind = ${kind}`;
  };

  /**
   * History events the server records itself. A caller-supplied id makes the
   * insert idempotent; otherwise SQLite generates one.
   */
  const insertHistoryEvent = (event: {
    readonly id?: string;
    readonly taskId: TaskId;
    readonly kind: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }) => sql`
    INSERT INTO task_events (id, task_id, kind, payload_json, created_at)
    VALUES (
      COALESCE(${event.id ?? null}, 'task-event-' || lower(hex(randomblob(16)))),
      ${event.taskId},
      ${event.kind},
      ${stringifyJsonColumn(event.payload)},
      ${event.createdAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // Active runs (not completed, or blocked and still awaiting input) always count; a
  // finished one only after the thread's seen watermark. A thread never marked seen has
  // none, so all its runs count.
  const threadRunCountRows = SqlSchema.findAll({
    Request: Schema.Struct({ ids: Schema.String }),
    Result: Schema.Struct({ threadId: ThreadId, ...TaskRunCount.fields }),
    execute: ({ ids }) => sql`
      SELECT "threadId", status, COUNT(*) AS count FROM (
        SELECT t.root_thread_id AS "threadId", ${countedRunStatus} AS status,
          r.completed_at AS completed_at, s.seen_at AS seen_at
        FROM tasks t JOIN task_agent_runs r ON r.task_id = t.id
        LEFT JOIN task_thread_seen s ON s.thread_id = t.root_thread_id
        WHERE t.root_thread_id IN (SELECT value FROM json_each(${ids})) AND t.archived_at IS NULL
      )
      WHERE completed_at IS NULL OR status = 'blocked' OR seen_at IS NULL OR completed_at > seen_at
      GROUP BY 1, 2 ORDER BY 1, 2`,
  });
  const threadRunCounts: TaskRepositoryShape["threadRunCounts"] = Effect.fn(
    "TaskRepository.threadRunCounts",
  )(
    function* ({ threadIds }) {
      const rows = yield* threadRunCountRows({ ids: JSON.stringify(threadIds) });
      const grouped = new Map<ThreadId, Array<{ status: string; count: number }>>();
      for (const row of rows) {
        const counts = grouped.get(row.threadId) ?? [];
        counts.push({ status: row.status, count: row.count });
        grouped.set(row.threadId, counts);
      }
      return {
        threads: [...new Set(threadIds)].map((threadId) => ({
          threadId,
          runCounts: grouped.get(threadId) ?? [],
        })),
      } satisfies typeof TaskThreadRunCountsResult.Type;
    },
    Effect.mapError(
      toSqlOrDecodeError(
        "TaskRepository.threadRunCounts:query",
        "TaskRepository.threadRunCounts:decode",
      ),
    ),
  );

  const markThreadsSeen: TaskRepositoryShape["markThreadsSeen"] = Effect.fn(
    "TaskRepository.markThreadsSeen",
  )(
    function* ({ threadIds, seenAt }) {
      const ids = [...new Set(threadIds)];
      if (ids.length === 0) return;
      yield* sql`
        INSERT INTO task_thread_seen (thread_id, seen_at)
        SELECT value, ${seenAt} FROM json_each(${JSON.stringify(ids)})
        WHERE true
        ON CONFLICT (thread_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`;
      // Thread rows read their counts again on a runs change, on every client.
      yield* publishChange({
        taskIds: [],
        listChanged: false,
        runsChanged: true,
        rootThreadIds: ids,
      });
    },
    Effect.mapError(toTaskPersistenceSqlError("TaskRepository.markThreadsSeen")),
  );

  const runCountRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskRunCount,
    execute: () => sql`
      SELECT ${countedRunStatus} AS status, COUNT(*) AS count
      FROM tasks t JOIN task_agent_runs r ON r.task_id = t.id
      WHERE t.archived_at IS NULL
      GROUP BY 1 ORDER BY 1`,
  });
  const runCounts: TaskRepositoryShape["runCounts"] = Effect.fn("TaskRepository.runCounts")(
    function* () {
      return { runCounts: yield* runCountRows() };
    },
    Effect.mapError(
      toSqlOrDecodeError("TaskRepository.runCounts:query", "TaskRepository.runCounts:decode"),
    ),
  );

  // Compute once on insertion, never recursively on reads or when editing a task.
  const originForTask = Effect.fn("TaskRepository.originForTask")(function* (
    task: import("./TaskRepository.ts").PersistTaskInput,
  ) {
    const threadId = task.originThreadId ?? task.sourceThreadId;
    // Continuations share their run's thread, so the thread's latest run is the
    // parent. Only a second run that started the thread anew is ambiguous.
    const byThread = threadId
      ? yield* sql<{ id: string; taskId: string; started: number }>`
      SELECT id, task_id AS "taskId", continues_run_id IS NULL AS started
      FROM task_agent_runs WHERE thread_id = ${threadId}
      ORDER BY started_at DESC, id ASC`
      : [];
    const ambiguous = byThread.filter(({ started }) => started).length > 1;
    const explicit =
      byThread.length === 0 && task.sourceRunId
        ? yield* sql<{ id: string; taskId: string }>`
      SELECT id, task_id AS "taskId" FROM task_agent_runs WHERE id = ${task.sourceRunId}`
        : [];
    const parentRun = ambiguous ? undefined : (byThread[0] ?? explicit[0]);
    if (!parentRun)
      return {
        rootThreadId: ambiguous || task.sourceRunId ? null : threadId,
        parentTaskId: null,
        parentRunId: null,
      };
    if (parentRun.taskId === task.id)
      return yield* Effect.fail(
        toTaskPersistenceSqlError("TaskRepository.origin:self")("A task cannot be its own parent"),
      );
    // Fresh IDs cannot introduce a cycle. Only reused IDs with existing children
    // need an ancestor check; UNION also terminates on malformed legacy cycles.
    const children = yield* sql`SELECT 1 FROM tasks WHERE parent_task_id = ${task.id} LIMIT 1`;
    if (children.length > 0) {
      const cycle = yield* sql`WITH RECURSIVE ancestors(id, parent_task_id) AS (
        SELECT id, parent_task_id FROM tasks WHERE id = ${parentRun.taskId}
        UNION
        SELECT t.id, t.parent_task_id FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
      ) SELECT 1 FROM ancestors WHERE id = ${task.id} OR parent_task_id = ${task.id} LIMIT 1`;
      if (cycle.length > 0)
        return yield* Effect.fail(
          toTaskPersistenceSqlError("TaskRepository.origin:cycle")(
            "Task ancestry would form a cycle",
          ),
        );
    }
    const parent = yield* sql<{ root: string | null; metadata: string }>`
      SELECT root_thread_id AS root, metadata_json AS metadata FROM tasks WHERE id = ${parentRun.taskId}`;
    // Preserve proposal annotations as optional metadata, never as a prerequisite
    // for ancestry. Derive them from the same authoritative parent as the columns.
    const parentMetadata = parent[0] ? metadataRecord(JSON.parse(parent[0].metadata)) : null;
    const proposalId = parentMetadata?.proposalId;
    const agentName = parentMetadata?.agentName;
    const metadata =
      typeof proposalId === "string" && proposalId.trim().length > 0
        ? {
            ...metadataRecord(task.metadata),
            source: "orchestrationProposal",
            proposalId,
            parentTaskId: parentRun.taskId,
            parentAgentRunId: parentRun.id,
            ...(typeof agentName === "string" && agentName.trim().length > 0
              ? { parentAgentName: agentName }
              : {}),
          }
        : task.metadata;
    return {
      rootThreadId: parent[0]?.root ? ThreadId.make(parent[0].root) : null,
      parentTaskId: TaskId.make(parentRun.taskId),
      parentRunId: parentRun.id,
      metadata,
    };
  });

  const upsertTaskRow = SqlSchema.void({
    Request: Task,
    execute: (task) =>
      sql`
        INSERT INTO tasks (
          id,
          rank,
          project_id,
          title,
          description,
          output,
          status,
          priority,
          created_by,
          assignee_worker_id,
          source_thread_id,
          source_run_id,
          root_thread_id,
          parent_task_id,
          parent_run_id,
          metadata_json,
          created_at,
          updated_at,
          archived_at,
          not_before,
          trigger_changed_at,
          audience,
          kind
        )
        VALUES (
          ${task.id},
          ${task.rank},
          ${task.projectId},
          ${task.title},
          ${task.description},
          ${task.output},
          ${task.status},
          ${task.priority},
          ${task.createdBy},
          ${task.assigneeAgentRunId},
          ${task.sourceThreadId},
          ${task.sourceRunId},
          ${task.rootThreadId},
          ${task.parentTaskId},
          ${task.parentRunId},
          ${stringifyJsonColumn(task.metadata)},
          ${task.createdAt},
          ${task.updatedAt},
          ${task.archivedAt},
          ${task.notBefore},
          ${task.triggerChangedAt},
          ${task.audience},
          ${task.kind}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          rank = excluded.rank,
          project_id = excluded.project_id,
          title = excluded.title,
          description = excluded.description,
          output = excluded.output,
          status = excluded.status,
          priority = excluded.priority,
          created_by = excluded.created_by,
          assignee_worker_id = excluded.assignee_worker_id,
          source_thread_id = excluded.source_thread_id,
          source_run_id = excluded.source_run_id,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          not_before = excluded.not_before,
          trigger_changed_at = excluded.trigger_changed_at,
          audience = excluded.audience,
          kind = excluded.kind
      `,
  });

  const deleteTaskTags = SqlSchema.void({
    Request: Schema.Struct({ taskId: TaskId }),
    execute: ({ taskId }) =>
      sql`
        DELETE FROM task_tags
        WHERE task_id = ${taskId}
      `,
  });

  const deleteTaskRow = SqlSchema.void({
    Request: GetTaskInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM tasks
        WHERE id = ${id}
      `,
  });

  const insertTaskTag = SqlSchema.void({
    Request: Schema.Struct({ taskId: TaskId, tag: TaskTag }),
    execute: ({ taskId, tag }) =>
      sql`
        INSERT OR IGNORE INTO task_tags (task_id, tag)
        VALUES (${taskId}, ${tag})
      `,
  });

  const removeTaskTag = SqlSchema.void({
    Request: Schema.Struct({ taskId: TaskId, tag: TaskTag }),
    execute: ({ taskId, tag }) =>
      sql`
        DELETE FROM task_tags
        WHERE task_id = ${taskId} AND tag = ${tag}
      `,
  });

  // Runs before the tag write, so the EXISTS check sees the old tag set.
  const markTagTriggerChange = (input: {
    readonly taskId: TaskId;
    readonly tag: TaskTag;
    readonly present: boolean;
    readonly changedAt: string;
  }) => sql`
    UPDATE tasks SET trigger_changed_at = ${input.changedAt}
    WHERE id = ${input.taskId}
      AND ${input.present ? 1 : 0} = EXISTS (
        SELECT 1 FROM task_tags WHERE task_id = ${input.taskId} AND tag = ${input.tag}
      )
  `;

  const touchTask = SqlSchema.void({
    Request: TouchTaskInput,
    execute: ({ taskId, updatedAt }) =>
      sql`
        UPDATE tasks
        SET updated_at = ${updatedAt}
        WHERE id = ${taskId}
      `,
  });

  const getTaskRow = SqlSchema.findOneOption({
    Request: GetTaskInput,
    Result: TaskDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          ${TASK_COLUMNS}
        FROM tasks
        WHERE id = ${id}
        LIMIT 1
      `,
  });

  // Primary-key lookup for patches; do not scan the ordered list with optional
  // filter predicates just to refresh a handful of already-visible rows.
  const taskRowsByIds = SqlSchema.findAll({
    Request: Schema.Struct({ idsJson: Schema.String }),
    Result: TaskDbRow,
    execute: ({ idsJson }) => sql`
      SELECT
          ${TASK_COLUMNS}
      FROM tasks WHERE id IN (SELECT value FROM json_each(${idsJson}))
      LIMIT 500
    `,
  });

  const searchTaskRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.NullOr(Task.fields.projectId),
      status: Schema.NullOr(Task.fields.status),
      tagsJson: Schema.String,
      tagCount: Schema.Number,
      archive: TaskArchiveFilter,
      audience: TaskAudienceFilter,
      kind: TaskKindFilter,
      excludeStatusesJson: Schema.NullOr(Schema.String),
      createdBy: Schema.NullOr(Schema.String),
      excludeAutomationTasks: Schema.Number,
      afterRank: Schema.NullOr(Task.fields.rank),
      afterId: Schema.NullOr(TaskId),
      fromBottom: Schema.Boolean,
      limit: Schema.Number,
    }),
    Result: TaskDbRow,
    execute: ({
      projectId,
      status,
      tagsJson,
      tagCount,
      archive,
      audience,
      kind,
      excludeStatusesJson,
      createdBy,
      excludeAutomationTasks,
      afterRank,
      afterId,
      fromBottom,
      limit,
    }) =>
      sql`
        SELECT
          ${TASK_COLUMNS}
        FROM tasks
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND (${status} IS NULL OR status = ${status})
          AND ${archiveCondition(archive)}
          AND ${membershipCondition(audience, kind)}
          AND (${excludeStatusesJson} IS NULL
            OR status NOT IN (SELECT value FROM json_each(${excludeStatusesJson})))
          AND (${createdBy} IS NULL OR created_by = ${createdBy})
          AND (${excludeAutomationTasks} = 0
            OR created_by NOT GLOB ${`${AUTOMATION_TASK_CREATOR_PREFIX}*`})
          AND (
            ${tagCount} = 0
            OR id IN (
              SELECT task_id
              FROM task_tags
              WHERE tag IN (SELECT value FROM json_each(${tagsJson}))
              GROUP BY task_id
              HAVING COUNT(DISTINCT tag) = ${tagCount}
            )
          )
          AND (${afterRank} IS NULL OR rank > ${afterRank}
            OR (rank = ${afterRank} AND id > ${afterId}))
        ORDER BY ${fromBottom ? sql`rank DESC, id DESC` : sql`rank ASC, id ASC`}
        LIMIT ${limit}
      `,
  });

  const listAllTaskRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskDbRow,
    execute: () =>
      sql`
        SELECT
          ${TASK_COLUMNS}
        FROM tasks
        ORDER BY rank ASC, id ASC
      `,
  });

  const triggerCandidateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskDbRow,
    execute: () =>
      sql`
        SELECT
          ${TASK_COLUMNS}
        FROM tasks
        WHERE archived_at IS NULL AND kind = 'task'
          AND (audience = 'agent' OR EXISTS (SELECT 1 FROM task_tags WHERE task_id = tasks.id))
        ORDER BY rank ASC, id ASC
      `,
  });

  // Uses `tasks_root_thread_id`; unarchived tasks only, in global order.
  const threadTaskRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId, limit: Schema.Number }),
    Result: TaskDbRow,
    execute: ({ threadId, limit }) =>
      sql`
        SELECT
          ${TASK_COLUMNS}
        FROM tasks
        WHERE root_thread_id = ${threadId} AND archived_at IS NULL
        ORDER BY rank ASC, id ASC
        LIMIT ${limit}
      `,
  });

  const setTaskRank = SqlSchema.void({
    Request: Schema.Struct({ id: TaskId, rank: Task.fields.rank }),
    execute: ({ id, rank }) => sql`UPDATE tasks SET rank = ${rank} WHERE id = ${id}`,
  });

  const clearTaskRanks = () => sql`UPDATE tasks SET rank = NULL`;

  const listTaskIdRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ id: TaskId, rank: Task.fields.rank }),
    execute: () => sql`SELECT id, rank FROM tasks ORDER BY rank ASC, id ASC`,
  });

  const getFirstTaskRankRow = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Schema.Struct({ rank: Task.fields.rank }),
    execute: () => sql`SELECT rank FROM tasks ORDER BY rank ASC, id ASC LIMIT 1`,
  });

  const listTaskTags = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskTagDbRow,
    execute: () =>
      sql`
        SELECT task_id AS "taskId", tag
        FROM task_tags
        ORDER BY task_id ASC, tag ASC
      `,
  });

  const listTaskTagsForTask = SqlSchema.findAll({
    Request: GetTaskInput,
    Result: TaskTagDbRow,
    execute: ({ id }) =>
      sql`
        SELECT task_id AS "taskId", tag
        FROM task_tags
        WHERE task_id = ${id}
        ORDER BY tag ASC
      `,
  });

  const insertTaskEvent = SqlSchema.void({
    Request: PersistTaskEventInput,
    execute: (event) =>
      sql`
        INSERT INTO task_events (
          id,
          task_id,
          kind,
          payload_json,
          created_at
        )
        VALUES (
          ${event.id},
          ${event.taskId},
          ${event.kind},
          ${stringifyJsonColumn(event.payload)},
          ${event.createdAt}
        )
        ON CONFLICT (id) DO NOTHING
      `,
  });

  const getTaskEventRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: TaskEventId }),
    Result: TaskEventDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          kind,
          payload_json AS "payload",
          created_at AS "createdAt"
        FROM task_events
        WHERE id = ${id}
        LIMIT 1
      `,
  });

  const upsertAgentRow = SqlSchema.void({
    Request: PersistTaskAgentInput,
    execute: (agent) =>
      sql`
        INSERT INTO task_agents (
          id,
          project_id,
          name,
          enabled,
          start_statuses_json,
          start_tags_json,
          config_json,
          start_run_statuses_json,
          created_at,
          updated_at
        )
        VALUES (
          ${agent.id},
          ${agent.projectId},
          ${agent.name},
          ${agent.enabled ? 1 : 0},
          ${stringifyJsonColumn(agent.startStatuses)},
          ${stringifyJsonColumn(agent.startTags)},
          ${stringifyJsonColumn(agent.config)},
          ${stringifyJsonColumn(agent.startRunStatuses)},
          ${agent.createdAt},
          ${agent.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          enabled = excluded.enabled,
          start_statuses_json = excluded.start_statuses_json,
          start_tags_json = excluded.start_tags_json,
          config_json = excluded.config_json,
          start_run_statuses_json = excluded.start_run_statuses_json,
          updated_at = excluded.updated_at
      `,
  });

  const getAgentRow = SqlSchema.findOneOption({
    Request: GetTaskAgentInput,
    Result: TaskAgentDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          name,
          enabled,
          start_statuses_json AS "startStatuses",
          start_tags_json AS "startTags",
          config_json AS "config",
          start_run_statuses_json AS "startRunStatuses",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM task_agents
        WHERE id = ${id}
        LIMIT 1
      `,
  });

  const searchAgentRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.NullOr(Task.fields.projectId),
      enabled: Schema.NullOr(Schema.Number),
      limit: Schema.Number,
    }),
    Result: TaskAgentDbRow,
    execute: ({ projectId, enabled, limit }) =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          name,
          enabled,
          start_statuses_json AS "startStatuses",
          start_tags_json AS "startTags",
          config_json AS "config",
          start_run_statuses_json AS "startRunStatuses",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM task_agents
        WHERE (${projectId} IS NULL OR project_id IS NULL OR project_id = ${projectId})
          AND (${enabled} IS NULL OR enabled = ${enabled})
        ORDER BY updated_at DESC, created_at DESC, id ASC
        LIMIT ${limit}
      `,
  });

  const listAllAgentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskAgentDbRow,
    execute: () =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          name,
          enabled,
          start_statuses_json AS "startStatuses",
          start_tags_json AS "startTags",
          config_json AS "config",
          start_run_statuses_json AS "startRunStatuses",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM task_agents
        ORDER BY updated_at DESC, created_at DESC, id ASC
      `,
  });

  const deleteAgentRow = SqlSchema.void({
    Request: GetTaskAgentInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM task_agents
        WHERE id = ${id}
      `,
  });

  const insertAgentRun = SqlSchema.void({
    Request: PersistTaskAgentRunInput,
    execute: (run) =>
      sql`
        INSERT INTO task_agent_runs (
          id,
          task_id,
          agent_id,
          thread_id,
          model_selection_json,
          status,
          started_at,
          completed_at,
          trigger_run_id,
          continues_run_id
        )
        VALUES (
          ${run.id},
          ${run.taskId},
          ${run.agentId},
          ${run.threadId},
          ${stringifyJsonColumn(run.modelSelection)},
          ${run.status},
          ${run.startedAt},
          ${run.completedAt},
          ${run.triggerRunId},
          ${run.continuesRunId}
        )
      `,
  });

  const startAgentRunRow = SqlSchema.findAll({
    Request: Schema.Struct({
      ...PersistTaskAgentRunInput.fields,
      startableAt: Schema.NullOr(Schema.String),
    }),
    Result: Schema.Struct({ id: TaskAgentRunId }),
    execute: (run) =>
      sql`
        INSERT INTO task_agent_runs (
          id,
          task_id,
          agent_id,
          thread_id,
          model_selection_json,
          status,
          started_at,
          completed_at,
          trigger_run_id,
          continues_run_id
        )
        SELECT
          ${run.id},
          ${run.taskId},
          ${run.agentId},
          ${run.threadId},
          ${stringifyJsonColumn(run.modelSelection)},
          ${run.status},
          ${run.startedAt},
          ${run.completedAt},
          ${run.triggerRunId},
          ${run.continuesRunId}
        WHERE EXISTS (
            SELECT 1 FROM tasks
            WHERE id = ${run.taskId}
              AND archived_at IS NULL
              AND (${run.startableAt} IS NULL OR not_before IS NULL OR not_before <= ${run.startableAt})
              AND (${run.startableAt} IS NULL OR (kind = 'task' AND (audience = 'agent' OR (
                SELECT json_array_length(start_tags_json) FROM task_agents WHERE id = ${run.agentId}
              ) > 0)))
          )
          AND EXISTS (SELECT 1 FROM task_agents WHERE id = ${run.agentId} AND enabled = 1)
          AND NOT EXISTS (
            SELECT 1 FROM bots WHERE agent_id = ${run.agentId}
            AND NOT EXISTS (
              SELECT 1 FROM tasks, json_each(bots.allowed_projects_json) AS allowed
              WHERE tasks.id = ${run.taskId} AND tasks.project_id = allowed.value
            )
          )
        RETURNING id
      `,
  });

  const getAgentRunRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: TaskAgentRunId }),
    Result: TaskAgentRunDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE id = ${id}
        LIMIT 1
      `,
  });

  const findActiveAgentRunRow = SqlSchema.findOneOption({
    Request: FindActiveTaskAgentRunInput,
    Result: TaskAgentRunDbRow,
    execute: ({ taskId, agentId }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE task_id = ${taskId}
          AND agent_id = ${agentId}
          AND completed_at IS NULL
        ORDER BY started_at DESC, id ASC
        LIMIT 1
      `,
  });

  const findActiveAgentRunByThreadRow = SqlSchema.findOneOption({
    Request: FindActiveTaskAgentRunByThreadInput,
    Result: TaskAgentRunDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE thread_id = ${threadId}
          AND completed_at IS NULL
        ORDER BY started_at DESC, id ASC
        LIMIT 1
      `,
  });

  const findLatestAgentRunByThreadRow = SqlSchema.findOneOption({
    Request: FindActiveTaskAgentRunByThreadInput,
    Result: TaskAgentRunDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE thread_id = ${threadId}
        ORDER BY started_at DESC, id ASC
        LIMIT 1
      `,
  });

  const listActiveAgentRunRowsForTask = SqlSchema.findAll({
    Request: GetTaskInput,
    Result: TaskAgentRunDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE task_id = ${id}
          AND completed_at IS NULL
        ORDER BY started_at ASC, id ASC
      `,
  });

  const listAllActiveAgentRunRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskAgentRunDbRow,
    execute: () =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE completed_at IS NULL
        ORDER BY started_at ASC, id ASC
      `,
  });

  /**
   * A finalizer of the same kind may claim again (crash recovery). A result
   * finalization only reads and writes task storage, and its commit checks the
   * status it claimed, so any finalizer may also take one over: recovery
   * replays or rolls back an abandoned one, and a stop can end its run.
   */
  const claimAgentRunFinalizationRow = SqlSchema.findAll({
    Request: ClaimTaskAgentRunFinalizationInput,
    Result: Schema.Struct({ id: TaskAgentRunId }),
    execute: ({ id, finalizingStatus }) =>
      sql`
        UPDATE task_agent_runs
        SET status = ${finalizingStatus}
        WHERE id = ${id}
          AND completed_at IS NULL
          AND (
            status = ${finalizingStatus}
            OR status = 'finalizing:result'
            OR status NOT LIKE 'finalizing:%'
          )
        RETURNING id
      `,
  });

  const completeOwnedAgentRunRow = SqlSchema.findAll({
    Request: Schema.Struct({
      id: TaskAgentRunId,
      finalizingStatus: Schema.String,
      status: TaskAgentRun.fields.status,
      completedAt: TaskAgentRun.fields.completedAt,
    }),
    Result: Schema.Struct({ id: TaskAgentRunId }),
    execute: ({ id, finalizingStatus, status, completedAt }) =>
      sql`
        UPDATE task_agent_runs
        SET status = ${status}, completed_at = ${completedAt}
        WHERE id = ${id}
          AND status = ${finalizingStatus}
          AND completed_at IS NULL
        RETURNING id
      `,
  });

  const searchAgentRunRows = SqlSchema.findAll({
    Request: Schema.Struct({
      taskId: Schema.NullOr(TaskId),
      agentId: Schema.NullOr(TaskAgentId),
      status: Schema.NullOr(TaskAgentRun.fields.status),
      activeOnly: Schema.Boolean,
      afterStartedAt: Schema.NullOr(TaskAgentRun.fields.startedAt),
      afterId: Schema.NullOr(TaskAgentRunId),
      limit: Schema.Number,
    }),
    Result: TaskAgentRunDbRow,
    execute: ({ taskId, agentId, status, activeOnly, afterStartedAt, afterId, limit }) =>
      sql`
        SELECT
          id,
          task_id AS "taskId",
          agent_id AS "agentId",
          thread_id AS "threadId",
          model_selection_json AS "modelSelection",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          trigger_run_id AS "triggerRunId",
          continues_run_id AS "continuesRunId"
        FROM task_agent_runs
        WHERE (${taskId} IS NULL OR task_id = ${taskId})
          AND (${agentId} IS NULL OR agent_id = ${agentId})
          AND (${status} IS NULL OR status = ${status})
          AND (${activeOnly ? 1 : 0} = 0 OR completed_at IS NULL)
          AND (${afterStartedAt} IS NULL OR started_at < ${afterStartedAt}
            OR (started_at = ${afterStartedAt} AND id > ${afterId}))
        ORDER BY started_at DESC, id ASC
        LIMIT ${limit}
      `,
  });

  const runStatusTriggerRows = SqlSchema.findAll({
    Request: Schema.Struct({
      taskId: TaskId,
      agentId: TaskAgentId,
      statusesJson: Schema.String,
      completedAfter: TaskAgentRun.fields.startedAt,
    }),
    Result: TaskAgentRunDbRow,
    execute: ({ taskId, agentId, statusesJson, completedAfter }) =>
      sql`
        SELECT
          r.id,
          r.task_id AS "taskId",
          r.agent_id AS "agentId",
          r.thread_id AS "threadId",
          r.model_selection_json AS "modelSelection",
          r.status,
          r.started_at AS "startedAt",
          r.completed_at AS "completedAt",
          r.trigger_run_id AS "triggerRunId",
          r.continues_run_id AS "continuesRunId"
        FROM task_agent_runs r
        WHERE r.task_id = ${taskId}
          AND r.agent_id <> ${agentId}
          AND r.status IN (SELECT value FROM json_each(${statusesJson}))
          AND r.trigger_run_id IS NULL
          AND r.completed_at > ${completedAfter}
          AND NOT EXISTS (
            SELECT 1 FROM task_agent_runs n
            WHERE n.task_id = r.task_id AND n.agent_id = r.agent_id
              AND (n.started_at > r.started_at OR (n.started_at = r.started_at AND n.id < r.id))
          )
          AND NOT EXISTS (
            SELECT 1 FROM task_agent_runs d
            WHERE d.task_id = r.task_id AND d.agent_id = ${agentId}
              AND d.started_at >= r.completed_at
          )
        ORDER BY r.completed_at DESC, r.id ASC
      `,
  });

  const notBeforeTaskIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ after: Schema.String, until: Schema.String }),
    Result: Schema.Struct({ id: TaskId }),
    execute: ({ after, until }) => sql`
      SELECT id FROM tasks
      WHERE not_before > ${after} AND not_before <= ${until} AND archived_at IS NULL
      ORDER BY rank ASC, id ASC
    `,
  });

  const AUTOMATION_COLUMNS = sql`
    id,
    rank,
    project_id AS "projectId",
    name,
    status,
    schedule_json AS "schedule",
    template_json AS "template",
    catch_up_policy AS "catchUpPolicy",
    skip_if_open AS "skipIfOpen",
    created_by AS "createdBy",
    source_thread_id AS "sourceThreadId",
    next_run_at AS "nextRunAt",
    last_fired_at AS "lastFiredAt",
    last_fired_slot AS "lastFiredSlot",
    last_task_id AS "lastTaskId",
    last_error AS "lastError",
    failure_count AS "failureCount",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const upsertAutomationRow = SqlSchema.void({
    Request: PersistTaskAutomationInput,
    execute: (automation) =>
      sql`
        INSERT INTO task_automations (
          id,
          rank,
          project_id,
          name,
          status,
          schedule_json,
          template_json,
          catch_up_policy,
          skip_if_open,
          created_by,
          source_thread_id,
          next_run_at,
          last_fired_at,
          last_fired_slot,
          last_task_id,
          last_error,
          failure_count,
          created_at,
          updated_at
        )
        VALUES (
          ${automation.id},
          ${automation.rank},
          ${automation.projectId},
          ${automation.name},
          ${automation.status},
          ${stringifyJsonColumn(automation.schedule)},
          ${stringifyJsonColumn(automation.template)},
          ${automation.catchUpPolicy},
          ${automation.skipIfOpen ? 1 : 0},
          ${automation.createdBy},
          ${automation.sourceThreadId},
          ${automation.nextRunAt},
          ${automation.lastFiredAt},
          ${automation.lastFiredSlot},
          ${automation.lastTaskId},
          ${automation.lastError},
          ${automation.failureCount},
          ${automation.createdAt},
          ${automation.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          status = excluded.status,
          schedule_json = excluded.schedule_json,
          template_json = excluded.template_json,
          catch_up_policy = excluded.catch_up_policy,
          skip_if_open = excluded.skip_if_open,
          created_by = excluded.created_by,
          source_thread_id = excluded.source_thread_id,
          next_run_at = excluded.next_run_at,
          last_fired_at = excluded.last_fired_at,
          last_fired_slot = excluded.last_fired_slot,
          last_task_id = excluded.last_task_id,
          last_error = excluded.last_error,
          failure_count = excluded.failure_count,
          updated_at = excluded.updated_at
      `,
  });

  const insertAutomationRow = SqlSchema.void({
    Request: PersistTaskAutomationInput,
    execute: (automation) =>
      sql`
        INSERT INTO task_automations (
          id,
          rank,
          project_id,
          name,
          status,
          schedule_json,
          template_json,
          catch_up_policy,
          skip_if_open,
          created_by,
          source_thread_id,
          next_run_at,
          last_fired_at,
          last_fired_slot,
          last_task_id,
          last_error,
          failure_count,
          created_at,
          updated_at
        )
        VALUES (
          ${automation.id},
          ${automation.rank},
          ${automation.projectId},
          ${automation.name},
          ${automation.status},
          ${stringifyJsonColumn(automation.schedule)},
          ${stringifyJsonColumn(automation.template)},
          ${automation.catchUpPolicy},
          ${automation.skipIfOpen ? 1 : 0},
          ${automation.createdBy},
          ${automation.sourceThreadId},
          ${automation.nextRunAt},
          ${automation.lastFiredAt},
          ${automation.lastFiredSlot},
          ${automation.lastTaskId},
          ${automation.lastError},
          ${automation.failureCount},
          ${automation.createdAt},
          ${automation.updatedAt}
        )
      `,
  });

  const updateAutomationScheduleRow = SqlSchema.findAll({
    Request: UpdateTaskAutomationScheduleInput,
    Result: Schema.Struct({ id: TaskAutomationId }),
    execute: (input) =>
      sql`
        UPDATE task_automations
        SET next_run_at = ${input.nextRunAt},
          last_fired_at = COALESCE(${input.firedAt}, last_fired_at),
          last_fired_slot = COALESCE(${input.firedSlot}, last_fired_slot),
          last_task_id = COALESCE(${input.firedTaskId}, last_task_id),
          last_error = ${input.lastError},
          failure_count = ${input.failureCount},
          updated_at = ${input.updatedAt}
        WHERE id = ${input.id} AND status = 'enabled'
        RETURNING id
      `,
  });

  const parkAutomationRow = SqlSchema.findAll({
    Request: ParkTaskAutomationInput,
    Result: Schema.Struct({ id: TaskAutomationId }),
    execute: (input) =>
      sql`
        UPDATE task_automations
        SET status = ${input.status},
          next_run_at = NULL,
          last_error = ${input.lastError},
          failure_count = ${input.failureCount},
          updated_at = ${input.updatedAt}
        WHERE id = ${input.id} AND status = 'enabled'
        RETURNING id
      `,
  });

  const countOpenAutomationTaskRows = SqlSchema.findOneOption({
    Request: GetTaskAutomationInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ id }) =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM tasks
        WHERE archived_at IS NULL
          AND json_extract(metadata_json, '$.automationId') = ${id}
      `,
  });

  const getAutomationRow = SqlSchema.findOneOption({
    Request: GetTaskAutomationInput,
    Result: TaskAutomationDbRow,
    execute: ({ id }) =>
      sql`
        SELECT ${AUTOMATION_COLUMNS}
        FROM task_automations
        WHERE id = ${id}
        LIMIT 1
      `,
  });

  const searchAutomationRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.NullOr(TaskAutomation.fields.projectId),
      status: Schema.NullOr(TaskAutomation.fields.status),
      limit: Schema.Number,
    }),
    Result: TaskAutomationDbRow,
    execute: ({ projectId, status, limit }) =>
      sql`
        SELECT ${AUTOMATION_COLUMNS}
        FROM task_automations
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND (${status} IS NULL OR status = ${status})
        ORDER BY rank ASC, id ASC
        LIMIT ${limit}
      `,
  });

  const listAutomationRowsByStatus = SqlSchema.findAll({
    Request: Schema.Struct({ status: TaskAutomation.fields.status }),
    Result: TaskAutomationDbRow,
    execute: ({ status }) =>
      sql`
        SELECT ${AUTOMATION_COLUMNS}
        FROM task_automations
        WHERE status = ${status}
        ORDER BY next_run_at ASC, id ASC
      `,
  });

  const countAutomationDraftRows = SqlSchema.findOneOption({
    Request: CountTaskAutomationDraftsInput,
    Result: Schema.Struct({ count: Schema.Number }),
    execute: ({ projectId }) =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM task_automations
        WHERE project_id = ${projectId} AND status = 'draft'
      `,
  });

  const deleteAutomationRow = SqlSchema.void({
    Request: GetTaskAutomationInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM task_automations
        WHERE id = ${id}
      `,
  });

  const setAutomationRank = SqlSchema.void({
    Request: Schema.Struct({ id: TaskAutomationId, rank: Task.fields.rank }),
    execute: ({ id, rank }) => sql`UPDATE task_automations SET rank = ${rank} WHERE id = ${id}`,
  });

  // Unranked rows (written by a build from before migration 024) come first.
  const listAutomationRankRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ id: TaskAutomationId, rank: Schema.NullOr(TaskRank) }),
    execute: () => sql`SELECT id, rank FROM task_automations ORDER BY rank ASC, id ASC`,
  });

  const automationTaskCountRows = SqlSchema.findAll({
    Request: Schema.Struct({ creatorsJson: Schema.String }),
    Result: Schema.Struct({ createdBy: Schema.String, count: Schema.Number }),
    execute: ({ creatorsJson }) => sql`
      SELECT created_by AS "createdBy", COUNT(*) AS "count"
      FROM tasks
      WHERE created_by IN (SELECT value FROM json_each(${creatorsJson}))
      GROUP BY created_by
    `,
  });

  const insertAutomationRunRow = SqlSchema.void({
    Request: PersistTaskAutomationRunInput,
    execute: (run) =>
      sql`
        INSERT INTO task_automation_runs (
          automation_id,
          slot,
          task_id,
          outcome,
          detail,
          created_at
        )
        VALUES (
          ${run.automationId},
          ${run.slot},
          ${run.taskId},
          ${run.outcome},
          ${run.detail},
          ${run.createdAt}
        )
      `,
  });

  const getAutomationRunRow = SqlSchema.findOneOption({
    Request: Schema.Struct({
      automationId: TaskAutomationId,
      slot: TaskAutomationRun.fields.slot,
    }),
    Result: TaskAutomationRunDbRow,
    execute: ({ automationId, slot }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          slot,
          task_id AS "taskId",
          outcome,
          detail,
          created_at AS "createdAt"
        FROM task_automation_runs
        WHERE automation_id = ${automationId} AND slot = ${slot}
        LIMIT 1
      `,
  });

  const completeAutomationRunRow = SqlSchema.void({
    Request: CompleteTaskAutomationRunInput,
    execute: ({ automationId, slot, taskId, outcome, detail }) =>
      sql`
        UPDATE task_automation_runs
        SET task_id = ${taskId},
          outcome = ${outcome},
          detail = ${detail}
        WHERE automation_id = ${automationId} AND slot = ${slot}
      `,
  });

  const searchAutomationRunRows = SqlSchema.findAll({
    Request: Schema.Struct({
      automationId: Schema.NullOr(TaskAutomationId),
      limit: Schema.Number,
    }),
    Result: TaskAutomationRunDbRow,
    execute: ({ automationId, limit }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          slot,
          task_id AS "taskId",
          outcome,
          detail,
          created_at AS "createdAt"
        FROM task_automation_runs
        WHERE (${automationId} IS NULL OR automation_id = ${automationId})
        ORDER BY created_at DESC, slot DESC
        LIMIT ${limit}
      `,
  });

  const writeTaskTags = (taskId: TaskId, tags: ReadonlyArray<TaskTag>) => {
    const nextTags = uniqueTags(tags);
    return sql`DELETE FROM task_tags WHERE task_id = ${taskId}
      AND tag NOT IN (SELECT value FROM json_each(${JSON.stringify(nextTags)}))`.pipe(
      Effect.andThen(
        Effect.forEach(nextTags, (tag) => insertTaskTag({ taskId, tag }), {
          discard: true,
          concurrency: 1,
        }),
      ),
    );
  };

  const getById: TaskRepositoryShape["getById"] = (input) =>
    Effect.all([getTaskRow(input), listTaskTagsForTask(input)]).pipe(
      Effect.mapError(
        toSqlOrDecodeError("TaskRepository.getById:query", "TaskRepository.getById:decodeRows"),
      ),
      Effect.map(([task, tagRows]) =>
        Option.map(task, (row) => attachTags([row], tagRows)[0] ?? { ...row, tags: [] }),
      ),
    );

  const rebalanceTaskRows = (
    rows: ReadonlyArray<{ readonly id: TaskId }>,
    spacing: typeof rebalancedTaskRanks = rebalancedTaskRanks,
  ) => {
    const ranks = spacing(rows.map(({ id }) => id));
    return clearTaskRanks().pipe(
      Effect.andThen(
        Effect.forEach(rows, ({ id }) => setTaskRank({ id, rank: ranks.get(id)! }), {
          discard: true,
          concurrency: 1,
        }),
      ),
      Effect.as(ranks),
    );
  };

  /**
   * New tasks go to the top, so the list reads newest first. Agent queues run
   * from the bottom, so tasks created one after another run in that order.
   */
  const prependRank = () =>
    getFirstTaskRankRow().pipe(
      Effect.flatMap((first) => {
        if (Option.isNone(first)) return Effect.succeed(encodeTaskRank(TASK_RANK_STEP));
        const candidate = taskRanksBetween(null, first.value.rank, 1)?.[0];
        if (candidate) return Effect.succeed(candidate);
        // No room above the first task: center the order in the rank space.
        return listTaskIdRows().pipe(
          Effect.flatMap((rows) =>
            rebalanceTaskRows(rows, centeredTaskRanks).pipe(
              Effect.map((ranks) => ranks.get(rows[0]!.id)!),
            ),
          ),
          Effect.flatMap((top) => {
            const rank = taskRanksBetween(null, top, 1)?.[0];
            return rank
              ? Effect.succeed(rank)
              : Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.upsert:exhausted")(
                    "Unable to allocate a task rank after rebalance",
                  ),
                );
          }),
        );
      }),
    );

  const upsert: TaskRepositoryShape["upsert"] = ({ actor, ...task }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* getById({ id: task.id });
          const rank = task.rank ?? Option.getOrUndefined(existing)?.rank ?? (yield* prependRank());
          const origin = Option.isSome(existing)
            ? {
                rootThreadId: existing.value.rootThreadId,
                parentTaskId: existing.value.parentTaskId,
                parentRunId: existing.value.parentRunId,
              }
            : yield* originForTask(task);
          const previous = Option.getOrUndefined(existing);
          const requestedNotBefore =
            task.notBefore !== undefined ? task.notBefore : (previous?.notBefore ?? null);
          // Stored as UTC so SQL range scans compare correctly.
          const notBefore =
            requestedNotBefore === null ? null : new Date(requestedNotBefore).toISOString();
          const archivedAt = previous ? previous.archivedAt : (task.archivedAt ?? null);
          const audience = task.audience ?? previous?.audience ?? "agent";
          const kind = task.kind ?? previous?.kind ?? "task";
          const invalid = taskKindAudienceError(kind, audience);
          if (invalid !== null)
            return yield* new TaskPersistenceSqlError({
              operation: "TaskRepository.upsert:kind",
              detail: invalid,
            });
          // A task handed back to a person reopens unless it is done. Person
          // statuses are checked when they are set, so an older person task
          // with another status still takes other edits.
          const becomesPerson =
            previous !== undefined && previous.audience !== "person" && audience === "person";
          const status = becomesPerson ? statusForPersonAudience(task.status) : task.status;
          const invalidStatus =
            previous === undefined || previous.status !== status
              ? personTaskStatusError(audience, status)
              : null;
          if (invalidStatus !== null)
            return yield* new TaskPersistenceSqlError({
              operation: "TaskRepository.upsert:status",
              detail: invalidStatus,
            });
          const persisted: Task = {
            ...task,
            status,
            rank,
            ...origin,
            notBefore,
            archivedAt,
            audience,
            kind,
            sourceRunId:
              Option.isNone(existing) && origin.parentRunId ? origin.parentRunId : task.sourceRunId,
            triggerChangedAt: !previous
              ? task.updatedAt
              : triggerFieldsChanged(previous, {
                    ...task,
                    status,
                    notBefore,
                    archivedAt,
                    audience,
                    kind,
                  })
                ? yield* nowIso
                : previous.triggerChangedAt,
          };
          yield* upsertTaskRow(persisted);
          if (previous)
            yield* followTask({
              taskId: task.id,
              kind: persisted.kind,
              from: { status: previous.status, archived: previous.archivedAt !== null },
              to: { status: persisted.status, archived: persisted.archivedAt !== null },
              at: persisted.updatedAt,
            });
          if (previous && previous.status !== persisted.status) {
            yield* insertHistoryEvent({
              taskId: task.id,
              kind: TASK_STATUS_CHANGED_EVENT,
              payload: {
                from: previous.status,
                to: persisted.status,
                actor: actor ?? ({ type: "server" } satisfies TaskActor),
              },
              createdAt: persisted.updatedAt,
            });
          }
          yield* writeTaskTags(task.id, task.tags);
          const saved = yield* getById({ id: task.id });
          return yield* Option.match(saved, {
            onNone: () =>
              Effect.fail(
                toTaskPersistenceSqlError("TaskRepository.upsert:reload")("Task not found"),
              ),
            onSome: Effect.succeed,
          });
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.upsert:query", "TaskRepository.upsert:decodeRows"),
        ),
      );

  const search: TaskRepositoryShape["search"] = (input: TaskSearchInput) => {
    const limit = Math.min(input.limit ?? 200, 500);
    const tags = Array.from(new Set(input.tags ?? []));
    return Effect.all([
      searchTaskRows({
        projectId: input.projectId ?? null,
        status: input.status ?? null,
        tagsJson: JSON.stringify(tags),
        tagCount: tags.length,
        archive: input.archive ?? "active",
        ...listFilters(input),
        afterRank: null,
        afterId: null,
        fromBottom: input.from === "bottom",
        limit,
      }),
      listTaskTags(),
    ]).pipe(
      Effect.mapError(
        toSqlOrDecodeError("TaskRepository.search:query", "TaskRepository.search:decodeRows"),
      ),
      Effect.map(([taskRows, tagRows]) =>
        filterTasksByTags(attachTags(taskRows, tagRows), tags).slice(0, limit),
      ),
    );
  };

  const decorateTaskRows = (rows: ReadonlyArray<typeof TaskDbRow.Type>) =>
    Effect.gen(function* () {
      const ids = JSON.stringify(rows.map(({ id }) => id));
      const tagRows = yield* sql`SELECT task_id AS "taskId", tag FROM task_tags
        WHERE task_id IN (SELECT value FROM json_each(${ids}))`;
      const counts =
        yield* sql`SELECT r.task_id AS "taskId", ${countedRunStatus} AS status, COUNT(*) AS count
        FROM task_agent_runs r WHERE r.task_id IN (SELECT value FROM json_each(${ids}))
        GROUP BY r.task_id, 2 ORDER BY 2`;
      // The latest run in the run lists' order (started_at DESC, id ASC).
      const latest = yield* sql`SELECT t.value AS "taskId", (
          SELECT r.status FROM task_agent_runs r WHERE r.task_id = t.value
          ORDER BY r.started_at DESC, r.id ASC LIMIT 1
        ) AS status
        FROM json_each(${ids}) t`;
      const decodedTags = yield* Schema.decodeUnknownEffect(Schema.Array(TaskTagDbRow))(tagRows);
      const decodedLatest = yield* decodeLatestRunRows(latest);
      const latestByTask = new Map(decodedLatest.map(({ taskId, status }) => [taskId, status]));
      const decodedCounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            taskId: TaskId,
            ...TaskRunCount.fields,
          }),
        ),
      )(counts);
      const countsByTask = new Map<TaskId, Array<typeof TaskRunCount.Type>>();
      for (const { taskId, status, count } of decodedCounts) {
        const entries = countsByTask.get(taskId) ?? [];
        entries.push({ status, count });
        countsByTask.set(taskId, entries);
      }
      return attachTags(rows, decodedTags).map((task) => ({
        ...task,
        runCounts: countsByTask.get(task.id) ?? [],
        latestRunStatus: latestByTask.get(task.id) ?? null,
      }));
    });

  const items: TaskRepositoryShape["items"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* taskRowsByIds({ idsJson: JSON.stringify(input.ids) });
          return { tasks: yield* decorateTaskRows(rows) };
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.items:query", "TaskRepository.items:decode"),
        ),
      );

  const threadTasks: TaskRepositoryShape["threadTasks"] = (input: TaskThreadTasksInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* threadTaskRows({
            threadId: input.threadId,
            limit: Math.min(input.limit ?? 50, 50),
          });
          return { tasks: yield* decorateTaskRows(rows) };
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.threadTasks:query",
            "TaskRepository.threadTasks:decode",
          ),
        ),
      );

  const page: TaskRepositoryShape["page"] = (input: TaskPageInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const limit = Math.min(input.limit ?? 100, 500);
          const tags = uniqueTags(input.tags ?? []);
          const rows = yield* searchTaskRows({
            projectId: input.projectId ?? null,
            status: input.status ?? null,
            tagsJson: JSON.stringify(tags),
            tagCount: tags.length,
            archive: input.archive ?? "active",
            ...listFilters(input),
            afterRank: input.cursor?.rank ?? null,
            afterId: input.cursor?.id ?? null,
            fromBottom: false,
            limit: limit + 1,
          });
          const visible = rows.slice(0, limit);
          const tasks = yield* decorateTaskRows(visible);
          // Status facets follow the project, archive, audience and kind filters
          // only, never the selected or excluded statuses or the page cursor.
          const filters = listFilters(input);
          const statuses = yield* sql<{ status: string }>`SELECT DISTINCT status FROM tasks
        WHERE (${input.projectId ?? null} IS NULL OR project_id = ${input.projectId ?? null})
          AND ${archiveCondition(input.archive ?? "active")}
          AND ${membershipCondition(filters.audience, filters.kind)}
        ORDER BY status`;
          const last = visible.at(-1);
          return {
            tasks,
            nextCursor: rows.length > limit && last ? { rank: last.rank, id: last.id } : null,
            statuses: statuses.map(({ status }) => status),
          };
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.page:query", "TaskRepository.page:decode"),
        ),
      );

  const listAllTasks: TaskRepositoryShape["listAllTasks"] = () =>
    Effect.all([listAllTaskRows(), listTaskTags()]).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listAllTasks:query",
          "TaskRepository.listAllTasks:decodeRows",
        ),
      ),
      Effect.map(([taskRows, tagRows]) => attachTags(taskRows, tagRows)),
    );

  const listTriggerCandidates: TaskRepositoryShape["listTriggerCandidates"] = () =>
    Effect.gen(function* () {
      const rows = yield* triggerCandidateRows();
      const tagRows = yield* sql`SELECT task_id AS "taskId", tag FROM task_tags
        WHERE task_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map(({ id }) => id))}))
        ORDER BY task_id ASC, tag ASC`;
      return attachTags(rows, yield* decodeTaskTagRows(tagRows));
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listTriggerCandidates:query",
          "TaskRepository.listTriggerCandidates:decodeRows",
        ),
      ),
    );

  const update: TaskRepositoryShape["update"] = (input) =>
    getById({ id: input.id }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(toTaskPersistenceSqlError("TaskRepository.update:get")("Task not found")),
          onSome: (existing) =>
            nowIso.pipe(
              Effect.flatMap((updatedAt) => {
                const next = {
                  ...existing,
                  ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
                  ...(input.audience !== undefined ? { audience: input.audience } : {}),
                  ...(input.kind !== undefined ? { kind: input.kind } : {}),
                  ...(input.title !== undefined ? { title: input.title } : {}),
                  ...(input.description !== undefined ? { description: input.description } : {}),
                  ...(input.output !== undefined ? { output: input.output } : {}),
                  ...(input.status !== undefined ? { status: input.status } : {}),
                  ...(input.priority !== undefined ? { priority: input.priority } : {}),
                  ...(input.assigneeAgentRunId !== undefined
                    ? { assigneeAgentRunId: input.assigneeAgentRunId }
                    : {}),
                  ...(input.sourceThreadId !== undefined
                    ? { sourceThreadId: input.sourceThreadId }
                    : {}),
                  ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
                  ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
                  ...(input.tags !== undefined ? { tags: input.tags } : {}),
                  ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
                  updatedAt,
                } satisfies Task;
                return upsert({ ...next, actor: input.actor });
              }),
            ),
        }),
      ),
    );

  const setArchived = (input: SetTasksArchivedInput) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const timestamp = yield* nowIso;
          const results: Array<SetTasksArchivedResult[number]> = [];
          for (const id of input.ids) {
            const existing = yield* getById({ id });
            if (Option.isNone(existing)) {
              results.push({ id, outcome: "not-found", task: null });
              continue;
            }
            if ((existing.value.archivedAt !== null) === input.archived) {
              results.push({
                id,
                outcome: input.archived ? "already-archived" : "not-archived",
                task: null,
              });
              continue;
            }
            // Archiving is a trigger change, as closing was: an agent
            // whose triggers match may run again after an unarchive.
            yield* sql`
              UPDATE tasks
              SET archived_at = ${input.archived ? timestamp : null},
                updated_at = ${timestamp},
                trigger_changed_at = ${timestamp}
              WHERE id = ${id}
            `;
            yield* followTask({
              taskId: id,
              kind: existing.value.kind,
              from: { status: existing.value.status, archived: existing.value.archivedAt !== null },
              to: { status: existing.value.status, archived: input.archived },
              at: timestamp,
            });
            yield* insertHistoryEvent({
              taskId: id,
              kind: input.archived ? TASK_ARCHIVED_EVENT : TASK_UNARCHIVED_EVENT,
              payload: {
                actor: input.actor,
                ...(input.reason !== undefined ? { reason: input.reason } : {}),
              },
              createdAt: timestamp,
            });
            results.push({
              id,
              outcome: input.archived ? "archived" : "unarchived",
              task: Option.getOrNull(yield* getById({ id })),
            });
          }
          return results;
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.setArchived:query",
            "TaskRepository.setArchived:decodeRows",
          ),
        ),
      );

  const taskEventRows = SqlSchema.findAll({
    Request: Schema.Struct({
      taskId: TaskId,
      kindsJson: Schema.NullOr(Schema.String),
      limit: Schema.Number,
    }),
    Result: TaskEventDbRow,
    execute: ({ taskId, kindsJson, limit }) => sql`
      SELECT id, task_id AS "taskId", kind, payload_json AS "payload", created_at AS "createdAt"
      FROM task_events
      WHERE task_id = ${taskId}
        AND (${kindsJson} IS NULL OR kind IN (SELECT value FROM json_each(${kindsJson})))
      ORDER BY created_at DESC, rowid DESC
      LIMIT ${limit}
    `,
  });

  const listTaskEvents: TaskRepositoryShape["events"] = (input) =>
    taskEventRows({
      taskId: input.taskId,
      kindsJson: input.kinds === undefined ? null : JSON.stringify(input.kinds),
      limit: Math.min(input.limit ?? 50, 200),
    }).pipe(
      Effect.map((rows) => ({ events: rows })),
      Effect.mapError(
        toSqlOrDecodeError("TaskRepository.events:query", "TaskRepository.events:decodeRows"),
      ),
    );

  const reorder: TaskRepositoryShape["reorder"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* getById({ id: input.id });
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              toTaskPersistenceSqlError("TaskRepository.reorder:get")("Task not found"),
            );
          }
          if (input.beforeTaskId === input.id || input.afterTaskId === input.id) {
            return yield* Effect.fail(
              toTaskPersistenceSqlError("TaskRepository.reorder:neighbors")(
                "A task cannot be its own reorder neighbor",
              ),
            );
          }

          const resolveInsertion = (rows: ReadonlyArray<Task>) => {
            const ordered = rows.filter(({ id }) => id !== input.id);
            const beforeIndex =
              input.beforeTaskId === undefined
                ? -1
                : ordered.findIndex(({ id }) => id === input.beforeTaskId);
            const afterIndex =
              input.afterTaskId === undefined
                ? -1
                : ordered.findIndex(({ id }) => id === input.afterTaskId);
            if (
              (input.beforeTaskId !== undefined && beforeIndex < 0) ||
              (input.afterTaskId !== undefined && afterIndex < 0) ||
              (beforeIndex >= 0 && afterIndex >= beforeIndex)
            )
              return null;
            const index = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : 0;
            return {
              lower: ordered[index - 1]?.rank ?? null,
              upper: ordered[index]?.rank ?? null,
            };
          };

          let rows = yield* listAllTasks();
          let insertion = resolveInsertion(rows);
          if (!insertion) {
            return yield* Effect.fail(
              toTaskPersistenceSqlError("TaskRepository.reorder:neighbors")(
                "Reorder neighbors must exist and appear in after/before order",
              ),
            );
          }
          let rank = taskRankBetween(insertion.lower, insertion.upper);
          if (rank === null) {
            yield* rebalanceTaskRows(rows);
            rows = yield* listAllTasks();
            insertion = resolveInsertion(rows);
            if (!insertion) {
              return yield* Effect.fail(
                toTaskPersistenceSqlError("TaskRepository.reorder:neighbors")(
                  "Reorder neighbors changed during rebalance",
                ),
              );
            }
            rank = taskRankBetween(insertion.lower, insertion.upper);
          }
          if (rank === null) {
            return yield* Effect.fail(
              toTaskPersistenceSqlError("TaskRepository.reorder:exhausted")(
                "Unable to allocate a task rank after rebalance",
              ),
            );
          }
          yield* setTaskRank({ id: input.id, rank });
          const saved = yield* getById({ id: input.id });
          return yield* Option.match(saved, {
            onNone: () =>
              Effect.fail(
                toTaskPersistenceSqlError("TaskRepository.reorder:reload")("Task not found"),
              ),
            onSome: Effect.succeed,
          });
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.reorder:query", "TaskRepository.reorder:decodeRows"),
        ),
      );

  const reorderFailure = (detail: string) =>
    new TaskPersistenceSqlError({ operation: "TaskRepository.reorderMany", detail });

  const reorderMany: TaskRepositoryShape["reorderMany"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const moving = new Set(input.ids);
          if (
            (input.beforeTaskId !== undefined && moving.has(input.beforeTaskId)) ||
            (input.afterTaskId !== undefined && moving.has(input.afterTaskId))
          )
            return yield* reorderFailure("A moved task cannot be the block's neighbor");
          const all = yield* listTaskIdRows();
          const block = all.filter(({ id }) => moving.has(id)).map(({ id }) => id);
          if (block.length !== moving.size)
            return yield* reorderFailure("Every moved task must exist");
          const others = all.filter(({ id }) => !moving.has(id)).map(({ id }) => id);
          const beforeIndex =
            input.beforeTaskId === undefined ? -1 : others.indexOf(input.beforeTaskId);
          const afterIndex =
            input.afterTaskId === undefined ? -1 : others.indexOf(input.afterTaskId);
          if (
            (input.beforeTaskId !== undefined && beforeIndex < 0) ||
            (input.afterTaskId !== undefined && afterIndex < 0) ||
            (beforeIndex >= 0 && afterIndex >= beforeIndex)
          )
            return yield* reorderFailure(
              "Reorder neighbors must exist and appear in after/before order",
            );
          const index = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : 0;
          const rankOf = new Map(all.map(({ id, rank }) => [id, rank]));
          const lower = index > 0 ? rankOf.get(others[index - 1]!)! : null;
          const upper = index < others.length ? rankOf.get(others[index]!)! : null;
          const ranks = taskRanksBetween(lower, upper, block.length);
          if (ranks === null) {
            const ordered = [...others.slice(0, index), ...block, ...others.slice(index)];
            yield* rebalanceTaskRows(ordered.map((id) => ({ id })));
          } else {
            // Moved tasks give up their ranks first, so a new rank cannot hit one not yet moved.
            yield* sql`UPDATE tasks SET rank = NULL
              WHERE id IN (SELECT value FROM json_each(${JSON.stringify(block)}))`;
            yield* Effect.forEach(block, (id, at) => setTaskRank({ id, rank: ranks[at]! }), {
              discard: true,
              concurrency: 1,
            });
          }
          const saved = yield* Effect.forEach(block, (id) => getById({ id }), { concurrency: 1 });
          return saved.flatMap((task) => (Option.isSome(task) ? [task.value] : []));
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.reorderMany:query",
            "TaskRepository.reorderMany:decodeRows",
          ),
        ),
      );

  /** Returns the dates whose entries went with the task. */
  const deleteTask = (input: Parameters<TaskRepositoryShape["deleteTask"]>[0]) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const dates = yield* schedule.datesForTask(input.id);
          yield* deleteTaskTags({ taskId: input.id });
          yield* schedule.deleteForTask(input.id);
          yield* deleteTaskRow(input);
          return dates;
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.deleteTask:query",
            "TaskRepository.deleteTask:decodeRows",
          ),
        ),
      );

  const replaceTags: TaskRepositoryShape["replaceTags"] = (input) =>
    getById({ id: input.taskId }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              toTaskPersistenceSqlError("TaskRepository.replaceTags:get")("Task not found"),
            ),
          onSome: (existing) => upsert({ ...existing, tags: input.tags }),
        }),
      ),
    );

  const addTag: TaskRepositoryShape["addTag"] = (input) =>
    sql
      .withTransaction(
        markTagTriggerChange({ ...input, present: false, changedAt: input.updatedAt }).pipe(
          Effect.andThen(insertTaskTag({ taskId: input.taskId, tag: input.tag })),
          Effect.andThen(touchTask({ taskId: input.taskId, updatedAt: input.updatedAt })),
          Effect.andThen(getById({ id: input.taskId })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.addTag:get")("Task not found"),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError("TaskRepository.addTag:query", "TaskRepository.addTag:decodeRows"),
        ),
      );

  const removeTag: TaskRepositoryShape["removeTag"] = (input) =>
    sql
      .withTransaction(
        markTagTriggerChange({ ...input, present: true, changedAt: input.updatedAt }).pipe(
          Effect.andThen(removeTaskTag({ taskId: input.taskId, tag: input.tag })),
          Effect.andThen(touchTask({ taskId: input.taskId, updatedAt: input.updatedAt })),
          Effect.andThen(getById({ id: input.taskId })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.removeTag:get")("Task not found"),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.removeTag:query",
            "TaskRepository.removeTag:decodeRows",
          ),
        ),
      );

  /** Runs one schedule write in a transaction and publishes its dates and tasks once. */
  const withScheduleChanges = <A>(
    operation: string,
    effect: Effect.Effect<
      {
        readonly result: A;
        readonly dates: ReadonlyArray<string>;
        readonly taskIds: ReadonlyArray<TaskId>;
      },
      unknown
    >,
  ) =>
    sql.withTransaction(effect).pipe(
      Effect.tap(({ dates, taskIds }) =>
        Effect.gen(function* () {
          if (dates.length === 0) return;
          const event: PendingTaskChange = {
            taskIds: [...new Set(taskIds)],
            listChanged: false,
            runsChanged: false,
            rootThreadIds: [],
            scheduleDates: [...new Set(dates)].toSorted(),
          };
          const batch = yield* TaskChangeBatch;
          if (batch?.owner === events) batch.events.push(event);
          else yield* publishChange(event);
        }),
      ),
      Effect.map(({ result }) => result),
      Effect.mapError(toSqlOrDecodeError(`${operation}:query`, `${operation}:decodeRows`)),
      Effect.uninterruptible,
    );

  const scheduleEntries: TaskRepositoryShape["scheduleEntries"] = (filter) =>
    ("ids" in filter
      ? schedule.byIds({ idsJson: JSON.stringify(filter.ids) })
      : schedule.onDates({ datesJson: JSON.stringify(filter.dates) })
    ).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.scheduleEntries:query",
          "TaskRepository.scheduleEntries:decodeRows",
        ),
      ),
    );

  const scheduleRange: TaskRepositoryShape["scheduleRange"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const entries = yield* schedule.inRange(input);
          const taskIds = JSON.stringify([...new Set(entries.map(({ taskId }) => taskId))]);
          const rows = yield* decodeTaskRows(
            yield* sql`SELECT ${TASK_COLUMNS} FROM tasks
              WHERE id IN (SELECT value FROM json_each(${taskIds})) ORDER BY rank ASC, id ASC`,
          );
          return { entries, tasks: yield* decorateTaskRows(rows) };
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.scheduleRange:query",
            "TaskRepository.scheduleRange:decodeRows",
          ),
        ),
      );

  const scheduleForTask: TaskRepositoryShape["scheduleForTask"] = (input) => {
    const limit = Math.min(input.limit ?? 100, 500);
    return schedule
      .forTask({ taskId: input.taskId, cursor: input.cursor ?? null, limit: limit + 1 })
      .pipe(
        Effect.map((rows) => {
          const entries = rows.slice(0, limit);
          const last = entries.at(-1);
          return {
            entries,
            nextCursor:
              rows.length > limit && last
                ? { date: last.date, startTime: last.startTime, position: last.position }
                : null,
          };
        }),
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.scheduleForTask:query",
            "TaskRepository.scheduleForTask:decodeRows",
          ),
        ),
      );
  };

  const scheduleProgress: TaskRepositoryShape["scheduleProgress"] = (input) => {
    const taskIds = [...new Set(input.taskIds)];
    return schedule
      .progress({
        taskIdsJson: JSON.stringify(taskIds),
        from: input.from ?? null,
        to: input.to ?? null,
      })
      .pipe(
        Effect.map((rows) => {
          const byTask = new Map(rows.map((row) => [row.taskId, row]));
          return {
            progress: taskIds.map(
              (taskId) => byTask.get(taskId) ?? { taskId, total: 0, handled: 0 },
            ),
          };
        }),
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.scheduleProgress:query",
            "TaskRepository.scheduleProgress:decodeRows",
          ),
        ),
      );
  };

  const readScheduleSettings = schedule.settings().pipe(
    Effect.map(([row]): TaskScheduleSettings => ({
      scheduleTimeZone: row?.scheduleTimeZone ?? null,
      serverTimeZone: serverTimeZone(),
      remindersEnabled: (row?.remindersEnabled ?? 1) === 1,
      reminderLeadMinutes: row?.reminderLeadMinutes ?? DEFAULT_TASK_REMINDER_LEAD_MINUTES,
    })),
  );
  const reminderSettingsOf = (settings: TaskScheduleSettings): ReminderSettings => ({
    timeZone: settings.scheduleTimeZone ?? settings.serverTimeZone,
    enabled: settings.remindersEnabled,
    leadMinutes: settings.reminderLeadMinutes,
  });
  const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

  /** When the task last became Done, from its history. */
  const lastDoneAt = (taskId: TaskId) =>
    sql<{ createdAt: string }>`SELECT created_at AS "createdAt" FROM task_events
      WHERE task_id = ${taskId} AND kind = ${TASK_STATUS_CHANGED_EVENT}
        AND json_extract(payload_json, '$.to') = ${PERSON_DONE_STATUS}
      ORDER BY created_at DESC, rowid DESC LIMIT 1`.pipe(
      Effect.map((rows) => rows[0]?.createdAt ?? null),
    );

  /**
   * Moves a regular task's entries with a change of its state, inside the
   * write that made it, whoever wrote it (`followTaskState`, doc 5.3). The
   * dates go out with that write's change. Routines are planned day by day
   * and keep their entries.
   */
  const followTask = (input: {
    readonly taskId: TaskId;
    readonly kind: TaskKind;
    readonly from: FollowedTaskState;
    readonly to: FollowedTaskState;
    readonly at: string;
  }) =>
    Effect.gen(function* () {
      if (input.kind === "routine" || !movesEntries(input.from, input.to)) return;
      const entries = yield* schedule.allForTask(input.taskId);
      if (entries.length === 0) return;
      const settings = reminderSettingsOf(yield* readScheduleSettings);
      const now = yield* DateTime.now;
      // Today as the schedule's zone sees it, as for reminders.
      const today = Option.match(DateTime.makeZoned(now, { timeZone: settings.timeZone }), {
        onNone: () => DateTime.formatIsoDateUtc(now),
        onSome: DateTime.formatIsoDate,
      });
      const doneAt = reopensTask(input.from, input.to) ? yield* lastDoneAt(input.taskId) : null;
      const { updated, deleted } = followTaskState({
        entries,
        from: input.from,
        to: input.to,
        today,
        at: input.at,
        doneAt,
      });
      const millis = DateTime.toEpochMillis(now);
      yield* Effect.forEach(
        updated,
        (entry) => schedule.upsert({ ...entry, remindAt: reminderAt(entry, settings, millis) }),
        { discard: true, concurrency: 1 },
      );
      if (deleted.length > 0) yield* schedule.deleteByIds(deleted.map(({ id }) => id));
      (yield* FollowedScheduleDates)?.push(...[...updated, ...deleted].map(({ date }) => date));
    });

  /**
   * Recomputes the reminder of every entry the settings or the passing time
   * can change. Entries more than a day before today (in any zone) have
   * started and keep what they have.
   */
  const recomputeRemindersWith = (settings: ReminderSettings) =>
    Effect.gen(function* () {
      const now = yield* nowMillis;
      const fromDate = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
      const rows = yield* schedule.reminderCandidates({ fromDate });
      yield* Effect.forEach(
        rows,
        (row) => {
          const next = reminderAt(row, settings, now);
          return next === row.remindAt ? Effect.void : schedule.setRemindAt(row.id, next);
        },
        { discard: true, concurrency: 1 },
      );
    });

  const scheduleSettings: TaskRepositoryShape["scheduleSettings"] = () =>
    readScheduleSettings.pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.scheduleSettings:query",
          "TaskRepository.scheduleSettings:decodeRows",
        ),
      ),
    );

  const updateScheduleSettings: TaskRepositoryShape["updateScheduleSettings"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* readScheduleSettings;
          const next: TaskScheduleSettings = {
            ...current,
            ...(input.scheduleTimeZone !== undefined
              ? { scheduleTimeZone: input.scheduleTimeZone }
              : {}),
            ...(input.remindersEnabled !== undefined
              ? { remindersEnabled: input.remindersEnabled }
              : {}),
            ...(input.reminderLeadMinutes !== undefined
              ? { reminderLeadMinutes: input.reminderLeadMinutes }
              : {}),
          };
          yield* schedule.updateSettings(next);
          yield* recomputeRemindersWith(reminderSettingsOf(next));
          return next;
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.updateScheduleSettings:query",
            "TaskRepository.updateScheduleSettings:decodeRows",
          ),
        ),
      );

  const recomputeReminders: TaskRepositoryShape["recomputeReminders"] = () =>
    sql
      .withTransaction(
        Effect.flatMap(readScheduleSettings, (settings) =>
          recomputeRemindersWith(reminderSettingsOf(settings)),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.recomputeReminders:query",
            "TaskRepository.recomputeReminders:decodeRows",
          ),
        ),
      );

  const claimDueReminders: TaskRepositoryShape["claimDueReminders"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const nowIso = DateTime.formatIso(now);
          const due = yield* schedule.dueReminders({ now: nowIso, limit: input.limit });
          if (due.length === 0) return [];
          const settings = reminderSettingsOf(yield* readScheduleSettings);
          yield* schedule.markReminded(
            due.map(({ entryId }) => entryId),
            nowIso,
          );
          // Claimed either way; only an open entry of a live task that has not
          // started yet is worth a reminder (wande drops the others as stale).
          return due.flatMap((row): TaskReminder[] => {
            if (row.status !== "open" || row.startTime === null || row.title === null) return [];
            if (row.taskStatus === PERSON_DONE_STATUS || row.archivedAt !== null) return [];
            const startsAt = scheduledInstant(row.date, row.startTime, settings.timeZone);
            if (startsAt === null || startsAt <= DateTime.toEpochMillis(now)) return [];
            return [
              {
                entryId: row.entryId,
                taskId: row.taskId,
                title: row.title,
                date: row.date,
                startTime: row.startTime,
              },
            ];
          });
        }),
      )
      .pipe(
        Effect.tap((reminders) =>
          reminders.length === 0
            ? Effect.void
            : publishChange({
                taskIds: [],
                listChanged: false,
                runsChanged: false,
                rootThreadIds: [],
                reminders,
              }),
        ),
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.claimDueReminders:query",
            "TaskRepository.claimDueReminders:decodeRows",
          ),
        ),
        Effect.uninterruptible,
      );

  const putScheduleEntries: TaskRepositoryShape["putScheduleEntries"] = (entries) =>
    withScheduleChanges(
      "TaskRepository.putScheduleEntries",
      Effect.gen(function* () {
        const ids = entries.map(({ id }) => id);
        const before =
          ids.length === 0 ? [] : yield* schedule.byIds({ idsJson: JSON.stringify(ids) });
        yield* schedule.releasePositions(before.map(({ id }) => id));
        const reminders = reminderSettingsOf(yield* readScheduleSettings);
        const now = yield* nowMillis;
        yield* Effect.forEach(
          entries,
          (entry) => schedule.upsert({ ...entry, remindAt: reminderAt(entry, reminders, now) }),
          { discard: true, concurrency: 1 },
        );
        const changed: ReadonlyArray<TaskScheduleEntry> = [...before, ...entries];
        return {
          result: entries,
          dates: changed.map(({ date }) => date),
          taskIds: changed.map(({ taskId }) => taskId),
        };
      }),
    );

  const deleteScheduleEntries: TaskRepositoryShape["deleteScheduleEntries"] = (ids) =>
    withScheduleChanges(
      "TaskRepository.deleteScheduleEntries",
      Effect.gen(function* () {
        const removed =
          ids.length === 0 ? [] : yield* schedule.byIds({ idsJson: JSON.stringify(ids) });
        yield* schedule.deleteByIds(removed.map(({ id }) => id));
        return {
          result: removed,
          dates: removed.map(({ date }) => date),
          taskIds: removed.map(({ taskId }) => taskId),
        };
      }),
    );

  const appendEvent: TaskRepositoryShape["appendEvent"] = (input) =>
    sql
      .withTransaction(
        insertTaskEvent(input).pipe(
          Effect.andThen(getTaskEventRow({ id: input.id })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.appendEvent:reload")("Event not found"),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.appendEvent:query",
            "TaskRepository.appendEvent:decodeRows",
          ),
        ),
      );

  const getAgentById: TaskRepositoryShape["getAgentById"] = (input) =>
    getAgentRow(input).pipe(
      Effect.map(Option.map(mapAgentRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.getAgentById:query",
          "TaskRepository.getAgentById:decodeRows",
        ),
      ),
    );

  // Agents change no task, so this change names none; it tells clients to refetch bots.
  const agentsChanged = Effect.gen(function* () {
    const event: PendingTaskChange = {
      taskIds: [],
      rootThreadIds: [],
      listChanged: false,
      runsChanged: false,
      agentsChanged: true,
    };
    const batch = yield* TaskChangeBatch;
    if (batch?.owner === events) batch.events.push(event);
    else yield* publishChange(event);
  });

  const upsertAgent: TaskRepositoryShape["upsertAgent"] = (input) =>
    sql
      .withTransaction(
        upsertAgentRow(input).pipe(
          Effect.andThen(getAgentById({ id: input.id })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.upsertAgent:reload")("Agent not found"),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.upsertAgent:query",
            "TaskRepository.upsertAgent:decodeRows",
          ),
        ),
        Effect.tap(() => agentsChanged),
      );

  const searchAgents: TaskRepositoryShape["searchAgents"] = (input) => {
    const limit = Math.min(input.limit ?? 200, 500);
    return searchAgentRows({
      projectId: input.projectId ?? null,
      enabled: input.enabled === undefined ? null : input.enabled ? 1 : 0,
      limit,
    }).pipe(
      Effect.map((rows) => rows.map(mapAgentRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.searchAgents:query",
          "TaskRepository.searchAgents:decodeRows",
        ),
      ),
    );
  };

  const listAllAgents: TaskRepositoryShape["listAllAgents"] = () =>
    listAllAgentRows().pipe(
      Effect.map((rows) => rows.map(mapAgentRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listAllAgents:query",
          "TaskRepository.listAllAgents:decodeRows",
        ),
      ),
    );

  const deleteAgent: TaskRepositoryShape["deleteAgent"] = (input) =>
    deleteAgentRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.deleteAgent:query",
          "TaskRepository.deleteAgent:decodeRows",
        ),
      ),
      Effect.tap(() => agentsChanged),
    );

  const getAgentRunById: TaskRepositoryShape["getAgentRunById"] = (input) =>
    getAgentRunRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.getAgentRunById:query",
          "TaskRepository.getAgentRunById:decodeRows",
        ),
      ),
    );

  const createAgentRun: TaskRepositoryShape["createAgentRun"] = (input) =>
    sql
      .withTransaction(
        insertAgentRun(input).pipe(
          Effect.andThen(getAgentRunById({ id: input.id })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.createAgentRun:reload")(
                    "Agent run not found",
                  ),
                ),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.createAgentRun:query",
            "TaskRepository.createAgentRun:decodeRows",
          ),
        ),
      );

  const startAgentRun: TaskRepositoryShape["startAgentRun"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const inserted = yield* startAgentRunRow(input);
          if (inserted.length === 0) return Option.none<TaskAgentRun>();
          // The run holds its task from the start, unless another active run
          // holds it; the agent does not spend a turn claiming it.
          yield* sql`
            UPDATE tasks
            SET assignee_worker_id = ${input.id},
              updated_at = ${input.startedAt}
            WHERE id = ${input.taskId}
              AND (assignee_worker_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM task_agent_runs
                WHERE id = tasks.assignee_worker_id
                  AND completed_at IS NULL
              ))
          `;
          return yield* getAgentRunById({ id: input.id });
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.startAgentRun:query",
            "TaskRepository.startAgentRun:decodeRows",
          ),
        ),
      );

  const findActiveAgentRunForTaskAgent: TaskRepositoryShape["findActiveAgentRunForTaskAgent"] = (
    input,
  ) =>
    findActiveAgentRunRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.findActiveAgentRunForTaskAgent:query",
          "TaskRepository.findActiveAgentRunForTaskAgent:decodeRows",
        ),
      ),
    );

  const findActiveAgentRunByThreadId: TaskRepositoryShape["findActiveAgentRunByThreadId"] = (
    input,
  ) =>
    findActiveAgentRunByThreadRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.findActiveAgentRunByThreadId:query",
          "TaskRepository.findActiveAgentRunByThreadId:decodeRows",
        ),
      ),
    );

  const findLatestAgentRunByThreadId: TaskRepositoryShape["findLatestAgentRunByThreadId"] = (
    input,
  ) =>
    findLatestAgentRunByThreadRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.findLatestAgentRunByThreadId:query",
          "TaskRepository.findLatestAgentRunByThreadId:decodeRows",
        ),
      ),
    );

  const listActiveAgentRunsForTask: TaskRepositoryShape["listActiveAgentRunsForTask"] = (input) =>
    listActiveAgentRunRowsForTask(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listActiveAgentRunsForTask:query",
          "TaskRepository.listActiveAgentRunsForTask:decodeRows",
        ),
      ),
    );

  const listAllActiveAgentRuns: TaskRepositoryShape["listAllActiveAgentRuns"] = () =>
    listAllActiveAgentRunRows().pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listAllActiveAgentRuns:query",
          "TaskRepository.listAllActiveAgentRuns:decodeRows",
        ),
      ),
    );

  const claimAgentRunFinalization: TaskRepositoryShape["claimAgentRunFinalization"] = (input) =>
    claimAgentRunFinalizationRow(input).pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.claimAgentRunFinalization:query",
          "TaskRepository.claimAgentRunFinalization:decodeResult",
        ),
      ),
    );

  const finalizeAgentRun: TaskRepositoryShape["finalizeAgentRun"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const completed = yield* completeOwnedAgentRunRow({
            id: input.id,
            finalizingStatus: input.finalizingStatus,
            status: input.status,
            completedAt: input.completedAt,
          });
          if (completed.length === 0) return false;

          const statusBefore =
            input.taskStatus === undefined
              ? []
              : yield* sql<{
                  status: string;
                  kind: TaskKind;
                  audience: TaskAudience;
                  archivedAt: string | null;
                }>`SELECT status, kind, audience, archived_at AS "archivedAt" FROM tasks
                  WHERE id = ${input.taskId}`;
          // A run's status is an agent status: a task a person took back meanwhile keeps its own.
          const taskStatus =
            input.taskStatus !== undefined &&
            statusBefore[0] !== undefined &&
            personTaskStatusError(statusBefore[0].audience, input.taskStatus) !== null
              ? undefined
              : input.taskStatus;
          if (
            taskStatus !== undefined ||
            input.taskOutput !== undefined ||
            input.releaseAssignment
          ) {
            yield* sql`
            UPDATE tasks
            SET status = CASE
                  WHEN ${taskStatus ?? null} IS NULL THEN status
                  ELSE ${taskStatus ?? null}
                END,
              output = CASE
                WHEN ${input.taskOutput === undefined ? 0 : 1} = 0 THEN output
                ELSE ${input.taskOutput ?? null}
              END,
              assignee_worker_id = CASE
                WHEN ${input.releaseAssignment ? 1 : 0} = 1
                  AND assignee_worker_id = ${input.id}
                  THEN NULL
                ELSE assignee_worker_id
              END,
              trigger_changed_at = CASE
                WHEN ${taskStatus ?? null} IS NOT NULL AND ${taskStatus ?? null} <> status
                  THEN ${input.completedAt}
                ELSE trigger_changed_at
              END,
              updated_at = ${input.completedAt}
            WHERE id = ${input.taskId}
          `;
          }
          const before = statusBefore[0];
          const from = before?.status;
          if (before !== undefined && taskStatus !== undefined) {
            const archived = before.archivedAt !== null;
            yield* followTask({
              taskId: input.taskId,
              kind: before.kind,
              from: { status: before.status, archived },
              to: { status: taskStatus, archived },
              at: input.completedAt,
            });
          }
          if (from !== undefined && taskStatus !== undefined && from !== taskStatus) {
            yield* insertHistoryEvent({
              id: `${input.id}:task-status-changed`,
              taskId: input.taskId,
              kind: TASK_STATUS_CHANGED_EVENT,
              payload: {
                from,
                to: taskStatus,
                actor: { type: "agent-run", agentRunId: input.id } satisfies TaskActor,
              },
              createdAt: input.completedAt,
            });
          }
          yield* Effect.forEach(input.events, insertTaskEvent, {
            discard: true,
            concurrency: 1,
          });
          return true;
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.finalizeAgentRun:query",
            "TaskRepository.finalizeAgentRun:decodeResult",
          ),
        ),
      );

  const searchAgentRuns: TaskRepositoryShape["searchAgentRuns"] = (input) => {
    const limit = Math.min(input.limit ?? 200, 500);
    return searchAgentRunRows({
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      status: input.status ?? null,
      activeOnly: input.activeOnly ?? false,
      afterStartedAt: input.cursor?.startedAt ?? null,
      afterId: input.cursor?.id ?? null,
      limit,
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.searchAgentRuns:query",
          "TaskRepository.searchAgentRuns:decodeRows",
        ),
      ),
    );
  };

  const findRunStatusTriggers: TaskRepositoryShape["findRunStatusTriggers"] = (input) =>
    runStatusTriggerRows({
      taskId: input.taskId,
      agentId: input.agentId,
      statusesJson: JSON.stringify(input.statuses),
      completedAfter: input.completedAfter,
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.findRunStatusTriggers:query",
          "TaskRepository.findRunStatusTriggers:decodeRows",
        ),
      ),
    );

  const listTasksReachingNotBefore: TaskRepositoryShape["listTasksReachingNotBefore"] = (input) =>
    notBeforeTaskIdRows(input).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, ({ id }) => getById({ id }), { concurrency: 1 }),
      ),
      Effect.map((tasks) => tasks.flatMap((task) => (Option.isSome(task) ? [task.value] : []))),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listTasksReachingNotBefore:query",
          "TaskRepository.listTasksReachingNotBefore:decodeRows",
        ),
      ),
    );

  const rebalanceAutomationRows = (rows: ReadonlyArray<{ readonly id: TaskAutomationId }>) => {
    const ranks = rebalancedTaskRanks(rows.map(({ id }) => id));
    return sql`UPDATE task_automations SET rank = NULL`.pipe(
      Effect.andThen(
        Effect.forEach(rows, ({ id }) => setAutomationRank({ id, rank: ranks.get(id)! }), {
          discard: true,
          concurrency: 1,
        }),
      ),
    );
  };

  /** The automations in order, every one ranked (unranked rows are ranked first). */
  const rankedAutomationRows = () =>
    listAutomationRankRows().pipe(
      Effect.flatMap((rows) =>
        rows.some(({ rank }) => rank === null)
          ? rebalanceAutomationRows(rows).pipe(Effect.andThen(listAutomationRankRows()))
          : Effect.succeed(rows),
      ),
      Effect.map((rows) => rows.map(({ id, rank }) => ({ id, rank: rank ?? "" }))),
    );

  /** A new automation goes first, as a new task does. */
  const prependAutomationRank = () =>
    rankedAutomationRows().pipe(
      Effect.flatMap((rows) => {
        const first = rows[0];
        if (first === undefined) return Effect.succeed(encodeTaskRank(TASK_RANK_STEP));
        const candidate = taskRankBetween(null, first.rank);
        if (candidate) return Effect.succeed(candidate);
        return rebalanceAutomationRows(rows).pipe(Effect.as(encodeTaskRank(TASK_RANK_STEP / 2n)));
      }),
    );

  /** The stored rank of an existing automation, or a new first one. */
  const automationRankFor = (input: PersistTaskAutomationInput) =>
    getAutomationRow({ id: input.id }).pipe(
      Effect.flatMap((existing) => {
        const rank = Option.getOrUndefined(existing)?.rank;
        return rank ? Effect.succeed(rank) : prependAutomationRank();
      }),
    );

  const reorderAutomation: TaskRepositoryShape["reorderAutomation"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const fail = (detail: string) =>
            Effect.fail(toTaskPersistenceSqlError("TaskRepository.reorderAutomation")(detail));
          if (input.beforeAutomationId === input.id || input.afterAutomationId === input.id)
            return yield* fail("An automation cannot be its own reorder neighbor");
          const resolveInsertion = (
            rows: ReadonlyArray<{ id: TaskAutomationId; rank: string }>,
          ) => {
            if (!rows.some(({ id }) => id === input.id)) return null;
            const ordered = rows.filter(({ id }) => id !== input.id);
            const beforeIndex =
              input.beforeAutomationId === undefined
                ? -1
                : ordered.findIndex(({ id }) => id === input.beforeAutomationId);
            const afterIndex =
              input.afterAutomationId === undefined
                ? -1
                : ordered.findIndex(({ id }) => id === input.afterAutomationId);
            if (
              (input.beforeAutomationId !== undefined && beforeIndex < 0) ||
              (input.afterAutomationId !== undefined && afterIndex < 0) ||
              (beforeIndex >= 0 && afterIndex >= beforeIndex)
            )
              return null;
            const index = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : 0;
            return {
              lower: ordered[index - 1]?.rank ?? null,
              upper: ordered[index]?.rank ?? null,
            };
          };
          let rows = yield* rankedAutomationRows();
          let insertion = resolveInsertion(rows);
          if (!insertion)
            return yield* fail(
              "The automation and its neighbors must exist, in after/before order",
            );
          let rank = taskRankBetween(insertion.lower, insertion.upper);
          if (rank === null) {
            yield* rebalanceAutomationRows(rows);
            rows = yield* rankedAutomationRows();
            insertion = resolveInsertion(rows);
            rank = insertion ? taskRankBetween(insertion.lower, insertion.upper) : null;
          }
          if (rank === null) return yield* fail("Unable to allocate an automation rank");
          yield* setAutomationRank({ id: input.id, rank });
          const saved = yield* getAutomationRow({ id: input.id });
          return yield* Option.match(saved, {
            onNone: () => fail("Automation not found"),
            onSome: (row) => Effect.succeed(mapAutomationRow(row)),
          });
        }),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.reorderAutomation:query",
            "TaskRepository.reorderAutomation:decodeRows",
          ),
        ),
      );

  const countAutomationTasks: TaskRepositoryShape["countAutomationTasks"] = (input) =>
    automationTaskCountRows({
      creatorsJson: JSON.stringify(input.ids.map(automationTaskCreator)),
    }).pipe(
      Effect.map((rows) => {
        const byCreator = new Map(rows.map((row) => [row.createdBy, row.count]));
        return new Map(
          input.ids.map((id) => [id, byCreator.get(automationTaskCreator(id)) ?? 0] as const),
        );
      }),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.countAutomationTasks:query",
          "TaskRepository.countAutomationTasks:decodeRows",
        ),
      ),
    );

  const getAutomationById: TaskRepositoryShape["getAutomationById"] = (input) =>
    getAutomationRow(input).pipe(
      Effect.map(Option.map(mapAutomationRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.getAutomationById:query",
          "TaskRepository.getAutomationById:decodeRows",
        ),
      ),
    );

  const upsertAutomation: TaskRepositoryShape["upsertAutomation"] = (input) =>
    sql
      .withTransaction(
        automationRankFor(input).pipe(
          Effect.flatMap((rank) => upsertAutomationRow({ ...input, rank })),
          Effect.andThen(getAutomationRow({ id: input.id })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.upsertAutomation:reload")(
                    "Automation not found",
                  ),
                ),
              onSome: (row) => Effect.succeed(mapAutomationRow(row)),
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.upsertAutomation:query",
            "TaskRepository.upsertAutomation:decodeRows",
          ),
        ),
      );

  const insertAutomation: TaskRepositoryShape["insertAutomation"] = (input) =>
    sql
      .withTransaction(
        prependAutomationRank().pipe(
          Effect.flatMap((rank) => insertAutomationRow({ ...input, rank })),
          Effect.andThen(getAutomationRow({ id: input.id })),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  toTaskPersistenceSqlError("TaskRepository.insertAutomation:reload")(
                    "Automation not found",
                  ),
                ),
              onSome: (row) => Effect.succeed(mapAutomationRow(row)),
            }),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          toSqlOrDecodeError(
            "TaskRepository.insertAutomation:query",
            "TaskRepository.insertAutomation:decodeRows",
          ),
        ),
      );

  const updateAutomationSchedule: TaskRepositoryShape["updateAutomationSchedule"] = (input) =>
    updateAutomationScheduleRow(input).pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.updateAutomationSchedule:query",
          "TaskRepository.updateAutomationSchedule:decodeRows",
        ),
      ),
    );

  const parkAutomation: TaskRepositoryShape["parkAutomation"] = (input) =>
    parkAutomationRow(input).pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.parkAutomation:query",
          "TaskRepository.parkAutomation:decodeRows",
        ),
      ),
    );

  const countOpenAutomationTasks: TaskRepositoryShape["countOpenAutomationTasks"] = (input) =>
    countOpenAutomationTaskRows(input).pipe(
      Effect.map(Option.match({ onNone: () => 0, onSome: (row) => row.count })),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.countOpenAutomationTasks:query",
          "TaskRepository.countOpenAutomationTasks:decodeRows",
        ),
      ),
    );

  const searchAutomations: TaskRepositoryShape["searchAutomations"] = (input) => {
    const limit = Math.min(input.limit ?? 200, 500);
    return searchAutomationRows({
      projectId: input.projectId ?? null,
      status: input.status ?? null,
      limit,
    }).pipe(
      Effect.map((rows) => rows.map(mapAutomationRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.searchAutomations:query",
          "TaskRepository.searchAutomations:decodeRows",
        ),
      ),
    );
  };

  const listAutomationsByStatus: TaskRepositoryShape["listAutomationsByStatus"] = (input) =>
    listAutomationRowsByStatus(input).pipe(
      Effect.map((rows) => rows.map(mapAutomationRow)),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.listAutomationsByStatus:query",
          "TaskRepository.listAutomationsByStatus:decodeRows",
        ),
      ),
    );

  const countAutomationDrafts: TaskRepositoryShape["countAutomationDrafts"] = (input) =>
    countAutomationDraftRows(input).pipe(
      Effect.map(Option.match({ onNone: () => 0, onSome: (row) => row.count })),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.countAutomationDrafts:query",
          "TaskRepository.countAutomationDrafts:decodeRows",
        ),
      ),
    );

  const deleteAutomation: TaskRepositoryShape["deleteAutomation"] = (input) =>
    deleteAutomationRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.deleteAutomation:query",
          "TaskRepository.deleteAutomation:decodeRows",
        ),
      ),
    );

  // A conflicting insert means the slot is already claimed, which is the
  // expected path after a restart mid-fire; anything else is a real failure.
  const claimAutomationSlot: TaskRepositoryShape["claimAutomationSlot"] = (input) =>
    insertAutomationRunRow(input).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        getAutomationRunRow({ automationId: input.automationId, slot: input.slot }).pipe(
          Effect.flatMap((existing) =>
            Option.isSome(existing) ? Effect.succeed(false) : Effect.fail(cause),
          ),
        ),
      ),
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.claimAutomationSlot:query",
          "TaskRepository.claimAutomationSlot:decodeRows",
        ),
      ),
    );

  const completeAutomationRun: TaskRepositoryShape["completeAutomationRun"] = (input) =>
    completeAutomationRunRow(input).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.completeAutomationRun:query",
          "TaskRepository.completeAutomationRun:decodeRows",
        ),
      ),
    );

  const searchAutomationRuns: TaskRepositoryShape["searchAutomationRuns"] = (input) => {
    const limit = Math.min(input.limit ?? 200, 500);
    return searchAutomationRunRows({
      automationId: input.automationId ?? null,
      limit,
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.searchAutomationRuns:query",
          "TaskRepository.searchAutomationRuns:decodeRows",
        ),
      ),
    );
  };

  return {
    withChangeTransaction,
    upsert: (input) => withChanges(upsert(input), (task) => [task.id], false, input.id),
    getById,
    search,
    page,
    items,
    changes,
    runCounts,
    threadRunCounts,
    markThreadsSeen,
    threadTasks,
    listAllTasks,
    listTriggerCandidates,
    listTasksReachingNotBefore,
    update: (input) => withChanges(update(input), () => [input.id]),
    setArchived: (input) =>
      withChanges(
        setArchived(input),
        (results) => results.flatMap(({ id, task }) => (task === null ? [] : [id])),
        true,
      ),
    reorder: (input) => withChanges(reorder(input), () => [input.id]),
    reorderMany: (input) => withChanges(reorderMany(input), (tasks) => tasks.map(({ id }) => id)),
    deleteTask: (input) =>
      withChanges(
        deleteTask(input),
        () => [input.id],
        true,
        input.id,
        (dates) => dates,
      ).pipe(Effect.asVoid),
    replaceTags: (input) => withChanges(replaceTags(input), () => [input.taskId]),
    addTag: (input) => withChanges(addTag(input), () => [input.taskId]),
    removeTag: (input) => withChanges(removeTag(input), () => [input.taskId]),
    scheduleEntries,
    scheduleRange,
    scheduleForTask,
    scheduleProgress,
    putScheduleEntries,
    deleteScheduleEntries,
    scheduleSettings,
    updateScheduleSettings,
    recomputeReminders,
    claimDueReminders,
    appendEvent,
    events: listTaskEvents,
    upsertAgent,
    getAgentById,
    searchAgents,
    listAllAgents,
    deleteAgent,
    createAgentRun: (input) => withChanges(createAgentRun(input), (run) => [run.taskId], true),
    startAgentRun: (input) =>
      withChanges(
        startAgentRun(input),
        (run) => (Option.isSome(run) ? [run.value.taskId] : []),
        true,
      ),
    getAgentRunById,
    findActiveAgentRunForTaskAgent,
    findActiveAgentRunByThreadId,
    findLatestAgentRunByThreadId,
    listActiveAgentRunsForTask,
    listAllActiveAgentRuns,
    claimAgentRunFinalization: (input) =>
      withChanges(
        Effect.gen(function* () {
          const changed = yield* claimAgentRunFinalization(input);
          const run = yield* getAgentRunById(input);
          return { changed, taskId: Option.getOrNull(Option.map(run, (row) => row.taskId)) };
        }),
        ({ changed, taskId }) => (changed && taskId ? [taskId] : []),
        true,
      ).pipe(Effect.map(({ changed }) => changed)),
    finalizeAgentRun: (input) =>
      withChanges(finalizeAgentRun(input), (changed) => (changed ? [input.taskId] : []), true),
    searchAgentRuns,
    findRunStatusTriggers,
    upsertAutomation,
    insertAutomation,
    reorderAutomation,
    countAutomationTasks,
    updateAutomationSchedule,
    parkAutomation,
    countOpenAutomationTasks,
    getAutomationById,
    searchAutomations,
    listAutomationsByStatus,
    countAutomationDrafts,
    deleteAutomation,
    claimAutomationSlot,
    completeAutomationRun,
    searchAutomationRuns,
  } satisfies TaskRepositoryShape;
});

export const TaskRepositoryLive = Layer.effect(TaskRepository, makeTaskRepository);
