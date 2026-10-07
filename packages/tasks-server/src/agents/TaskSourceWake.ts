import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationV2Notification,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { forkParked, ThreadManagementService } from "../../../../apps/server/src/extensionApi.ts";

const SWEEP_INTERVAL = "2 seconds";
const SWEEP_LIMIT = 200;
const SUMMARY_MAX_LENGTH = 400;
/** Sends of one batch before it counts as handled anyway, so a broken chat cannot be woken forever. */
export const SOURCE_WAKE_MAX_ATTEMPTS = 5;
const SOURCE_WAKE_RETRY_BASE_MS = 10_000;

/**
 * Dispatch failures that a retry cannot fix: the chat refused the message, or
 * the command was already decided. Anything else (storage, a provider adapter,
 * a defect) is retried.
 */
const PERMANENT_DISPATCH_ERRORS = new Set([
  "OrchestratorCommandRejectedError",
  "OrchestratorCommandPreviouslyRejectedError",
  "OrchestratorCommandIdConflictError",
  "OrchestratorSubagentThreadReadOnlyError",
]);

export function isPermanentWakeFailure(cause: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(cause)) return false;
  const error = Cause.squash(cause);
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    PERMANENT_DISPATCH_ERRORS.has(error._tag)
  );
}

const PendingWakeRow = Schema.Struct({
  runId: Schema.String,
  status: Schema.String,
  runThreadId: Schema.String,
  agentName: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  taskTitle: Schema.NullOr(Schema.String),
  sourceThreadId: Schema.NullOr(Schema.String),
  /** The source chat is itself a task-agent run thread. */
  sourceIsRunThread: Schema.Number,
  /** The task is archived now, possibly after the run finished. */
  taskArchived: Schema.Number,
  summary: Schema.NullOr(Schema.String),
});
export type PendingWakeRow = typeof PendingWakeRow.Type;

export type WakeRun = PendingWakeRow & { readonly taskId: string; readonly sourceThreadId: string };

type Outcome = OrchestrationV2Notification["outcome"];

const OUTCOME: Record<string, { readonly outcome: Outcome; readonly verb: string }> = {
  completed: { outcome: "completed", verb: "completed" },
  blocked: { outcome: "updated", verb: "is blocked" },
  failed: { outcome: "failed", verb: "failed" },
  interrupted: { outcome: "failed", verb: "was interrupted" },
};

function clip(text: string, max: number): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Runs a source chat hears about: finished by the agent, not stopped by a
 * person or a task change, on a task that is not archived.
 */
export function wakesSourceChat(row: PendingWakeRow): row is WakeRun {
  return (
    row.taskId !== null &&
    row.sourceThreadId !== null &&
    row.sourceThreadId !== row.runThreadId &&
    row.sourceIsRunThread === 0 &&
    row.taskArchived === 0 &&
    OUTCOME[row.status] !== undefined
  );
}

/** One notification and agent-facing message for the runs that finished for one source chat. */
export function sourceWakeMessage(runs: readonly [WakeRun, ...WakeRun[]]): {
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
} {
  const [first] = runs;
  const outcomes = runs.map((run) => OUTCOME[run.status]!.outcome);
  const outcome: Outcome = outcomes.includes("failed")
    ? "failed"
    : outcomes.every((value) => value === "completed")
      ? "completed"
      : "updated";
  const tasks = runs.map((run) => ({ id: run.taskId, title: run.taskTitle ?? run.taskId }));
  const summary =
    runs.length === 1
      ? `Task "${clip(tasks[0]!.title, 80)}" ${OUTCOME[first.status]!.verb}`
      : `${runs.length} task runs finished: ${clip(tasks.map((task) => task.title).join(", "), 120)}`;
  const lines = runs.map((run) => {
    const title = run.taskTitle ?? run.taskId;
    const agent = run.agentName === null ? "" : ` by agent "${run.agentName}"`;
    const detail = run.summary === null ? "" : ` Summary: ${clip(run.summary, SUMMARY_MAX_LENGTH)}`;
    return `- Task "${title}" (${run.taskId}), run ${run.runId}${agent}: ${run.status}.${detail}`;
  });
  return {
    text: [
      runs.length === 1
        ? "A task-agent run finished for a task created in this chat:"
        : "Task-agent runs finished for tasks created in this chat:",
      ...lines,
      "Read a task with task_get for its full output.",
    ].join("\n"),
    notification: {
      source: {
        kind: "task_agent_run",
        tasks,
        ...(runs.length === 1 ? { childThreadId: ThreadId.make(first.runThreadId) } : {}),
      },
      outcome,
      summary,
    },
  };
}

