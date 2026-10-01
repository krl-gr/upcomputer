import {
  Task,
  TaskAgent,
  TaskAgentId,
  TaskAgentRun,
  TaskAgentRunId,
  TaskAutomation,
  TaskAutomationId,
  TaskAutomationRun,
  TaskEvent,
  TaskEventId,
  TaskId,
  TaskTag,
  type TaskSearchInput,
  type TaskPageInput,
  type TaskThreadTasksInput,
  TaskRunCount,
  type TaskChange,
  TaskThreadRunCountsResult,
} from "@upcomputer/tasks-contracts/v1";
import { ModelSelection, ThreadId } from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlError } from "effect/unstable/sql/SqlError";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toTaskPersistenceDecodeError, toTaskPersistenceSqlError } from "./Errors.ts";
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
  type TaskRepositoryShape,
} from "./TaskRepository.ts";
import {
  TASK_RANK_STEP,
  encodeTaskRank,
  rebalancedTaskRanks,
  taskRankBetween,
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
  closedAt: Task.fields.closedAt,
  notBefore: Task.fields.notBefore,
  triggerChangedAt: Task.fields.triggerChangedAt,
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
  next: Pick<Task, "title" | "description" | "status" | "tags" | "notBefore" | "closedAt">,
): boolean {
  const previousTags = new Set(previous.tags);
  const nextTags = new Set(next.tags);
  return (
    previous.title !== next.title ||
    previous.description !== next.description ||
    previous.status !== next.status ||
    previous.closedAt !== next.closedAt ||
    previous.notBefore !== next.notBefore ||
    previousTags.size !== nextTags.size ||
    [...nextTags].some((tag) => !previousTags.has(tag))
  );
}

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

function mapAgentRow(row: typeof TaskAgentDbRow.Type): TaskAgent {
  return {
    ...row,
    enabled: row.enabled !== 0,
  };
}

