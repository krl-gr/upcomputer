import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  ThreadId,
  type OrchestrationV2Notification,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  BackgroundNotices,
  forkParked,
  ServerSettingsService,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";

const SWEEP_INTERVAL = "2 seconds";
const SWEEP_LIMIT = 200;
const SUMMARY_MAX_LENGTH = 400;
/** Sends of one batch before it counts as handled anyway, so a broken chat cannot be woken forever. */
export const SOURCE_WAKE_MAX_ATTEMPTS = 5;
const SOURCE_WAKE_RETRY_BASE_MS = 10_000;
/**
 * How long a chat's tasks must have had no run in progress before their
 * completed runs are reported. It bridges the moment between one run ending
 * and the run it triggers starting, such as a review after the work.
 */
export const SOURCE_SETTLE_MS = 15_000;
/**
 * The longest a completed run waits for runs that were already in progress when
 * it ended (a long run beside it, or a queue other chats keep feeding). A
 * Developer and Reviewer pair takes 1 to 2 minutes on the bench and a
 * three-task queue about 3, so a short queue still ends in one report.
 */
export const SOURCE_MAX_WAIT_MS = 5 * 60_000;
/**
 * How close to a completed run's end the same agent's next run starts when it
 * picks up the next queued task. The hand-off starts the next run before the run
 * handing off records its end, 18 to 44 s earlier in practice.
 */
const SOURCE_HANDOFF_MS = 2 * 60_000;
/**
 * The longest a completed run waits for a chain of successors. A queue of six
 * 30 to 60 minute steps fits; a chat whose tasks never stop still hears about
 * four times a day.
 */
export const SOURCE_CHAIN_MAX_WAIT_MS = 6 * 60 * 60_000;

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
  taskStatus: Schema.NullOr(Schema.String),
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

/** Run endings the chat may need to act on, reported without waiting for its other tasks. */
const WAKES_AT_ONCE = ["blocked", "failed", "interrupted"];

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

/** Each task the runs belong to, once, with its status now. */
function runTasks(runs: ReadonlyArray<WakeRun>) {
  return [
    ...new Map(
      runs.map((run) => [
        run.taskId,
        {
          id: run.taskId,
          title: run.taskTitle ?? run.taskId,
          ...(run.taskStatus === null ? {} : { status: run.taskStatus }),
        },
      ]),
    ).values(),
  ];
}

/** One agent-facing line per run. */
function runLines(runs: ReadonlyArray<WakeRun>): string[] {
  return runs.map((run) => {
    const title = run.taskTitle ?? run.taskId;
    const agent = run.agentName === null ? "" : ` by agent "${run.agentName}"`;
    const taskStatus = run.taskStatus === null ? "" : `, task now ${run.taskStatus}`;
    const detail = run.summary === null ? "" : ` Summary: ${clip(run.summary, SUMMARY_MAX_LENGTH)}`;
    return `- Task "${title}" (${run.taskId}), run ${run.runId}${agent}: ${run.status}${taskStatus}.${detail}`;
  });
}

/**
 * Whether the chat only needs to see the runs: all completed, nothing to act on, and
 * the person turned off waking a chat on task completion (`wakeChatOnTaskCompletion`).
 */
export function reportsWithoutWake(
  runs: ReadonlyArray<WakeRun>,
  wakeOnCompletion: boolean,
): boolean {
  return !wakeOnCompletion && runs.every((run) => run.status === "completed");
}

/**
 * The card a chat shows for runs that all completed, recorded without waking its
 * model. The detail is what the agent reads with its next turn.
 */
export function sourceRunsCard(
  runs: readonly [WakeRun, ...WakeRun[]],
): OrchestrationV2Notification {
  const tasks = runTasks(runs);
  return {
    source: { kind: "task_agent_run", tasks },
    outcome: "completed",
    summary:
      tasks.length === 1
        ? `Task "${clip(tasks[0]!.title, 80)}" done`
        : `${tasks.length} tasks done: ${clip(tasks.map((task) => task.title).join(", "), 120)}`,
    detail: [
      "Task-agent runs finished for tasks created in this chat:",
      ...runLines(runs),
      "Read a task with task_get when you need its full output.",
    ].join("\n"),
  };
}

