import {
  TaskAgentRunId,
  TaskEventId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
  type TaskPromptSettings,
} from "@t3tools/tasks-contracts/v1";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ThreadId,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  forkParked,
  isActiveRun,
  ProjectStoreV2,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../retryOperational.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import {
  composeTaskPromptSettings,
  TaskPromptSettingsStore,
} from "../persistence/TaskPromptSettingsStore.ts";
import {
  latestFinalizedAssistantMessage,
  makeTaskAgentResultConsumer,
} from "./TaskAgentResultFinalization.ts";

export type TaskChangedReason =
  | "created"
  | "updated"
  | "deleted"
  | "tag-added"
  | "tag-removed"
  | "not-before-reached"
  | "run-finished";
export type TaskAgentChangedReason = "upserted" | "deleted";

export interface TaskChangedInput {
  readonly task: Task;
  readonly reason: TaskChangedReason;
  /** A run that gave up its claim in this change; it ends as completed. */
  readonly releasedRunId?: TaskAgentRunId | null;
}

export interface TaskAgentChangedInput {
  readonly agent: TaskAgent;
  readonly reason: TaskAgentChangedReason;
}

export type MessageRunResult =
  | {
      readonly ok: true;
      /** The messaged run when it was active, else the continuation run. */
      readonly run: TaskAgentRun;
      readonly continued: boolean;
    }
  | {
      readonly ok: false;
      readonly error: string;
      /** The agent's active run on the task, when that is what refused the message. */
      readonly activeRunId?: TaskAgentRunId;
    };

export interface TaskAgentServiceShape {
  readonly scheduleTaskChanged: (input: TaskChangedInput) => Effect.Effect<void>;
  readonly scheduleAgentChanged: (input: TaskAgentChangedInput) => Effect.Effect<void>;
  /** Stops an active run as `stopped`. None when the run does not exist. */
  readonly stopRun: (input: {
    readonly id: TaskAgentRunId;
  }) => Effect.Effect<Option.Option<TaskAgentRun>, unknown>;
  /**
   * Sends a user turn into a run's thread. An active run receives it as is; an
   * ended run continues as a new run on the same thread. Triggers and
   * notBefore do not apply.
   */
  readonly messageRun: (input: {
    readonly id: TaskAgentRunId;
    readonly text: string;
  }) => Effect.Effect<MessageRunResult, unknown>;
  readonly recover: Effect.Effect<void, unknown>;
}

/**
 * Which run gave up its claim in a task update. When the caller is the task's
 * own active run, an explicit assignment to anything but itself releases it.
 * Otherwise the run that held the assignment and lost it to null released it.
 */
export function releasedRunId(input: {
  readonly before: Task;
  readonly after: Task;
  readonly requestedAssignee: string | null | undefined;
  readonly callerRun: TaskAgentRun | null;
}): TaskAgentRunId | null {
  const { before, after, requestedAssignee, callerRun } = input;
  if (callerRun !== null && callerRun.taskId === after.id) {
    return requestedAssignee !== undefined && requestedAssignee !== callerRun.id
      ? callerRun.id
      : null;
  }
  return before.assigneeAgentRunId !== null && after.assigneeAgentRunId === null
    ? TaskAgentRunId.make(before.assigneeAgentRunId)
    : null;
}

/** What a person can do about a run that ended without a result. */
export const TASK_AGENT_RUN_RECOVERY_HINT =
  "Review the run, then continue it with agent_run_message, or change the task's status, tags or notBefore to retry.";

export class TaskAgentService extends Context.Service<TaskAgentService, TaskAgentServiceShape>()(
  "@t3tools/tasks-server/agents/TaskAgentService",
) {}

type ReconciliationJob =
  | { readonly type: "task"; readonly input: TaskChangedInput }
  | { readonly type: "agent"; readonly input: TaskAgentChangedInput };

const RECONCILIATION_QUEUE_CAPACITY = 256;
const ACTIVE_RUN_RECONCILIATION_INTERVAL = Duration.seconds(1);
const NOT_BEFORE_SWEEP_INTERVAL = Duration.seconds(5);
const PENDING_SESSION_START_TIMEOUT_MS = 2 * 60 * 1_000;
const PENDING_RESULT_CONSUMPTION_TIMEOUT_MS = 2 * 60 * 1_000;

/**
 * Task-state part of an agent's trigger. Whether a matching agent actually
 * starts also depends on its previous runs (see `startAgent`).
 */
function startsForTask(agent: TaskAgent, task: Task, nowMs: number): boolean {
  if (!agent.enabled || (agent.projectId !== null && agent.projectId !== task.projectId)) {
    return false;
  }
  if (task.closedAt !== null) return false;
  if (task.notBefore !== null && Date.parse(task.notBefore) > nowMs) return false;
  if (agent.startStatuses.length > 0 && !agent.startStatuses.includes(task.status)) return false;
  if (agent.startTags.length === 0) return true;
  const tags = new Set(task.tags);
  return agent.startTags.every((tag) => tags.has(tag));
}