export interface TaskSourceWakeShape {
  /** Tells each source chat about the runs that finished since the last sweep, once. */
  readonly sweep: Effect.Effect<void>;
}

export class TaskSourceWake extends Context.Service<TaskSourceWake, TaskSourceWakeShape>()(
  "@t3tools/tasks-server/agents/TaskSourceWake",
) {}

const WakeBatchRow = Schema.Struct({
  id: Schema.String,
  sourceThreadId: Schema.String,
  attempts: Schema.Number,
});

/**
 * Wakes the chat a task came from when its runs finish, the way upstream's pull request
 * watch wakes a thread: a queued, server-created notification message that v2's durable
 * queue delivers once the chat is idle. Finished runs are swept from storage, so runs that
 * end together reach their chat as one message and a restart loses none.
 *
 * Runs are first grouped into batches that are stored before anything is sent. The
 * batch id is the message's command id, so a retry repeats the same message (v2 replays
 * a command it already ran) and acknowledges only that batch's runs. Failures a retry
 * cannot fix, and batches that keep failing, count as handled.
 */
export const makeTaskSourceWake = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService;

  const runColumns = sql`
    run.id AS "runId",
    run.status AS "status",
    run.thread_id AS "runThreadId",
    agent.name AS "agentName",
    task.id AS "taskId",
    task.title AS "taskTitle",
    task.source_thread_id AS "sourceThreadId",
    EXISTS (
      SELECT 1 FROM task_agent_runs AS source_run
      WHERE source_run.thread_id = task.source_thread_id
    ) AS "sourceIsRunThread",
    task.archived_at IS NOT NULL AS "taskArchived",
    COALESCE(
      json_extract(result.payload_json, '$.summary'),
      json_extract(ending.payload_json, '$.reason')
    ) AS "summary"
  `;
  const runJoins = sql`
    LEFT JOIN tasks AS task ON task.id = run.task_id
    LEFT JOIN task_agents AS agent ON agent.id = run.agent_id
    LEFT JOIN task_events AS result ON result.id = run.id || ':task-agent-result'
    LEFT JOIN task_events AS ending ON ending.id = run.id || ':task-agent-' || run.status
  `;

  /** Finished runs not yet told and not yet in a batch. */
  const unbatchedRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PendingWakeRow,
    execute: () => sql`
      SELECT ${runColumns}
      FROM task_agent_runs AS run
      ${runJoins}
      WHERE run.completed_at IS NOT NULL
        AND run.source_wake_at IS NULL
        AND run.source_wake_batch_id IS NULL
      ORDER BY run.completed_at ASC, run.id ASC
      LIMIT ${SWEEP_LIMIT}
    `,
  });

  const batchRuns = SqlSchema.findAll({
    Request: Schema.String,
    Result: PendingWakeRow,
    execute: (batchId) => sql`
      SELECT ${runColumns}
      FROM task_agent_runs AS run
      ${runJoins}
      WHERE run.source_wake_batch_id = ${batchId}
      ORDER BY run.completed_at ASC, run.id ASC
    `,
  });

  const dueBatches = SqlSchema.findAll({
    Request: Schema.String,
    Result: WakeBatchRow,
    execute: (now) => sql`
      SELECT id, source_thread_id AS "sourceThreadId", attempts
      FROM task_source_wake_batches
      WHERE retry_at IS NULL OR retry_at <= ${now}
      ORDER BY created_at ASC, id ASC
      LIMIT ${SWEEP_LIMIT}
    `,
  });

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  /**
   * Stores the next batches: runs no chat hears about are marked handled, the
   * rest are grouped per source chat. Decided in one transaction on the stored
   * rows, so a run joins exactly one batch and a batch never changes.
   */
  const formBatches = sql.withTransaction(
    Effect.gen(function* () {
      const rows = yield* unbatchedRows();
      if (rows.length === 0) return;
      const at = yield* now;
      const silent = rows.filter((row) => !wakesSourceChat(row)).map((row) => row.runId);
      if (silent.length > 0) {
        yield* sql`
          UPDATE task_agent_runs SET source_wake_at = ${at}
          WHERE ${sql.in("id", silent)} AND source_wake_at IS NULL
        `;
      }
      const bySource = new Map<string, WakeRun[]>();
      for (const row of rows) {
        if (!wakesSourceChat(row)) continue;
        bySource.set(row.sourceThreadId, [...(bySource.get(row.sourceThreadId) ?? []), row]);
      }
      for (const [sourceThreadId, runs] of bySource) {
        const batchId = runs[0]!.runId;
        yield* sql`
          INSERT INTO task_source_wake_batches (id, source_thread_id, attempts, retry_at, created_at)
          VALUES (${batchId}, ${sourceThreadId}, 0, NULL, ${at})
        `;
        yield* sql`
          UPDATE task_agent_runs SET source_wake_batch_id = ${batchId}
          WHERE ${sql.in(
            "id",
            runs.map((run) => run.runId),
          )}
        `;
      }
    }),
  );

  /** The batch is handled: its runs count as told and the batch row goes. */
  const acknowledge = (batchId: string) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const at = yield* now;
        yield* sql`
          UPDATE task_agent_runs SET source_wake_at = ${at}
          WHERE source_wake_batch_id = ${batchId} AND source_wake_at IS NULL
        `;
        yield* sql`DELETE FROM task_source_wake_batches WHERE id = ${batchId}`;
      }),
    );

  const deliver = (batch: typeof WakeBatchRow.Type) =>
    Effect.gen(function* () {
      // Read at delivery, so a task archived since the batch formed is left out,
      // and a batch with nothing left is handled without a message.
      const runs = (yield* batchRuns(batch.id)).filter(wakesSourceChat);
      const [first, ...rest] = runs;
      if (first === undefined) return yield* acknowledge(batch.id);
      const { text, notification } = sourceWakeMessage([first, ...rest]);
      const sent = yield* Effect.exit(
        threads.dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "server",
          commandId: CommandId.make(`task-source-wake:${batch.id}`),
          threadId: ThreadId.make(batch.sourceThreadId),
          messageId: MessageId.make(`message:task-source-wake:${batch.id}`),
          senderThreadId: ThreadId.make(first.runThreadId),
          text,
          attachments: [],
          notification,
          dispatchMode: { type: "queue_after_active" },
        }),
      );
      if (sent._tag === "Success") return yield* acknowledge(batch.id);
      const attempts = batch.attempts + 1;
      if (isPermanentWakeFailure(sent.cause) || attempts >= SOURCE_WAKE_MAX_ATTEMPTS) {
        yield* Effect.logWarning("Gave up waking a task's source chat", {
          sourceThreadId: batch.sourceThreadId,
          batchId: batch.id,
          attempts,
          cause: sent.cause,
        });
        return yield* acknowledge(batch.id);
      }
      const retryAt = DateTime.formatIso(
        DateTime.add(yield* DateTime.now, {
          milliseconds: SOURCE_WAKE_RETRY_BASE_MS * 3 ** (attempts - 1),
        }),
      );
      yield* Effect.logInfo("Will retry waking a task's source chat", {
        sourceThreadId: batch.sourceThreadId,
        batchId: batch.id,
        attempts,
        retryAt,
        cause: sent.cause,
      });
      yield* sql`
        UPDATE task_source_wake_batches SET attempts = ${attempts}, retry_at = ${retryAt}
        WHERE id = ${batch.id}
      `;
    });

  const sweep = Effect.gen(function* () {
    yield* formBatches;
    for (const batch of yield* dueBatches(yield* now)) {
      yield* deliver(batch);
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Task source-chat wake sweep failed", { cause }),
    ),
    Effect.withSpan("TaskSourceWake.sweep"),
  );

  yield* forkParked(sweep.pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.asVoid));

  return { sweep } satisfies TaskSourceWakeShape;
});

export const TaskSourceWakeLive = Layer.effect(TaskSourceWake, makeTaskSourceWake);