function mapAutomationRow(row: typeof TaskAutomationDbRow.Type): TaskAutomation {
  return {
    ...row,
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
class TaskChangeBatch extends Context.Reference<
  | {
      readonly owner: object;
      readonly events: PendingTaskChange[];
    }
  | undefined
>("@upcomputer/tasks-server/TaskChangeBatch", { defaultValue: () => undefined }) {}

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
  // Proposal batches use withChangeTransaction to defer until the OUTER commit.
  // Failed transactions never emit changes; notifications cannot be interrupted
  // after commit. Slow consumers cannot block writes (the bus is sliding).
  const withChanges = <A>(
    effect: Effect.Effect<A, import("./Errors.ts").TaskRepositoryError>,
    ids: (result: A) => ReadonlyArray<TaskId>,
    runsChanged = false,
    rootMembershipTaskId?: TaskId,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const before = yield* listRevision();
          const rootsBefore = rootMembershipTaskId
            ? yield* rootsForTasks([rootMembershipTaskId])
            : [];
          const result = yield* effect;
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
            const event = { taskIds, listChanged, runsChanged: changedRuns, rootThreadIds };
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

  const threadRunCountRows = SqlSchema.findAll({
    Request: Schema.Struct({ ids: Schema.String }),
    Result: Schema.Struct({ threadId: ThreadId, ...TaskRunCount.fields }),
    execute: ({ ids }) => sql`
      SELECT t.root_thread_id AS "threadId", ${countedRunStatus} AS status, COUNT(*) AS count
      FROM tasks t JOIN task_agent_runs r ON r.task_id = t.id
      WHERE t.root_thread_id IN (SELECT value FROM json_each(${ids}))
      GROUP BY t.root_thread_id, 2 ORDER BY t.root_thread_id, 2`,
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

  const runCountRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskRunCount,
    execute: () => sql`
      SELECT ${countedRunStatus} AS status, COUNT(*) AS count
      FROM tasks t JOIN task_agent_runs r ON r.task_id = t.id
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
          closed_at,
          not_before,
          trigger_changed_at
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
          ${task.closedAt},
          ${task.notBefore},
          ${task.triggerChangedAt}
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
          closed_at = excluded.closed_at,
          not_before = excluded.not_before,
          trigger_changed_at = excluded.trigger_changed_at
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
          closed_at AS "closedAt",
          not_before AS "notBefore",
          trigger_changed_at AS "triggerChangedAt"
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
          closed_at AS "closedAt",
          not_before AS "notBefore",
          trigger_changed_at AS "triggerChangedAt"
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
      afterRank: Schema.NullOr(Task.fields.rank),
      afterId: Schema.NullOr(TaskId),
      limit: Schema.Number,
    }),
    Result: TaskDbRow,
    execute: ({ projectId, status, tagsJson, tagCount, afterRank, afterId, limit }) =>
      sql`
        SELECT
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
          closed_at AS "closedAt",
          not_before AS "notBefore",
          trigger_changed_at AS "triggerChangedAt"
        FROM tasks
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND (${status} IS NULL OR status = ${status})
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
        ORDER BY rank ASC, id ASC
        LIMIT ${limit}
      `,
  });

  const listAllTaskRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TaskDbRow,
    execute: () =>
      sql`
        SELECT
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
          closed_at AS "closedAt",
          not_before AS "notBefore",
          trigger_changed_at AS "triggerChangedAt"
        FROM tasks
        ORDER BY rank ASC, id ASC
      `,
  });

  // Uses `tasks_root_thread_id`; open tasks first, then closed, each in global order.
  const threadTaskRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId, limit: Schema.Number }),
    Result: TaskDbRow,
    execute: ({ threadId, limit }) =>
      sql`
        SELECT
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
          closed_at AS "closedAt",
          not_before AS "notBefore",
          trigger_changed_at AS "triggerChangedAt"
        FROM tasks
        WHERE root_thread_id = ${threadId}
        ORDER BY closed_at IS NOT NULL, rank ASC, id ASC
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
    Result: Schema.Struct({ id: TaskId }),
    execute: () => sql`SELECT id FROM tasks ORDER BY rank ASC, id ASC`,
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

  const claimAgentRunFinalizationRow = SqlSchema.findAll({
    Request: ClaimTaskAgentRunFinalizationInput,
    Result: Schema.Struct({ id: TaskAgentRunId }),
    execute: ({ id, finalizingStatus }) =>
      sql`
        UPDATE task_agent_runs
        SET status = ${finalizingStatus}
        WHERE id = ${id}
          AND completed_at IS NULL
          AND (status = ${finalizingStatus} OR status NOT LIKE 'finalizing:%')
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

  const findRunStatusTriggerRow = SqlSchema.findOneOption({
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
        LIMIT 1
      `,
  });

  const notBeforeTaskIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ after: Schema.String, until: Schema.String }),
    Result: Schema.Struct({ id: TaskId }),
    execute: ({ after, until }) => sql`
      SELECT id FROM tasks
      WHERE not_before > ${after} AND not_before <= ${until} AND closed_at IS NULL
      ORDER BY rank ASC, id ASC
    `,
  });

  const AUTOMATION_COLUMNS = sql`
    id,
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
        WHERE closed_at IS NULL
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
        ORDER BY updated_at DESC, created_at DESC, id ASC
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

  const rebalanceTaskRows = (rows: ReadonlyArray<{ readonly id: TaskId }>) => {
    const ranks = rebalancedTaskRanks(rows.map(({ id }) => id));
    return clearTaskRanks().pipe(
      Effect.andThen(
        Effect.forEach(rows, ({ id }) => setTaskRank({ id, rank: ranks.get(id)! }), {
          discard: true,
          concurrency: 1,
        }),
      ),
    );
  };

  const prependRank = () =>
    getFirstTaskRankRow().pipe(
      Effect.flatMap((first) => {
        if (Option.isNone(first)) return Effect.succeed(encodeTaskRank(TASK_RANK_STEP));
        const candidate = taskRankBetween(null, first.value.rank);
        if (candidate) return Effect.succeed(candidate);
        return listTaskIdRows().pipe(
          Effect.flatMap(rebalanceTaskRows),
          Effect.as(encodeTaskRank(TASK_RANK_STEP / 2n)),
        );
      }),
    );

  const upsert: TaskRepositoryShape["upsert"] = (task) =>
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
          const persisted: Task = {
            ...task,
            rank,
            ...origin,
            notBefore,
            sourceRunId:
              Option.isNone(existing) && origin.parentRunId ? origin.parentRunId : task.sourceRunId,
            triggerChangedAt: !previous
              ? task.updatedAt
              : triggerFieldsChanged(previous, { ...task, notBefore })
                ? yield* nowIso
                : previous.triggerChangedAt,
          };
          yield* upsertTaskRow(persisted);
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
        afterRank: null,
        afterId: null,
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
      const decodedTags = yield* Schema.decodeUnknownEffect(Schema.Array(TaskTagDbRow))(tagRows);
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
            afterRank: input.cursor?.rank ?? null,
            afterId: input.cursor?.id ?? null,
            limit: limit + 1,
          });
          const visible = rows.slice(0, limit);
          const tasks = yield* decorateTaskRows(visible);
          // Status facets intentionally ignore the selected status and page cursor.
          const statuses = yield* sql<{ status: string }>`SELECT DISTINCT status FROM tasks
        WHERE (${input.projectId ?? null} IS NULL OR project_id = ${input.projectId ?? null})
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
                  ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : {}),
                  ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
                  updatedAt,
                } satisfies Task;
                return upsert(next);
              }),
            ),
        }),
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

  const deleteTask: TaskRepositoryShape["deleteTask"] = (input) =>
    sql
      .withTransaction(
        deleteTaskTags({ taskId: input.id }).pipe(Effect.andThen(deleteTaskRow(input))),
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

          if (
            input.taskStatus !== undefined ||
            input.taskOutput !== undefined ||
            input.releaseAssignment
          ) {
            yield* sql`
            UPDATE tasks
            SET status = CASE
                  WHEN ${input.taskStatus ?? null} IS NULL THEN status
                  ELSE ${input.taskStatus ?? null}
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
                WHEN ${input.taskStatus ?? null} IS NOT NULL AND ${input.taskStatus ?? null} <> status
                  THEN ${input.completedAt}
                ELSE trigger_changed_at
              END,
              updated_at = ${input.completedAt}
            WHERE id = ${input.taskId}
          `;
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

  const findRunStatusTrigger: TaskRepositoryShape["findRunStatusTrigger"] = (input) =>
    findRunStatusTriggerRow({
      taskId: input.taskId,
      agentId: input.agentId,
      statusesJson: JSON.stringify(input.statuses),
      completedAfter: input.completedAfter,
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TaskRepository.findRunStatusTrigger:query",
          "TaskRepository.findRunStatusTrigger:decodeRows",
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
        upsertAutomationRow(input).pipe(
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
        insertAutomationRow(input).pipe(
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
    threadTasks,
    listAllTasks,
    listTasksReachingNotBefore,
    update: (input) => withChanges(update(input), () => [input.id]),
    reorder: (input) => withChanges(reorder(input), () => [input.id]),
    deleteTask: (input) => withChanges(deleteTask(input), () => [input.id], true, input.id),
    replaceTags: (input) => withChanges(replaceTags(input), () => [input.taskId]),
    addTag: (input) => withChanges(addTag(input), () => [input.taskId]),
    removeTag: (input) => withChanges(removeTag(input), () => [input.taskId]),
    appendEvent,
    upsertAgent,
    getAgentById,
    searchAgents,
    listAllAgents,
    deleteAgent,
    createAgentRun: (input) => withChanges(createAgentRun(input), (run) => [run.taskId], true),
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
    findRunStatusTrigger,
    upsertAutomation,
    insertAutomation,
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