/**
 * One notification and agent-facing message for the runs that finished for one
 * source chat. `idle` says that no run for the chat's tasks is in progress now.
 */
export function sourceWakeMessage(
  runs: readonly [WakeRun, ...WakeRun[]],
  idle: boolean,
): {
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
  const tasks = runTasks(runs);
  const summary =
    runs.length === 1
      ? `Task "${clip(tasks[0]!.title, 80)}" ${OUTCOME[first.status]!.verb}`
      : `${runs.length} task runs finished: ${clip(tasks.map((task) => task.title).join(", "), 120)}`;
  const lines = runLines(runs);
  return {
    text: [
      runs.length === 1
        ? "A task-agent run finished for a task created in this chat:"
        : "Task-agent runs finished for tasks created in this chat:",
      ...lines,
      ...(idle ? ["No run for this chat's tasks is in progress now."] : []),
      "Read a task with task_get when you need its full output.",
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
  /** Tells each source chat about its finished runs that are due, once. */
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
 * Tells the chat a task came from when its runs finish. A batch wakes the chat the way
 * upstream's pull request watch wakes a thread: a queued, server-created notification
 * message that v2's durable queue delivers once the chat is idle. With the
 * `wakeChatOnTaskCompletion` setting off, runs that all completed are instead recorded as a
 * card in the chat without waking its model, which reads them with its next turn; a batch
 * with a blocked, failed or interrupted run still wakes it. Finished runs are swept from
 * storage, so runs that end together reach their chat as one report and a restart loses
 * none.
 *
 * A completed run waits until none of the chat's tasks has had a run in progress for
 * SOURCE_SETTLE_MS, so a chat that queued several tasks hears once at the end; the task
 * UI shows the progress in between. It waits at most SOURCE_MAX_WAIT_MS for other runs,
 * and while a successor in its chain runs or waits to be reported at most
 * SOURCE_CHAIN_MAX_WAIT_MS. A successor is a later run of the same task (a review, a
 * retry), a run it triggered or that continues it, or the same agent's next run
 * starting within SOURCE_HANDOFF_MS of its end (a queue hand-off). A blocked, failed or interrupted
 * run goes out at once, ahead of the completed runs waiting for the same chat, which
 * go with it.
 *
 * Runs are first grouped into batches that are stored before anything is sent. The
 * batch id is the report's command id, so a retry repeats the same report (v2 replays
 * a command it already ran) and acknowledges only that batch's runs. Failures a retry
 * cannot fix, and batches that keep failing, count as handled.
 */
export const makeTaskSourceWake = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService;
  const settings = yield* ServerSettingsService;

  const runColumns = sql`
    run.id AS "runId",
    run.status AS "status",
    run.thread_id AS "runThreadId",
    agent.name AS "agentName",
    task.id AS "taskId",
    task.title AS "taskTitle",
    task.status AS "taskStatus",
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

  /** Runs the chat may need to act on come first, in a batch and in the sweep window. */
  const runOrder = sql`
    CASE WHEN ${sql.in("run.status", WAKES_AT_ONCE)} THEN 0 ELSE 1 END,
    run.completed_at ASC,
    run.id ASC
  `;

  /**
   * Finished runs not yet told and not yet in a batch whose chat may hear now:
   * its tasks have settled (no run in progress or recently ended), one of them
   * ended in a way the chat may need to act on, or a completed one has waited
   * SOURCE_MAX_WAIT_MS with no successor in progress, recently ended or itself
   * waiting, or SOURCE_CHAIN_MAX_WAIT_MS. A waiting successor hands the wait down
   * the chain, so its last run decides when the whole chain is reported.
   * The rest wait here, so a chat that delegates a queue hears once when it
   * settles, not on every run.
   */
  const dueRows = SqlSchema.findAll({
    Request: Schema.Struct({
      settledBefore: Schema.String,
      waitedBefore: Schema.String,
      chainedBefore: Schema.String,
    }),
    Result: PendingWakeRow,
    execute: ({ settledBefore, waitedBefore, chainedBefore }) => sql`
      WITH busy_source AS (
        SELECT DISTINCT busy_task.source_thread_id AS id
        FROM task_agent_runs AS busy_run
        JOIN tasks AS busy_task ON busy_task.id = busy_run.task_id
        WHERE busy_task.source_thread_id IS NOT NULL
          AND (busy_run.completed_at IS NULL OR busy_run.completed_at > ${settledBefore})
      ),
      urgent_source AS (
        SELECT DISTINCT urgent_task.source_thread_id AS id
        FROM task_agent_runs AS urgent_run
        JOIN tasks AS urgent_task ON urgent_task.id = urgent_run.task_id
        WHERE urgent_run.completed_at IS NOT NULL
          AND urgent_run.source_wake_at IS NULL
          AND urgent_run.source_wake_batch_id IS NULL
          AND ${sql.in("urgent_run.status", WAKES_AT_ONCE)}
          AND urgent_task.archived_at IS NULL
      ),
      waited_source AS (
        SELECT DISTINCT waited_task.source_thread_id AS id
        FROM task_agent_runs AS waited_run
        JOIN tasks AS waited_task ON waited_task.id = waited_run.task_id
        WHERE waited_run.completed_at <= ${waitedBefore}
          AND waited_run.source_wake_at IS NULL
          AND waited_run.source_wake_batch_id IS NULL
          AND waited_run.status = 'completed'
          AND waited_task.archived_at IS NULL
          AND (
            waited_run.completed_at <= ${chainedBefore}
            OR NOT EXISTS (
              SELECT 1
              FROM task_agent_runs AS next_run
              JOIN tasks AS next_task ON next_task.id = next_run.task_id
              WHERE next_task.source_thread_id = waited_task.source_thread_id
                AND next_run.started_at > waited_run.started_at
                AND (
                  next_run.completed_at IS NULL
                  OR next_run.completed_at > ${settledBefore}
                  OR (
                    next_run.status = 'completed'
                    AND next_run.source_wake_at IS NULL
                    AND next_run.source_wake_batch_id IS NULL
                    AND next_task.archived_at IS NULL
                  )
                )
                AND (
                  next_run.task_id = waited_run.task_id
                  OR next_run.trigger_run_id = waited_run.id
                  OR next_run.continues_run_id = waited_run.id
                  OR (
                    next_run.agent_id = waited_run.agent_id
                    AND next_run.started_at BETWEEN strftime(
                      '%Y-%m-%dT%H:%M:%fZ',
                      waited_run.completed_at,
                      ${`-${SOURCE_HANDOFF_MS / 1000} seconds`}
                    ) AND strftime(
                      '%Y-%m-%dT%H:%M:%fZ',
                      waited_run.completed_at,
                      ${`+${SOURCE_HANDOFF_MS / 1000} seconds`}
                    )
                  )
                )
            )
          )
      )
      SELECT ${runColumns}
      FROM task_agent_runs AS run
      ${runJoins}
      WHERE run.completed_at IS NOT NULL
        AND run.source_wake_at IS NULL
        AND run.source_wake_batch_id IS NULL
        AND (
          task.source_thread_id IS NULL
          OR task.source_thread_id NOT IN (SELECT id FROM busy_source)
          OR task.source_thread_id IN (SELECT id FROM urgent_source)
          OR task.source_thread_id IN (SELECT id FROM waited_source)
        )
      ORDER BY ${runOrder}
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
      ORDER BY ${runOrder}
    `,
  });

  /** Whether a run for a task created in the chat is in progress now. */
  const sourceBusy = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ busy: Schema.Number }),
    execute: (sourceThreadId) => sql`
      SELECT EXISTS (
        SELECT 1
        FROM task_agent_runs AS busy_run
        JOIN tasks AS busy_task ON busy_task.id = busy_run.task_id
        WHERE busy_task.source_thread_id = ${sourceThreadId}
          AND busy_run.completed_at IS NULL
      ) AS busy
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
   * Stores the next batches from the due runs: runs no chat hears about are
   * marked handled, the rest are grouped per source chat. Decided in one transaction on the stored
   * rows, so a run joins exactly one batch and a batch never changes.
   */
  const formBatches = sql.withTransaction(
    Effect.gen(function* () {
      const current = yield* DateTime.now;
      const before = (milliseconds: number) =>
        DateTime.formatIso(DateTime.subtract(current, { milliseconds }));
      const rows = yield* dueRows({
        settledBefore: before(SOURCE_SETTLE_MS),
        waitedBefore: before(SOURCE_MAX_WAIT_MS),
        chainedBefore: before(SOURCE_CHAIN_MAX_WAIT_MS),
      });
      if (rows.length === 0) return;
      const at = DateTime.formatIso(current);
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

  const deliver = Effect.fn("TaskSourceWake.deliver")(function* (batch: typeof WakeBatchRow.Type) {
    // Read at delivery, so a task archived since the batch formed is left out,
    // and a batch with nothing left is handled without a report.
    const runs = (yield* batchRuns(batch.id)).filter(wakesSourceChat);
    const [first, ...rest] = runs;
    if (first === undefined) return yield* acknowledge(batch.id);
    const commandId = CommandId.make(`task-source-wake:${batch.id}`);
    const threadId = ThreadId.make(batch.sourceThreadId);
    // Read per batch, so a change applies to the next report without a restart.
    const wakeOnCompletion = yield* settings.getSettings.pipe(
      Effect.map((current) => current.wakeChatOnTaskCompletion),
      Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS.wakeChatOnTaskCompletion),
    );
    const send = reportsWithoutWake(runs, wakeOnCompletion)
      ? threads.dispatch({
          type: "thread.notification.record",
          commandId,
          threadId,
          notification: sourceRunsCard([first, ...rest]),
        })
      : Effect.gen(function* () {
          // Decided now, not from the batch: a batch may go out while other work runs.
          const [state] = yield* sourceBusy(batch.sourceThreadId);
          const { text, notification } = sourceWakeMessage([first, ...rest], state?.busy === 0);
          return yield* threads.dispatch({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "server",
            commandId,
            threadId,
            messageId: MessageId.make(`message:task-source-wake:${batch.id}`),
            senderThreadId: ThreadId.make(first.runThreadId),
            text,
            attachments: [],
            notification,
            dispatchMode: { type: "queue_after_active" },
          });
        });
    const sent = yield* Effect.exit(send);
    if (sent._tag === "Success") return yield* acknowledge(batch.id);
    const attempts = batch.attempts + 1;
    if (isPermanentWakeFailure(sent.cause) || attempts >= SOURCE_WAKE_MAX_ATTEMPTS) {
      yield* Effect.logWarning("Gave up waking a task's source chat", {
        sourceThreadId: batch.sourceThreadId,
        batchId: batch.id,
        attempts,
        cause: sent.cause,
      });
      // The person waiting in that chat would otherwise never hear the result.
      const notices = yield* Effect.serviceOption(BackgroundNotices);
      if (Option.isSome(notices)) {
        const title = first.taskTitle ?? first.taskId;
        yield* notices.value.report({
          id: `task-source-wake:${batch.id}`,
          area: "tasks",
          severity: "warning",
          title: "Couldn't report the task result",
          message: `Couldn't tell the chat that started "${title}" that it ${
            first.status === "failed" ? "failed" : "finished"
          }. Open the task in Tasks to see its result.`,
          detail: Cause.pretty(sent.cause),
        });
      }
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