/**
 * Triggers only decide whether a run starts. A started run lives until it
 * finishes, releases its claim, or is stopped; the task's status and tags may
 * change underneath it, for example when several agents work on one task.
 */
export function continuesTaskAgentRun(agent: TaskAgent, task: Task): boolean {
  return agent.enabled && task.closedAt === null;
}

type StopReason =
  | "released"
  | "stop-requested"
  | "session-stopped"
  | "turn-interrupted"
  | "task-closed"
  | "task-deleted"
  | "agent-disabled"
  | "agent-deleted";

/** Why an active run must end now, or null while it may continue. */
function endingStopReason(agent: TaskAgent | null, task: Task | null): StopReason | null {
  if (task === null) return "task-deleted";
  if (agent === null) return "agent-deleted";
  if (!agent.enabled) return "agent-disabled";
  return continuesTaskAgentRun(agent, task) ? null : "task-closed";
}

/**
 * A task-state agent runs again on a task only after a trigger-relevant change
 * made after its previous run ended, or after the agent itself was edited.
 */
export function runsAgain(agent: TaskAgent, task: Task, latestRun: TaskAgentRun): boolean {
  return (
    Date.parse(task.triggerChangedAt) > Date.parse(latestRun.completedAt ?? latestRun.startedAt) ||
    Date.parse(agent.updatedAt) > Date.parse(latestRun.startedAt)
  );
}

