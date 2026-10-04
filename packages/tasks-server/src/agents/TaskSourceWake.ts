import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationV2Notification,
} from "@t3tools/contracts";
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

/** Runs a source chat hears about: finished by the agent, not stopped by a person or a task change. */
export function wakesSourceChat(row: PendingWakeRow): row is WakeRun {
  return (
    row.taskId !== null &&
    row.sourceThreadId !== null &&
    row.sourceThreadId !== row.runThreadId &&
    row.sourceIsRunThread === 0 &&
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

/**
 * Wakes the chat a task came from when its runs finish, the way upstream's pull request
 * watch wakes a thread: a queued, server-created notification message that v2's durable
 * queue delivers once the chat is idle. Finished runs are swept from storage, so runs that
 * end together reach their chat as one message and a restart loses none.
 */
export const makeTaskSourceWake = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService;

  const pendingRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PendingWakeRow,
    execute: () => sql`
      SELECT
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
        COALESCE(
          json_extract(result.payload_json, '$.summary'),
          json_extract(ending.payload_json, '$.reason')
        ) AS "summary"
      FROM task_agent_runs AS run
      LEFT JOIN tasks AS task ON task.id = run.task_id
      LEFT JOIN task_agents AS agent ON agent.id = run.agent_id
      LEFT JOIN task_events AS result ON result.id = run.id || ':task-agent-result'
      LEFT JOIN task_events AS ending ON ending.id = run.id || ':task-agent-' || run.status
      WHERE run.completed_at IS NOT NULL AND run.source_wake_at IS NULL
      ORDER BY run.completed_at ASC, run.id ASC
      LIMIT ${SWEEP_LIMIT}
    `,
  });

  const markWoken = (runIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        UPDATE task_agent_runs SET source_wake_at = ${at}
        WHERE ${sql.in("id", runIds)} AND source_wake_at IS NULL
      `;
    });

  const wakeSource = (sourceThreadId: string, runs: readonly [WakeRun, ...WakeRun[]]) =>
    Effect.gen(function* () {
      const { text, notification } = sourceWakeMessage(runs);
      const key = runs[0].runId;
      yield* threads.dispatch({
        type: "message.dispatch",
        createdBy: "agent",
        creationSource: "server",
        commandId: CommandId.make(`task-source-wake:${key}`),
        threadId: ThreadId.make(sourceThreadId),
        messageId: MessageId.make(`message:task-source-wake:${key}`),
        senderThreadId: ThreadId.make(runs[0].runThreadId),
        text,
        attachments: [],
        notification,
        dispatchMode: { type: "queue_after_active" },
      });
    }).pipe(
      // A deleted or unreachable chat cannot be told; the runs still count as handled.
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to wake a task's source chat", { sourceThreadId, cause }),
      ),
    );

  const sweep = Effect.gen(function* () {
    const rows = yield* pendingRows();
    if (rows.length === 0) return;
    const bySource = new Map<string, WakeRun[]>();
    for (const row of rows) {
      if (!wakesSourceChat(row)) continue;
      const runs = bySource.get(row.sourceThreadId) ?? [];
      runs.push(row);
      bySource.set(row.sourceThreadId, runs);
    }
    for (const [sourceThreadId, runs] of bySource) {
      const [first, ...rest] = runs;
      if (first !== undefined) yield* wakeSource(sourceThreadId, [first, ...rest]);
    }
    yield* markWoken(rows.map((row) => row.runId));
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