function taskMetadata(metadata: unknown): string {
  try {
    return metadata == null ? "(none)" : JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

interface RunTrigger {
  readonly run: TaskAgentRun;
  readonly agentName: string | null;
  readonly reason: string | null;
}

function triggerSection(trigger: RunTrigger | null): string {
  if (trigger === null) return "";
  const { run } = trigger;
  return `
Triggering run:
This run started because another agent's latest run on this task ended with status "${run.status}".
- runId: ${run.id}
- agentId: ${run.agentId}${trigger.agentName ? ` (${trigger.agentName})` : ""}
- threadId: ${run.threadId}
- completedAt: ${run.completedAt ?? "(unknown)"}
- reason: ${trigger.reason ?? "(not recorded; see the task output and events)"}
Inspect it with agent_run_transcript when that tool is available. Leave "status" out of your task_agent_result unless you mean to change the task status.
`;
}

function prompt(
  agent: TaskAgent,
  task: Task,
  runId: TaskAgentRunId,
  threadId: ThreadId,
  settings: TaskPromptSettings,
  globalPosition: { readonly index: number; readonly total: number },
  trigger: RunTrigger | null,
): string {
  return `${agent.config.instructions.trim()}

Task execution guidance:
${settings.taskExecution.trim() || "(none)"}

Assigned task:
- id: ${task.id}
- rank: ${task.rank} (global position ${globalPosition.index} of ${globalPosition.total} in this environment; informational only)
- projectId: ${task.projectId}
- title: ${task.title}
- status: ${task.status}
- tags: ${task.tags.length > 0 ? task.tags.join(", ") : "(none)"}

Description:
${task.description || "(empty)"}

Metadata:
${taskMetadata(task.metadata)}

Agent run identity:
- agentId: ${agent.id}
- agentRunId: ${runId}
- threadId: ${threadId}
${triggerSection(trigger)}
Task system protocol:
- Work only on the assigned task.
- Use task_get before work if the task may have changed.
- Claim the task by setting assigneeAgentRunId to "${runId}".
- Update task status and append concise findings as work proceeds.
- Keep task output synchronized with the latest concise result when explicitly continuing work in this thread.
- Downstream task ancestry is recorded automatically from this thread by the server.
- Always finish with a fenced task_agent_result JSON block.

~~~task_agent_result
{"status":"ready for review","summary":"Outcome summary.","blocked":false,"events":[]}
~~~`.trim();
}

/** The first message of a task-agent run; it identifies the v2 run that run started. */
export function taskAgentRunMessageId(runId: TaskAgentRunId): MessageId {
  return MessageId.make(`task-agent-message:${runId}`);
}

function iso(value: DateTime.DateTime): string {
  return DateTime.formatIso(DateTime.toUtc(value));
}

/**
 * What a task-agent run's v2 thread says about the run: the v2 runs from the
 * one its first message started, newest last.
 */
type ThreadRunState =
  | { readonly type: "missing-thread" }
  | { readonly type: "not-started" }
  | { readonly type: "active" }
  | { readonly type: "ended"; readonly latest: OrchestrationV2Run };

function threadRunState(
  runs: ReadonlyArray<OrchestrationV2Run>,
  startMessageId: MessageId,
): ThreadRunState {
  const start = runs.find((run) => run.userMessageId === startMessageId);
  if (start === undefined) return { type: "not-started" };
  const owned = runs
    .filter((run) => run.ordinal >= start.ordinal)
    .toSorted((left, right) => left.ordinal - right.ordinal);
  if (owned.some((run) => isActiveRun(run) || run.status === "queued")) return { type: "active" };
  return { type: "ended", latest: owned[owned.length - 1] ?? start };
}

const make = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const promptSettings = yield* TaskPromptSettingsStore;
  const threads = yield* ThreadManagementService;
  const projects = yield* ProjectStoreV2;
  const crypto = yield* Crypto.Crypto;
  const jobs = yield* Queue.bounded<ReconciliationJob>(RECONCILIATION_QUEUE_CAPACITY);

  /**
   * The global task texts plus the task's project additions. A deleted
   * project's texts are ignored.
   */
  const runPromptSettings = (task: Task) =>
    Effect.gen(function* () {
      const global = yield* promptSettings.get;
      const project = yield* promptSettings.getProject(task.projectId);
      if (!project.settings.taskExecution.trim()) return global;
      const shell = yield* projects
        .getShell(task.projectId)
        .pipe(Effect.orElseSucceed(Option.none));
      return Option.isSome(shell)
        ? composeTaskPromptSettings(global, {
            title: shell.value.title,
            settings: project.settings,
          })
        : global;
    });

  /** The thread's runs; None when the v2 thread does not exist (yet). */
  const readThreadRuns = (threadId: ThreadId) =>
    threads.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.map((records) =>
        records.thread.deletedAt === null ? Option.some(records) : Option.none(),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );

  const scheduleTaskChanged = (input: TaskChangedInput) =>
    Queue.offer(jobs, { type: "task", input }).pipe(Effect.asVoid);
  const consumeResult = makeTaskAgentResultConsumer({ repository, scheduleTaskChanged });

  const randomId = (prefix: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => `${prefix}-${uuid}`));
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const appendEvent = (task: Task, kind: string, payload: unknown) =>
    Effect.gen(function* () {
      yield* repository.appendEvent({
        id: TaskEventId.make(yield* randomId("task-event")),
        taskId: task.id,
        kind,
        payload,
        createdAt: yield* now,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to append task lifecycle event", {
          taskId: task.id,
          kind,
          cause,
        }),
      ),
    );
  // Finalizing a run and continuing it share its thread: one at a time per
  // thread, so a finalizer cannot touch a continuation that started meanwhile.
  // Not reentrant: never call finalizeRun or messageRun while holding it.
  const threadLocks = new Map<ThreadId, Semaphore.Semaphore>();
  const withThreadLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) => {
    let lock = threadLocks.get(threadId);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      threadLocks.set(threadId, lock);
    }
    return lock.withPermits(1)(effect);
  };

  /** Interrupts the thread's active v2 run, if any. */
  const interruptThread = (threadId: ThreadId, reason: string) =>
    Effect.gen(function* () {
      const records = yield* readThreadRuns(threadId);
      if (Option.isNone(records)) return;
      if (!records.value.runs.some(isActiveRun)) return;
      yield* threads.interruptThread({
        projectId: records.value.thread.projectId,
        commandId: CommandId.make(yield* randomId("task-agent-interrupt")),
        threadId,
        reason,
      });
    });

  const finalizeRun = (input: {
    readonly run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly threadId: ThreadId;
    };
    readonly finalizingStatus: string;
    readonly status: string;
    /** Interrupt the run's in-flight v2 work before recording the end. */
    readonly interrupt: boolean;
    readonly taskOutput?: string | null;
    readonly events?: ReadonlyArray<{
      readonly id: TaskEventId;
      readonly taskId: Task["id"];
      readonly kind: string;
      readonly payload: unknown;
      readonly createdAt: string;
    }>;
  }) =>
    withThreadLock(
      input.run.threadId,
      Effect.gen(function* () {
        const timestamp = yield* now;
        const claimed = yield* repository.claimAgentRunFinalization({
          id: input.run.id,
          finalizingStatus: input.finalizingStatus,
        });
        if (!claimed) return false;
        // The claim admits a second finalizer of the same kind (crash recovery). If
        // another one already finished this run, a continuation may own the thread
        // now, so its work must not be interrupted.
        const ownsThread = Effect.gen(function* () {
          const run = yield* repository.getAgentRunById({ id: input.run.id });
          if (Option.isNone(run) || run.value.completedAt !== null) return false;
          const active = yield* repository.findActiveAgentRunByThreadId({
            threadId: input.run.threadId,
          });
          return Option.isNone(active) || active.value.id === input.run.id;
        });
        if (!(yield* ownsThread)) return false;
        if (input.interrupt) {
          yield* interruptThread(input.run.threadId, `Task-agent run ${input.status}.`).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to interrupt a finishing task-agent run", {
                agentRunId: input.run.id,
                cause,
              }),
            ),
          );
        }
        return yield* repository.finalizeAgentRun({
          id: input.run.id,
          finalizingStatus: input.finalizingStatus,
          status: input.status,
          completedAt: timestamp,
          taskId: input.run.taskId,
          ...(input.taskOutput !== undefined ? { taskOutput: input.taskOutput } : {}),
          releaseAssignment: true,
          events: input.events ?? [],
        });
      }),
    );

  /** A released run finished its work; every other reason ends it as stopped. */
  const stopActiveRun = (
    run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly agentId: TaskAgent["id"];
      readonly threadId: ThreadId;
    },
    reason: StopReason | null,
  ) =>
    Effect.gen(function* () {
      const recordEvent = reason !== null && reason !== "released" && reason !== "task-deleted";
      return yield* finalizeRun({
        run,
        finalizingStatus: "finalizing:stopped",
        status: reason === "released" ? "completed" : "stopped",
        interrupt: true,
        events: recordEvent
          ? [
              {
                id: TaskEventId.make(`${run.id}:task-agent-stopped`),
                taskId: run.taskId,
                kind: "task.agent-stopped",
                payload: {
                  agentId: run.agentId,
                  agentRunId: run.id,
                  threadId: run.threadId,
                  reason,
                },
                createdAt: yield* now,
              },
            ]
          : [],
      });
    });

  /** Lets agents waiting on run statuses see a run that just ended. */
  const scheduleRunFinished = (taskId: Task["id"]) =>
    repository.getById({ id: taskId }).pipe(
      Effect.flatMap((task) =>
        Option.isSome(task)
          ? scheduleTaskChanged({ task: task.value, reason: "run-finished" })
          : Effect.void,
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to schedule a finished task-agent run", {
          taskId,
          cause,
        }),
      ),
      // Detached: callers may run on the reconciliation fiber that drains this queue.
      Effect.forkDetach,
      Effect.asVoid,
    );

  const finishUnrecoverableRun = (input: {
    readonly run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly agentId: TaskAgent["id"];
      readonly threadId: ThreadId;
    };
    readonly task: Task | null;
    readonly status: "failed" | "interrupted";
    readonly reason: string;
    readonly interrupt: boolean;
  }) =>
    Effect.gen(function* () {
      const timestamp = yield* now;
      let taskOutput: string | null | undefined;
      const events = [];
      if (input.task !== null) {
        const recovery = TASK_AGENT_RUN_RECOVERY_HINT;
        const recoveryNote = `Task-agent run ${input.run.id} ${input.status}: ${input.reason} ${recovery}`;
        const existingOutput = input.task.output?.trim() ?? "";
        taskOutput = existingOutput.includes(recoveryNote)
          ? existingOutput
          : existingOutput
            ? `${existingOutput}\n\n${recoveryNote}`
            : recoveryNote;
        events.push({
          id: TaskEventId.make(`${input.run.id}:task-agent-${input.status}`),
          taskId: input.task.id,
          kind: `task.agent-${input.status}`,
          payload: {
            agentId: input.run.agentId,
            agentRunId: input.run.id,
            threadId: input.run.threadId,
            reason: input.reason,
            recovery,
          },
          createdAt: timestamp,
        });
      }
      const finalized = yield* finalizeRun({
        run: input.run,
        finalizingStatus: `finalizing:${input.status}`,
        status: input.status,
        interrupt: input.interrupt,
        ...(taskOutput !== undefined ? { taskOutput } : {}),
        events,
      });
      if (finalized && input.task !== null) yield* scheduleRunFinished(input.task.id);
    });

  /**
   * Decides one active run from its v2 thread. Unlike V1, an in-flight v2 run
   * survives a restart (provider runtime recovery continues it), so startup no
   * longer interrupts running task agents.
   */
  const reconcileRun = (run: TaskAgentRun, timestamp: string) =>
    Effect.gen(function* () {
      const taskOption = yield* repository.getById({ id: run.taskId });
      const agentOption = yield* repository.getAgentById({ id: run.agentId });
      const currentTask = Option.getOrNull(taskOption);
      if (run.status === "finalizing:result") return;
      if (run.status === "finalizing:stopped") {
        yield* stopActiveRun(run, null);
        return;
      }
      const stopReason = endingStopReason(
        Option.getOrNull(agentOption),
        Option.getOrNull(taskOption),
      );
      if (stopReason !== null) {
        yield* stopActiveRun(run, stopReason);
        return;
      }
      if (run.status === "finalizing:interrupted" || run.status === "finalizing:failed") {
        yield* finishUnrecoverableRun({
          run,
          task: currentTask,
          status: run.status === "finalizing:interrupted" ? "interrupted" : "failed",
          reason: "The run ended before its finalization completed.",
          interrupt: true,
        });
        return;
      }

      const records = yield* readThreadRuns(run.threadId);
      const state: ThreadRunState = Option.isNone(records)
        ? { type: "missing-thread" }
        : threadRunState(records.value.runs, taskAgentRunMessageId(run.id));
      const runAgeMs = Date.parse(timestamp) - Date.parse(run.startedAt);
      switch (state.type) {
        case "active":
          return;
        case "missing-thread":
        case "not-started": {
          // startAgent persists the run before it creates the thread and sends
          // the first message, so a fresh run may not have a v2 run yet.
          if (runAgeMs <= PENDING_SESSION_START_TIMEOUT_MS) return;
          yield* finishUnrecoverableRun({
            run,
            task: currentTask,
            status: "failed",
            reason:
              state.type === "missing-thread"
                ? "The task-agent execution thread is missing."
                : "The provider run did not start before the task-agent timeout.",
            interrupt: false,
          });
          return;
        }
        case "ended": {
          const { latest } = state;
          const endedAt = latest.completedAt === null ? timestamp : iso(latest.completedAt);
          const graceExpired =
            Date.parse(timestamp) - Date.parse(endedAt) > PENDING_RESULT_CONSUMPTION_TIMEOUT_MS;
          if (latest.status === "completed") {
            const reply = yield* threads.getThreadRecords(run.threadId, ["messages"], {
              messageRoles: ["assistant"],
              messageRunIds: [latest.id],
            });
            const message = latestFinalizedAssistantMessage(reply.messages);
            if (
              message !== undefined &&
              (yield* consumeResult({
                threadId: run.threadId,
                markdown: message.text,
                createdAt: iso(message.updatedAt),
              }))
            ) {
              return;
            }
            if (!graceExpired) return;
            yield* finishUnrecoverableRun({
              run,
              task: currentTask,
              status: "failed",
              reason: "The provider turn ended without a valid task-agent result.",
              interrupt: false,
            });
            return;
          }
          if (latest.status === "failed") {
            yield* finishUnrecoverableRun({
              run,
              task: currentTask,
              status: "failed",
              reason: `The provider run ${latest.id} failed.`,
              interrupt: false,
            });
            return;
          }
          // Interrupted, cancelled or rolled back: a person may still continue
          // the thread within the grace period.
          if (graceExpired) yield* stopActiveRun(run, "turn-interrupted");
          return;
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to reconcile active task-agent run", {
          agentRunId: run.id,
          cause,
        }),
      ),
    );

  const reconcileActiveRuns = Effect.gen(function* () {
    const activeRuns = yield* repository.listAllActiveAgentRuns();
    const timestamp = yield* now;
    yield* Effect.forEach(activeRuns, (run) => reconcileRun(run, timestamp), {
      discard: true,
      concurrency: 1,
    });
  });

  /**
   * Run-status agents start for an unhandled terminal run of another agent;
   * every other agent starts on task state, subject to `runsAgain`.
   */
  const startAgent = (queuedAgent: TaskAgent, queuedTask: Task) =>
    Effect.gen(function* () {
      // Jobs carry the state from when they were queued; a later close, disable,
      // delete or notBefore must win, so decide on the stored state.
      const currentTask = yield* repository.getById({ id: queuedTask.id });
      const currentAgent = yield* repository.getAgentById({ id: queuedAgent.id });
      if (Option.isNone(currentTask) || Option.isNone(currentAgent)) return;
      const task = currentTask.value;
      const agent = currentAgent.value;
      if (!startsForTask(agent, task, Date.parse(yield* now))) return;
      if (
        Option.isSome(
          yield* repository.findActiveAgentRunForTaskAgent({
            taskId: task.id,
            agentId: agent.id,
          }),
        )
      )
        return;

      let trigger: RunTrigger | null = null;
      if (agent.startRunStatuses.length > 0) {
        const triggerRun = yield* repository.findRunStatusTrigger({
          taskId: task.id,
          agentId: agent.id,
          statuses: agent.startRunStatuses,
          completedAfter: agent.createdAt,
        });
        if (Option.isNone(triggerRun)) return;
        const triggerAgent = yield* repository.getAgentById({ id: triggerRun.value.agentId });
        // A failed run's provider error is its thread's last error, as V1's session error was.
        const failedShell =
          triggerRun.value.status === "failed"
            ? yield* threads
                .getThreadShell(triggerRun.value.threadId)
                .pipe(Effect.orElseSucceed(() => null))
            : null;
        trigger = {
          run: triggerRun.value,
          agentName: Option.isSome(triggerAgent) ? triggerAgent.value.name : null,
          reason: failedShell?.lastError?.trim() || null,
        };
      } else {
        const [latestRun] = yield* repository.searchAgentRuns({
          taskId: task.id,
          agentId: agent.id,
          limit: 1,
        });
        if (latestRun !== undefined && !runsAgain(agent, task, latestRun)) return;
      }

      const timestamp = yield* now;
      const settings = yield* runPromptSettings(task);
      const threadId = ThreadId.make(yield* randomId("task-agent"));
      const runId = TaskAgentRunId.make(yield* randomId("task-agent-run"));
      const runtimeMode = agent.config.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode = agent.config.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
      const modelSelection = agent.config.modelSelection;
      const title = `${agent.name}: ${task.title}`;

      // Eligibility is re-checked inside the insert, so a close, postponement,
      // disable or delete committed since the checks above wins.
      const run = yield* repository
        .startAgentRun({
          id: runId,
          taskId: task.id,
          agentId: agent.id,
          threadId,
          modelSelection,
          status: "running",
          startedAt: timestamp,
          completedAt: null,
          triggerRunId: trigger?.run.id ?? null,
          continuesRunId: null,
          startableAt: timestamp,
        })
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.catch((cause) =>
            repository
              .findActiveAgentRunForTaskAgent({ taskId: task.id, agentId: agent.id })
              .pipe(
                Effect.flatMap((active) =>
                  Option.isSome(active) ? Effect.succeed(null) : Effect.fail(cause),
                ),
              ),
          ),
        );
      if (run === null) return;

      yield* Effect.gen(function* () {
        const globallyOrderedTasks = yield* repository.listAllTasks();
        const globalIndex = globallyOrderedTasks.findIndex(({ id }) => id === task.id);
        const globalPosition = {
          index: globalIndex < 0 ? globallyOrderedTasks.length : globalIndex + 1,
          total: globallyOrderedTasks.length,
        };
        // Task-agent threads run in the project root and stay out of thread
        // lists; the task UI links to them.
        yield* threads.dispatch({
          type: "thread.create",
          createdBy: "agent",
          creationSource: "server",
          commandId: CommandId.make(yield* randomId("task-agent-thread-create")),
          threadId,
          projectId: task.projectId,
          title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: null,
          worktreePath: null,
          sidebarHidden: true,
        });
        yield* threads.sendToThread({
          projectId: task.projectId,
          commandId: CommandId.make(yield* randomId("task-agent-turn-start")),
          threadId,
          messageId: taskAgentRunMessageId(run.id),
          text: prompt(agent, task, run.id, threadId, settings, globalPosition, trigger),
          attachments: [],
          modelSelection,
          mode: "auto",
          createdBy: "agent",
          creationSource: "server",
        });
        yield* appendEvent(task, "task.agent-started", {
          agentId: agent.id,
          agentRunId: run.id,
          threadId,
          role: agent.config.role,
          ...(trigger !== null ? { triggerRunId: trigger.run.id } : {}),
        });
      }).pipe(
        Effect.onInterrupt(() =>
          finishUnrecoverableRun({
            run,
            task,
            status: "failed",
            reason: "Task-agent startup was interrupted before the provider run became usable.",
            interrupt: true,
          }).pipe(Effect.ignore),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* finishUnrecoverableRun({
              run,
              task,
              status: "failed",
              reason: `Task-agent provider startup failed: ${String(cause)}`,
              interrupt: true,
            }).pipe(Effect.ignore);
            yield* Effect.logError("Failed to start task agent", {
              taskId: task.id,
              agentId: agent.id,
              cause,
            });
          }),
        ),
      );
    });

  const startMatchingAgents = (agents: ReadonlyArray<TaskAgent>, task: Task) =>
    Effect.gen(function* () {
      const nowMs = Date.parse(yield* now);
      yield* Effect.forEach(
        agents.filter((agent) => startsForTask(agent, task, nowMs)),
        (agent) => startAgent(agent, task),
        { discard: true, concurrency: 1 },
      );
    });

  const reconcileTask = ({ task: queuedTask, reason, releasedRunId }: TaskChangedInput) =>
    Effect.gen(function* () {
      if (reason !== "run-finished") {
        yield* appendEvent(queuedTask, `task.${reason}`, {
          status: queuedTask.status,
          tags: queuedTask.tags,
        });
      }
      const current =
        reason === "deleted"
          ? null
          : Option.getOrNull(yield* repository.getById({ id: queuedTask.id }));
      const task = current ?? queuedTask;
      const active = yield* repository.listActiveAgentRunsForTask({ id: task.id });
      yield* Effect.forEach(
        active,
        (run) =>
          Effect.gen(function* () {
            const agent = Option.getOrNull(yield* repository.getAgentById({ id: run.agentId }));
            const stopReason = current === null ? "task-deleted" : endingStopReason(agent, current);
            if (stopReason !== null) yield* stopActiveRun(run, stopReason);
            else if (run.id === releasedRunId) yield* stopActiveRun(run, "released");
          }),
        { discard: true, concurrency: 1 },
      );
      if (current === null) return;
      yield* startMatchingAgents(yield* repository.listAllAgents(), task);
    });

  const reconcileAgent = ({ agent, reason }: TaskAgentChangedInput) =>
    Effect.gen(function* () {
      const runs = (yield* repository.listAllActiveAgentRuns()).filter(
        (run) => run.agentId === agent.id,
      );
      yield* Effect.forEach(
        runs,
        (run) =>
          Effect.gen(function* () {
            const task = Option.getOrNull(yield* repository.getById({ id: run.taskId }));
            const stopReason =
              reason === "deleted" ? "agent-deleted" : endingStopReason(agent, task);
            if (stopReason !== null) yield* stopActiveRun(run, stopReason);
          }),
        { discard: true, concurrency: 1 },
      );
      if (reason === "deleted" || !agent.enabled) return;
      yield* Effect.forEach(
        yield* repository.listAllTasks(),
        (task) => startMatchingAgents([agent], task),
        { discard: true, concurrency: 1 },
      );
    });

  const recover = Effect.gen(function* () {
    yield* reconcileActiveRuns;
    const agents = (yield* repository.listAllAgents()).filter((agent) => agent.enabled);
    yield* Effect.forEach(
      yield* repository.listAllTasks(),
      (task) => startMatchingAgents(agents, task),
      { discard: true, concurrency: 1 },
    );
  });

  const messageRun: TaskAgentServiceShape["messageRun"] = ({ id, text }) =>
    Effect.gen(function* () {
      const refuse = (error: string, activeRunId?: TaskAgentRunId): MessageRunResult => ({
        ok: false,
        error,
        ...(activeRunId !== undefined ? { activeRunId } : {}),
      });
      const found = yield* repository.getAgentRunById({ id });
      if (Option.isNone(found)) return refuse(`Agent run '${id}' was not found.`);
      // Set while a continuation exists whose first turn has not been sent yet.
      const pending: {
        current: { readonly continuation: TaskAgentRun; readonly task: Task } | null;
      } = { current: null };
      // Decided and sent under the thread's lock, against the run's current state,
      // so a finalizer cannot act on this thread in between.
      const outcome = yield* withThreadLock(
        found.value.threadId,
        Effect.gen(function* () {
          const runOption = yield* repository.getAgentRunById({ id });
          if (Option.isNone(runOption)) return refuse(`Agent run '${id}' was not found.`);
          const run = runOption.value;
          const records = yield* readThreadRuns(run.threadId);
          if (Option.isNone(records))
            return refuse(`Thread '${run.threadId}' of agent run '${id}' was not found.`);
          const thread = records.value.thread;
          const taskOption = yield* repository.getById({ id: run.taskId });
          if (Option.isNone(taskOption)) return refuse(`Task '${run.taskId}' was not found.`);
          const task = taskOption.value;
          if (task.closedAt !== null)
            return refuse(`Task '${task.id}' is closed. Reopen it before messaging its runs.`);
          const agentOption = yield* repository.getAgentById({ id: run.agentId });
          if (Option.isNone(agentOption)) return refuse(`Agent '${run.agentId}' was not found.`);
          const agent = agentOption.value;
          if (!agent.enabled)
            return refuse(
              `Agent '${agent.name}' (${agent.id}) is disabled. Enable it before messaging its runs.`,
            );

          // The same delivery a person's message gets: v2 steers a running turn
          // and otherwise starts a new run on the thread.
          const sendTurn = (messageId: MessageId, messageText: string) =>
            Effect.gen(function* () {
              yield* threads.sendToThread({
                projectId: thread.projectId,
                commandId: CommandId.make(yield* randomId("task-agent-message-turn")),
                threadId: run.threadId,
                messageId,
                text: messageText,
                attachments: [],
                mode: "auto",
                createdBy: "agent",
                creationSource: "server",
              });
            });

          if (run.completedAt === null) {
            if (run.status.startsWith("finalizing:"))
              return refuse(
                `Agent run '${id}' is finishing (${run.status}). Message it again once it has ended; it then continues as a new run.`,
              );
            yield* sendTurn(MessageId.make(yield* randomId("task-agent-message")), text);
            return { ok: true, run, continued: false } satisfies MessageRunResult;
          }

          const activeRefusal = (active: TaskAgentRun) =>
            refuse(
              `Agent '${agent.name}' already has active run '${active.id}' on task '${task.id}' (thread '${active.threadId}'). Message that run instead.`,
              active.id,
            );
          const findActive = repository.findActiveAgentRunForTaskAgent({
            taskId: task.id,
            agentId: agent.id,
          });
          const active = yield* findActive;
          if (Option.isSome(active)) return activeRefusal(active.value);
          const timestamp = yield* now;
          // Open task and enabled agent are re-checked inside the insert, so a
          // close, disable or delete committed since the checks above wins.
          const created = yield* repository
            .startAgentRun({
              id: TaskAgentRunId.make(yield* randomId("task-agent-run")),
              taskId: task.id,
              agentId: agent.id,
              threadId: run.threadId,
              modelSelection: thread.modelSelection,
              status: "running",
              startedAt: timestamp,
              completedAt: null,
              triggerRunId: null,
              continuesRunId: run.id,
              // Explicit messages ignore notBefore.
              startableAt: null,
            })
            .pipe(
              Effect.map((continuation) => ({
                continuation: Option.getOrNull(continuation),
                active: null,
              })),
              // The one-active-run index lost a race against another start.
              Effect.catch((cause) =>
                findActive.pipe(
                  Effect.flatMap((raced) =>
                    Option.isSome(raced)
                      ? Effect.succeed({ continuation: null, active: raced.value })
                      : Effect.fail(cause),
                  ),
                ),
              ),
            );
          if (created.active !== null) return activeRefusal(created.active);
          const continuation = created.continuation;
          if (continuation === null)
            return refuse(
              `Task '${task.id}' was closed, or agent '${agent.id}' was disabled or deleted, while the message was being sent.`,
            );

          pending.current = { continuation, task };
          const sent = yield* Effect.exit(
            sendTurn(
              taskAgentRunMessageId(continuation.id),
              `Task-agent run continued:
This thread continues ended run ${run.id} (status "${run.status}") as a new run.
- agentRunId: ${continuation.id}
Claim the task with this agentRunId and finish with a fenced task_agent_result JSON block, as before.

${text}`,
            ),
          );
          if (sent._tag === "Failure") {
            return {
              sendFailure: `Sending the continuation message failed: ${String(sent.cause)}`,
            } as const;
          }
          pending.current = null;
          yield* appendEvent(task, "task.agent-started", {
            agentId: agent.id,
            agentRunId: continuation.id,
            threadId: run.threadId,
            role: agent.config.role,
            continuesRunId: run.id,
          });
          return { ok: true, run: continuation, continued: true } satisfies MessageRunResult;
        }),
      ).pipe(
        // Finishing takes the same lock, so it runs only after the lock is released.
        Effect.onInterrupt(() =>
          pending.current === null
            ? Effect.void
            : finishUnrecoverableRun({
                run: pending.current.continuation,
                task: pending.current.task,
                status: "failed",
                reason: "Sending the continuation message was interrupted.",
                interrupt: false,
              }).pipe(Effect.ignore),
        ),
      );
      if ("sendFailure" in outcome) {
        if (pending.current !== null) {
          yield* finishUnrecoverableRun({
            run: pending.current.continuation,
            task: pending.current.task,
            status: "failed",
            reason: outcome.sendFailure,
            interrupt: false,
          }).pipe(Effect.ignore);
        }
        return refuse(outcome.sendFailure);
      }
      return outcome;
    });

  const stopRun: TaskAgentServiceShape["stopRun"] = ({ id }) =>
    Effect.gen(function* () {
      const run = yield* repository.getAgentRunById({ id });
      if (Option.isNone(run)) return run;
      if (run.value.completedAt === null) yield* stopActiveRun(run.value, "stop-requested");
      return yield* repository.getAgentRunById({ id });
    });

  // A v2 run reaching a terminal status settles the task-agent run on its
  // thread right away; the periodic pass below covers missed events and
  // grace periods.
  yield* threads.streamDomainEvents.pipe(
    Stream.filter(
      (event) =>
        event.type === "run.updated" &&
        !isActiveRun(event.payload) &&
        event.payload.status !== "queued",
    ),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const active = yield* repository.findActiveAgentRunByThreadId({
          threadId: event.threadId,
        });
        if (Option.isSome(active)) yield* reconcileRun(active.value, yield* now);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to settle a task-agent run from a v2 run event", { cause }),
        ),
      ),
    ),
    (stream) => retryOperational(stream, { operation: "task-agent-run-events" }),
    forkParked,
  );

  // Background work waits for server activation, so a standby server never
  // starts or settles runs.
  yield* forkParked(
    Effect.forever(
      Effect.sleep(ACTIVE_RUN_RECONCILIATION_INTERVAL).pipe(Effect.andThen(reconcileActiveRuns)),
    ),
  );

  // Wakes tasks whose notBefore passed since the previous sweep. Tasks already
  // due at startup are covered by `recover`.
  let notBeforeSweptUntil = yield* now;
  yield* forkParked(
    Effect.forever(
      Effect.sleep(NOT_BEFORE_SWEEP_INTERVAL).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const until = yield* now;
            const due = yield* repository.listTasksReachingNotBefore({
              after: notBeforeSweptUntil,
              until,
            });
            yield* Effect.forEach(
              due,
              (task) => scheduleTaskChanged({ task, reason: "not-before-reached" }),
              { discard: true },
            );
            notBeforeSweptUntil = until;
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to wake tasks reaching notBefore", { cause }),
            ),
          ),
        ),
      ),
    ),
  );

  const process = (job: ReconciliationJob) => {
    const effect = job.type === "task" ? reconcileTask(job.input) : reconcileAgent(job.input);
    return retryOperational(effect, {
      operation: "task-reconciliation-job",
      jobType: job.type,
    });
  };
  yield* forkParked(Effect.forever(Queue.take(jobs).pipe(Effect.flatMap(process))));

  return {
    scheduleTaskChanged,
    scheduleAgentChanged: (input) =>
      Queue.offer(jobs, { type: "agent", input }).pipe(Effect.asVoid),
    stopRun,
    messageRun,
    recover,
  } satisfies TaskAgentServiceShape;
});

export const TaskAgentServiceLive = Layer.effect(TaskAgentService, make);
