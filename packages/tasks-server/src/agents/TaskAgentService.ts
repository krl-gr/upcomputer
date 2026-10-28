import {
  TaskAgentRunId,
  TaskEventId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
  type TaskEvent,
  type TaskPromptSettings,
} from "@t3tools/tasks-contracts/v1";
import { CommandId, MessageId, ThreadId, type OrchestrationV2Run } from "@t3tools/contracts";
import { taskAgentRunEndInterruptReason } from "@t3tools/shared/taskAgentRunInterrupt";
import * as Cause from "effect/Cause";
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
  registerRestartContinuationGate,
  ThreadManagementService,
  type RestartContinuationGate,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../retryOperational.ts";
import { agentRunModes, broaderRunMode, type RunModes } from "./runModes.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import {
  composeTaskPromptSettings,
  TaskPromptSettingsStore,
} from "../persistence/TaskPromptSettingsStore.ts";
import {
  previousRunSection,
  RECENT_EVENTS_READ_LIMIT,
  recentEventsSection,
} from "./TaskAgentRunContext.ts";
import {
  latestFinalizedAssistantMessage,
  makeTaskAgentResultConsumer,
} from "./TaskAgentResultFinalization.ts";
import { makeFirstUseRecorder } from "../telemetry/firstUse.ts";
import { makeAgentRunFinishedRecorder, type AgentRunReasonCode } from "../telemetry/agentRuns.ts";

export type TaskChangedReason =
  | "created"
  | "updated"
  | "deleted"
  | "tag-added"
  | "tag-removed"
  | "archived"
  | "unarchived"
  | "not-before-reached"
  | "run-finished";
export type TaskAgentChangedReason = "upserted" | "deleted";

export interface TaskChangedInput {
  /** The task as this change left it. */
  readonly task: Task;
  readonly reason: TaskChangedReason;
  /**
   * A run that gave up its claim in this change. It ends as completed, or as
   * blocked (see BLOCKED_TASK_STATUS), decided from `task`, so an edit made
   * before the change is reconciled does not change the run's outcome.
   */
  readonly releasedRunId?: TaskAgentRunId | null;
  /**
   * The broadest modes an agent this change starts may run in, checked against
   * the agent as stored when it starts; null starts none. Set when an agent's
   * tool call caused the change; absent for a person or the server.
   */
  readonly startCeiling?: RunModes | null;
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

/**
 * The status a run's final, releasing task_update sets to report that it
 * cannot continue: the run then ends as blocked, as a task_agent_result with
 * blocked:true ends it. Compared without case or spacing.
 */
export const BLOCKED_TASK_STATUS = "Blocked";

export function isBlockedTaskStatus(status: string): boolean {
  return status.trim().replace(/\s+/g, " ").toLowerCase() === BLOCKED_TASK_STATUS.toLowerCase();
}

/** Longest task output a blocked release copies into its result event. */
const RELEASE_SUMMARY_MAX_LENGTH = 2_000;

/** What an agent can do about a run that ended without a result. */
export const TASK_AGENT_RUN_RECOVERY_HINT =
  "Review the run, then continue it with agent_run_message, or change the task's status, tags or notBefore to retry.";

/** The same advice in words for the person reading the task output. */
const TASK_AGENT_RUN_PERSON_HINT =
  "Open the run to see what happened, then send it a message to continue, or change the task's status or tags to start over.";

const RUN_CUT_OFF_REASON =
  "Up.computer closed or restarted while this run was starting or finishing, so it ended early. Retry to run it again.";

/** A short reason from a failure cause, only when it is already readable. */
function readableCauseReason(cause: unknown): string | undefined {
  const error = Cause.isCause(cause) ? Cause.squash(cause) : cause;
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { readonly message: unknown }).message)
        : undefined;
  const line = message
    ?.split("\n")[0]
    ?.trim()
    .replace(/[.\s]+$/u, "");
  if (line === undefined || line.length === 0 || line.length > 160) return undefined;
  // Class names, ids, paths and JSON are for logs, not the task output.
  if (/[{}[\]<>`]|\b[A-Za-z]+Error\b|\b\w+_\w+\b|\/\w+\//u.test(line)) return undefined;
  return line.charAt(0).toLowerCase() + line.slice(1);
}

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
 * Whether a task's kind and audience let an agent start on it at all. Routines
 * never start agents, and a person task starts only an agent that requires
 * tags: adding all of its tags is the explicit hand-off.
 */
export function agentMayTakeTask(
  agent: Pick<TaskAgent, "startTags">,
  task: Pick<Task, "kind" | "audience">,
): boolean {
  if (task.kind === "routine") return false;
  return task.audience !== "person" || agent.startTags.length > 0;
}

/**
 * Task-state part of an agent's trigger. Whether a matching agent actually
 * starts also depends on its previous runs (see `startAgent`).
 */
export function startsForTask(agent: TaskAgent, task: Task, nowMs: number): boolean {
  if (
    typeof task.metadata === "object" &&
    task.metadata !== null &&
    "botId" in task.metadata &&
    task.metadata.botId !== agent.id
  )
    return false;
  if (!agentMayTakeTask(agent, task)) return false;
  if (!agent.enabled || (agent.projectId !== null && agent.projectId !== task.projectId)) {
    return false;
  }
  if (task.archivedAt !== null) return false;
  if (task.notBefore !== null && Date.parse(task.notBefore) > nowMs) return false;
  if (agent.startStatuses.length > 0 && !agent.startStatuses.includes(task.status)) return false;
  if (agent.startTags.length === 0) return true;
  const tags = new Set(task.tags);
  return agent.startTags.every((tag) => tags.has(tag));
}

/**
 * Why an agent task in a status agents start on will wait: an enabled agent
 * starts on its status, but none takes it with these tags or this project, for
 * example after a typo in a tag. Statuses no agent starts on are parked on
 * purpose and are not reported.
 */
export function noMatchingAgentReason(
  agents: ReadonlyArray<TaskAgent>,
  task: Task,
  nowMs: number,
): string | null {
  if (task.audience !== "agent" || task.kind === "routine" || task.archivedAt !== null) {
    return null;
  }
  if (task.notBefore !== null && Date.parse(task.notBefore) > nowMs) return null;
  const onStatus = agents.filter(
    (agent) => agent.enabled && agent.startStatuses.includes(task.status),
  );
  if (onStatus.length === 0) return null;
  if (agents.some((agent) => startsForTask(agent, task, nowMs))) return null;
  return `No enabled agent starts on "${task.status}" with these tags, so this task will wait. Pick an agent, or change the status or tags.`;
}

/**
 * Triggers only decide whether a run starts. A started run lives until it
 * finishes, releases its claim, or is stopped; the task's status and tags may
 * change underneath it, for example when several agents work on one task.
 */
export function continuesTaskAgentRun(agent: TaskAgent, task: Task): boolean {
  return agent.enabled && task.archivedAt === null;
}

type StopReason =
  | "released"
  | "stop-requested"
  | "session-stopped"
  | "turn-interrupted"
  | "task-archived"
  | "task-deleted"
  | "agent-disabled"
  | "agent-deleted";

const STOP_REASON_CODES = {
  released: "released",
  "stop-requested": "stop_requested",
  "session-stopped": "session_stopped",
  "turn-interrupted": "turn_interrupted",
  "task-archived": "task_archived",
  "task-deleted": "task_deleted",
  "agent-disabled": "agent_disabled",
  "agent-deleted": "agent_deleted",
} as const satisfies Record<StopReason, AgentRunReasonCode>;

/** Why an active run must end now, or null while it may continue. */
function endingStopReason(agent: TaskAgent | null, task: Task | null): StopReason | null {
  if (task === null) return "task-deleted";
  if (agent === null) return "agent-deleted";
  if (!agent.enabled) return "agent-disabled";
  return continuesTaskAgentRun(agent, task) ? null : "task-archived";
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

/**
 * How a run learns whether it holds its task. The server claims the task when
 * the run starts unless another active run holds it (see startAgentRun).
 */
function claimLine(task: Task, runId: TaskAgentRunId): string {
  return task.assigneeAgentRunId === runId
    ? `- This run holds the task: the server set assigneeAgentRunId to "${runId}" when the run started. Do not claim it again.`
    : `- Claim the task by setting assigneeAgentRunId to "${runId}".`;
}

/** The task's output when the run started, so the agent need not fetch it. */
function outputSection(task: Task): string {
  const output = task.output?.trim();
  return output ? `\nCurrent output:\n${output}\n` : "";
}

/**
 * `task` and `events` are read after the run started, so they show the run's
 * claim, current output and recent events. Nothing here depends on the time
 * the message is built.
 */
function prompt(input: {
  readonly agent: TaskAgent;
  readonly task: Task;
  readonly runId: TaskAgentRunId;
  readonly threadId: ThreadId;
  readonly settings: TaskPromptSettings;
  readonly globalPosition: { readonly index: number; readonly total: number };
  readonly trigger: RunTrigger | null;
  readonly events: ReadonlyArray<TaskEvent>;
  readonly previousRun: TaskAgentRun | null;
}): string {
  const { agent, task, runId, threadId, settings, globalPosition, trigger } = input;
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
${outputSection(task)}
Metadata:
${taskMetadata(task.metadata)}
${recentEventsSection(input.events)}${previousRunSection(input.previousRun, Boolean(task.output?.trim()))}
Agent run identity:
- agentId: ${agent.id}
- agentRunId: ${runId}
- threadId: ${threadId}
${triggerSection(trigger)}
Task system protocol:
- Work only on the assigned task. The task above, its output and its recent events are current as of this run's start, so do not call task_get at the start. Call it only right before changing the task, when another run may have changed it since.
${claimLine(task, runId)}
- Update task status and append concise findings as work proceeds.
- Keep task output synchronized with the latest concise result when explicitly continuing work in this thread.
- Downstream task ancestry is recorded automatically from this thread by the server.
- Set the task's final status yourself with task_update, as your last call and with assigneeAgentRunId null in the same update. Releasing the task ends this run at once, so do everything else first; nothing is needed after it.
- If you cannot continue, make that final update with status "${BLOCKED_TASK_STATUS}" and the blocker and what you need in the output. The run then ends as blocked, which reports it to the chat that created the task and to agents that handle blocked runs.
- If you end without releasing the task, finish with a fenced task_agent_result JSON block. Its "status" never overrides a status you set during this run; add it, with an existing status name, only if you did not set one.

~~~task_agent_result
{"summary":"Outcome summary.","blocked":false,"events":[]}
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

/**
 * The v2 run a task-agent run started with: the one its first message started.
 * A continuation that a person's message started has no message of its own; it
 * starts at that person's v2 run, whose requestedAt is its startedAt.
 */
function startingV2Run(
  runs: ReadonlyArray<OrchestrationV2Run>,
  run: Pick<TaskAgentRun, "id" | "startedAt" | "continuesRunId">,
): OrchestrationV2Run | undefined {
  const startMessageId = taskAgentRunMessageId(run.id);
  const started = runs.find((candidate) => candidate.userMessageId === startMessageId);
  if (started !== undefined || run.continuesRunId === null) return started;
  const startedAtMs = Date.parse(run.startedAt);
  return runs
    .filter((candidate) => DateTime.toEpochMillis(candidate.requestedAt) >= startedAtMs)
    .toSorted((left, right) => left.ordinal - right.ordinal)[0];
}

function threadRunState(
  runs: ReadonlyArray<OrchestrationV2Run>,
  run: Pick<TaskAgentRun, "id" | "startedAt" | "continuesRunId">,
): ThreadRunState {
  const start = startingV2Run(runs, run);
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
  const recordFirstUse = yield* makeFirstUseRecorder;
  const recordRunFinished = yield* makeAgentRunFinishedRecorder(repository);
  const jobs = yield* Queue.bounded<ReconciliationJob>(RECONCILIATION_QUEUE_CAPACITY);

  /**
   * The global task texts plus the task's project additions. A deleted
   * project's texts are ignored.
   */
  const runPromptSettings = Effect.fn("TaskAgentService.runPromptSettings")(function* (task: Task) {
    const global = yield* promptSettings.get;
    const project = yield* promptSettings.getProject(task.projectId);
    if (!project.settings.taskExecution.trim()) return global;
    const shell = yield* projects.getShell(task.projectId).pipe(Effect.orElseSucceed(Option.none));
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

  /** The provider's own words for why the thread's latest run failed, if any. */
  const threadLastError = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.map((shell) => shell?.lastError?.trim() || null),
      Effect.orElseSucceed(() => null),
    );

  const scheduleTaskChanged = (input: TaskChangedInput) =>
    Queue.offer(jobs, { type: "task", input }).pipe(Effect.asVoid);
  const consumeResult = makeTaskAgentResultConsumer({
    repository,
    scheduleTaskChanged,
    recordRunFinished,
  });

  const randomId = (prefix: string) =>
    crypto.randomUUIDv4().pipe(Effect.map((uuid) => `${prefix}-${uuid}`));
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const appendEvent = Effect.fn("TaskAgentService.appendEvent")(
    function* (task: Task, kind: string, payload: unknown, id?: TaskEventId) {
      yield* repository.appendEvent({
        id: id ?? TaskEventId.make(yield* randomId("task-event")),
        taskId: task.id,
        kind,
        payload,
        createdAt: yield* now,
      });
    },
    (effect, task, kind) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to append task lifecycle event", {
            taskId: task.id,
            kind,
            cause,
          }),
        ),
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
  const interruptThread = Effect.fn("TaskAgentService.interruptThread")(function* (
    threadId: ThreadId,
    reason: string,
  ) {
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

  /**
   * Releases the provider sessions of an ended task-agent run's thread now
   * instead of after the provider idle timeout, so a finished run keeps no
   * provider process. The orchestrator refuses while the thread still has
   * active, queued or blocked work, and changes nothing else on the thread. A
   * later message (a continuation) attaches a session again.
   */
  const releaseEndedRunSessions = Effect.fn("TaskAgentService.releaseEndedRunSessions")(
    function* (threadId: ThreadId) {
      yield* threads.dispatch({
        type: "thread.provider-sessions.release-idle",
        commandId: CommandId.make(yield* randomId("task-agent-session-release")),
        threadId,
        reason: "Task-agent run ended.",
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("Task-agent provider sessions not released", { threadId, cause }),
        ),
      ),
  );

  const finalizeRun = (input: {
    readonly run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly threadId: ThreadId;
    };
    readonly finalizingStatus: string;
    readonly status: string;
    readonly reasonCode: AgentRunReasonCode;
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
          yield* interruptThread(
            input.run.threadId,
            taskAgentRunEndInterruptReason(input.status),
          ).pipe(
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
    ).pipe(
      // A run stopped mid-turn releases from its v2 run's terminal event instead.
      Effect.tap((finalized) =>
        finalized
          ? releaseEndedRunSessions(input.run.threadId).pipe(
              Effect.andThen(
                recordRunFinished({ runId: input.run.id, reasonCode: input.reasonCode }),
              ),
            )
          : Effect.void,
      ),
    );

  /** A released run finished its work; every other reason ends it as stopped. */
  const stopActiveRun = Effect.fn("TaskAgentService.stopActiveRun")(function* (
    run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly agentId: TaskAgent["id"];
      readonly threadId: ThreadId;
    },
    reason: StopReason | null,
  ) {
    const recordEvent = reason !== null && reason !== "released" && reason !== "task-deleted";
    return yield* finalizeRun({
      run,
      finalizingStatus: "finalizing:stopped",
      status: reason === "released" ? "completed" : "stopped",
      reasonCode: reason === null ? "finalization_resumed" : STOP_REASON_CODES[reason],
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

  /**
   * A run that released its task finished its work. A release to the Blocked
   * status reports a blocker instead: the run ends as blocked with a result
   * event, and agents waiting on blocked runs start.
   */
  const releaseRun = Effect.fn("TaskAgentService.releaseRun")(function* (
    run: {
      readonly id: TaskAgentRunId;
      readonly taskId: Task["id"];
      readonly agentId: TaskAgent["id"];
      readonly threadId: ThreadId;
    },
    task: Task,
  ) {
    if (!isBlockedTaskStatus(task.status)) return yield* stopActiveRun(run, "released");
    const summary =
      task.output?.trim().slice(0, RELEASE_SUMMARY_MAX_LENGTH) ||
      `Task agent set status "${task.status}".`;
    const finalized = yield* finalizeRun({
      run,
      finalizingStatus: "finalizing:stopped",
      status: "blocked",
      reasonCode: "released_blocked",
      interrupt: true,
      events: [
        {
          id: TaskEventId.make(`${run.id}:task-agent-result`),
          taskId: run.taskId,
          kind: "task.agent-result",
          payload: {
            source: "task_update",
            agentId: run.agentId,
            agentRunId: run.id,
            threadId: run.threadId,
            status: task.status,
            blocked: true,
            summary,
          },
          createdAt: yield* now,
        },
      ],
    });
    // Agents waiting on blocked runs start as they do for a result block,
    // within this run's modes (see startAgent).
    if (finalized) yield* scheduleRunFinished(task.id);
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

  const finishUnrecoverableRun = Effect.fn("TaskAgentService.finishUnrecoverableRun")(
    function* (input: {
      readonly run: {
        readonly id: TaskAgentRunId;
        readonly taskId: Task["id"];
        readonly agentId: TaskAgent["id"];
        readonly threadId: ThreadId;
      };
      readonly task: Task | null;
      readonly status: "failed" | "interrupted";
      readonly reason: string;
      readonly reasonCode: AgentRunReasonCode;
      readonly interrupt: boolean;
    }) {
      const timestamp = yield* now;
      let taskOutput: string | null | undefined;
      const events = [];
      if (input.task !== null) {
        const recovery = TASK_AGENT_RUN_RECOVERY_HINT;
        const recoveryNote = `Run ${input.status === "failed" ? "failed" : "was interrupted"}: ${input.reason} ${TASK_AGENT_RUN_PERSON_HINT} (run ${input.run.id})`;
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
        reasonCode: input.reasonCode,
        interrupt: input.interrupt,
        ...(taskOutput !== undefined ? { taskOutput } : {}),
        events,
      });
      if (finalized && input.task !== null) yield* scheduleRunFinished(input.task.id);
    },
  );

  /**
   * Decides one active run from its v2 thread. Unlike V1, an in-flight v2 run
   * survives a restart (provider runtime recovery continues it), so startup no
   * longer interrupts running task agents.
   */
  const reconcileRun = Effect.fn("TaskAgentService.reconcileRun")(
    function* (run: TaskAgentRun, timestamp: string) {
      const taskOption = yield* repository.getById({ id: run.taskId });
      const agentOption = yield* repository.getAgentById({ id: run.agentId });
      const currentTask = Option.getOrNull(taskOption);
      // A "finalizing:result" run was left by a result finalization that did not
      // commit. It is decided like a running one below: its result is consumed
      // again, or it ends without one; any finalizer may take it over.
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
          reason: RUN_CUT_OFF_REASON,
          reasonCode: "finalization_incomplete",
          interrupt: true,
        });
        return;
      }

      const agentName = Option.isSome(agentOption) ? agentOption.value.name : "The agent";
      const records = yield* readThreadRuns(run.threadId);
      const state: ThreadRunState = Option.isNone(records)
        ? { type: "missing-thread" }
        : threadRunState(records.value.runs, run);
      const runAgeMs = Date.parse(timestamp) - Date.parse(run.startedAt);
      switch (state.type) {
        case "active":
          return;
        case "missing-thread":
        case "not-started": {
          // startAgent persists the run before it creates the thread and sends
          // the first message, so a fresh run may not have a v2 run yet.
          if (runAgeMs <= PENDING_SESSION_START_TIMEOUT_MS) return;
          const startError =
            state.type === "missing-thread" ? null : yield* threadLastError(run.threadId);
          yield* finishUnrecoverableRun({
            run,
            task: currentTask,
            status: "failed",
            reason:
              state.type === "missing-thread"
                ? "The chat for this agent run is gone, so the run stopped. Retry the task to start a new run."
                : startError === null
                  ? `${agentName} didn't start in time. Its provider may be signed out, busy or offline. Check it in Settings, then retry.`
                  : `${agentName} didn't start: ${startError}`,
            reasonCode: state.type === "missing-thread" ? "thread_missing" : "start_timeout",
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
              reason: `${agentName} finished its turn but didn't update the task or report a result. Open the run to see what it did, then retry.`,
              reasonCode: "no_result",
              interrupt: false,
            });
            return;
          }
          if (latest.status === "failed") {
            // The thread's last error is the provider's own explanation, such
            // as a usage limit with its reset time.
            const providerError = yield* threadLastError(run.threadId);
            yield* finishUnrecoverableRun({
              run,
              task: currentTask,
              status: "failed",
              reason:
                providerError === null
                  ? `${agentName} stopped working on this task with an error it didn't explain.`
                  : `${agentName} stopped working on this task: ${providerError}`,
              reasonCode: "provider_failed",
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
    },
    (effect, run) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to reconcile active task-agent run", {
            agentRunId: run.id,
            cause,
          }),
        ),
      ),
  );

  const reconcileActiveRuns = Effect.gen(function* () {
    const activeRuns = yield* repository.listAllActiveAgentRuns();
    const timestamp = yield* now;
    yield* Effect.forEach(
      activeRuns,
      (run) =>
        reconcileRun(run, timestamp).pipe(
          // A result consumed here ends the run outside finalizeRun.
          Effect.andThen(repository.getAgentRunById({ id: run.id })),
          Effect.flatMap((ended) =>
            Option.isSome(ended) && ended.value.completedAt !== null
              ? releaseEndedRunSessions(run.threadId)
              : Effect.void,
          ),
        ),
      { discard: true, concurrency: 1 },
    );
  });

  /**
   * A matching agent that cannot start leaves a reason in the task's history, once per
   * trigger change and agent edit, so the task does not wait silently.
   */
  const recordNotStarted = (task: Task, agent: TaskAgent, reason: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Task agent not started", {
        taskId: task.id,
        agentId: agent.id,
        reason,
      });
      yield* appendEvent(
        task,
        "task.agent-not-started",
        { agentId: agent.id, agentName: agent.name, reason },
        TaskEventId.make(
          `${task.id}:agent-not-started:${agent.id}:${task.triggerChangedAt}:${agent.updatedAt}`,
        ),
      );
    });

  /**
   * Run-status agents start for an unhandled terminal run of another agent;
   * every other agent starts on task state, subject to `runsAgain`.
   */
  const startAgent = Effect.fn("TaskAgentService.startAgent")(function* (
    queuedAgent: TaskAgent,
    queuedTask: Task,
    startCeiling: RunModes | null | undefined,
  ) {
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

    const [previousRun] = yield* repository.searchAgentRuns({
      taskId: task.id,
      agentId: agent.id,
      limit: 1,
    });
    let trigger: RunTrigger | null = null;
    if (agent.startRunStatuses.length > 0) {
      const triggerRuns = yield* repository.findRunStatusTriggers({
        taskId: task.id,
        agentId: agent.id,
        statuses: agent.startRunStatuses,
        completedAfter: agent.createdAt,
      });
      for (const triggerRun of triggerRuns) {
        const triggerShell =
          triggerRun.status === "failed" || triggerRun.status === "blocked"
            ? yield* threads
                .getThreadShell(triggerRun.threadId)
                .pipe(Effect.orElseSucceed(() => null))
            : null;
        // A blocked run reported its own outcome, by result or release, so an agent
        // acting on it runs within that run's modes, whichever pass starts it. A
        // refused run stays unhandled and the agent may take an older one instead.
        if (
          triggerRun.status === "blocked" &&
          (triggerShell === null ||
            broaderRunMode(agentRunModes(agent.config), {
              runtimeMode: triggerShell.runtimeMode,
              interactionMode: triggerShell.interactionMode,
            }) !== null)
        ) {
          yield* recordNotStarted(
            task,
            agent,
            `${agent.name} didn't pick up this blocked task: it needs more permissions than the run that got blocked. Start it yourself from Tasks.`,
          );
          continue;
        }
        const triggerAgent = yield* repository.getAgentById({ id: triggerRun.agentId });
        trigger = {
          run: triggerRun,
          agentName: Option.isSome(triggerAgent) ? triggerAgent.value.name : null,
          // A failed run's provider error is its thread's last error, as V1's session error was.
          reason: triggerRun.status === "failed" ? triggerShell?.lastError?.trim() || null : null,
        };
        break;
      }
      if (trigger === null) return;
    } else if (previousRun !== undefined && !runsAgain(agent, task, previousRun)) {
      return;
    }
    if (
      startCeiling !== undefined &&
      (startCeiling === null || broaderRunMode(agentRunModes(agent.config), startCeiling) !== null)
    ) {
      yield* recordNotStarted(
        task,
        agent,
        startCeiling === null
          ? `${agent.name} didn't start: the chat that changed this task can't start agents right now. Change the task yourself in Tasks to start it.`
          : `${agent.name} didn't start: the chat that changed this task has fewer permissions than the agent needs. Change the task yourself in Tasks to start it.`,
      );
      return;
    }

    const timestamp = yield* now;
    const settings = yield* runPromptSettings(task);
    const threadId = ThreadId.make(yield* randomId("task-agent"));
    const runId = TaskAgentRunId.make(yield* randomId("task-agent-run"));
    const { runtimeMode, interactionMode } = agentRunModes(agent.config);
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
    if (run === null) {
      // A change committed since the checks above wins silently. A task that still
      // matches was refused for the one rule not checked above: a bot works only in
      // its own projects.
      const latest = yield* repository.getById({ id: task.id });
      if (
        Option.isSome(latest) &&
        startsForTask(agent, latest.value, Date.parse(yield* now)) &&
        Option.isNone(
          yield* repository.findActiveAgentRunForTaskAgent({
            taskId: task.id,
            agentId: agent.id,
          }),
        )
      )
        yield* recordNotStarted(
          latest.value,
          agent,
          "The agent is a bot, and this task's project is not one of its projects. Add the project in the bot's settings, or create the task in one of its projects.",
        );
      return;
    }

    yield* Effect.gen(function* () {
      // The agents' queue: unarchived agent tasks, plus this task when a tag
      // handed a person task over.
      const globallyOrderedTasks = (yield* repository.listTriggerCandidates()).filter(
        ({ id, audience }) => audience === "agent" || id === task.id,
      );
      const globalIndex = globallyOrderedTasks.findIndex(({ id }) => id === task.id);
      // Read after the run started: it carries the run's claim and current output.
      const startedTask = globallyOrderedTasks[globalIndex] ?? task;
      const globalPosition = {
        index: globalIndex < 0 ? globallyOrderedTasks.length : globalIndex + 1,
        total: globallyOrderedTasks.length,
      };
      const { events } = yield* repository.events({
        taskId: task.id,
        limit: RECENT_EVENTS_READ_LIMIT,
      });
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
        text: prompt({
          agent,
          task: startedTask,
          runId: run.id,
          threadId,
          settings,
          globalPosition,
          trigger,
          events,
          previousRun: previousRun ?? null,
        }),
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
      yield* recordFirstUse("app.first_agent_run");
    }).pipe(
      Effect.onInterrupt(() =>
        finishUnrecoverableRun({
          run,
          task,
          status: "failed",
          reason: RUN_CUT_OFF_REASON,
          reasonCode: "startup_interrupted",
          interrupt: true,
        }).pipe(Effect.ignore),
      ),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* finishUnrecoverableRun({
            run,
            task,
            status: "failed",
            reason: `Couldn't start ${agent.name}${
              readableCauseReason(cause) === undefined ? "" : `: ${readableCauseReason(cause)}`
            }. Fix it in Settings, then retry.`,
            reasonCode: "startup_failed",
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

  const startMatchingAgents = Effect.fn("TaskAgentService.startMatchingAgents")(function* (
    agents: ReadonlyArray<TaskAgent>,
    task: Task,
    startCeiling?: RunModes | null,
  ) {
    const nowMs = Date.parse(yield* now);
    yield* Effect.forEach(
      agents.filter((agent) => startsForTask(agent, task, nowMs)),
      (agent) => startAgent(agent, task, startCeiling),
      { discard: true, concurrency: 1 },
    );
  });

  const reconcileTask = Effect.fn("TaskAgentService.reconcileTask")(function* ({
    task: queuedTask,
    reason,
    releasedRunId,
    startCeiling,
  }: TaskChangedInput) {
    // Archive and unarchive record their own history events in the repository.
    if (reason !== "run-finished" && reason !== "archived" && reason !== "unarchived") {
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
          else if (run.id === releasedRunId) yield* releaseRun(run, queuedTask);
        }),
      { discard: true, concurrency: 1 },
    );
    if (current === null) return;
    const agents = yield* repository.listAllAgents();
    yield* startMatchingAgents(agents, task, startCeiling);
    if (reason === "created" || reason === "updated") {
      const waiting = noMatchingAgentReason(agents, task, Date.parse(yield* now));
      if (waiting !== null && active.length === 0) {
        yield* appendEvent(
          task,
          "task.no-matching-agent",
          { reason: waiting },
          TaskEventId.make(`${task.id}:no-matching-agent:${task.triggerChangedAt}`),
        );
      }
    }
  });

  const reconcileAgent = Effect.fn("TaskAgentService.reconcileAgent")(function* ({
    agent,
    reason,
  }: TaskAgentChangedInput) {
    const runs = (yield* repository.listAllActiveAgentRuns()).filter(
      (run) => run.agentId === agent.id,
    );
    yield* Effect.forEach(
      runs,
      (run) =>
        Effect.gen(function* () {
          const task = Option.getOrNull(yield* repository.getById({ id: run.taskId }));
          const stopReason = reason === "deleted" ? "agent-deleted" : endingStopReason(agent, task);
          if (stopReason !== null) yield* stopActiveRun(run, stopReason);
        }),
      { discard: true, concurrency: 1 },
    );
    if (reason === "deleted" || !agent.enabled) return;
    yield* Effect.forEach(
      yield* repository.listTriggerCandidates(),
      (task) => startMatchingAgents([agent], task),
      { discard: true, concurrency: 1 },
    );
  });

  const recover = Effect.gen(function* () {
    yield* reconcileActiveRuns;
    const agents = (yield* repository.listAllAgents()).filter((agent) => agent.enabled);
    yield* Effect.forEach(
      yield* repository.listTriggerCandidates(),
      (task) => startMatchingAgents(agents, task),
      { discard: true, concurrency: 1 },
    );
  });

  /**
   * Message delivery for `messageRun`: `send` delivers the text as a turn;
   * `adopted` means a person's message already started the thread's next v2
   * run, at `startedAt`, so an active run is left alone and a continuation
   * starts from that v2 run instead of sending a turn of its own.
   */
  type RunMessage =
    | { readonly type: "send"; readonly text: string }
    | { readonly type: "adopted"; readonly startedAt: string };

  const continueRun = Effect.fn("TaskAgentService.continueRun")(function* (
    id: TaskAgentRunId,
    message: RunMessage,
  ) {
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
        if (task.archivedAt !== null)
          return refuse(`Task '${task.id}' is archived. Unarchive it before messaging its runs.`);
        const agentOption = yield* repository.getAgentById({ id: run.agentId });
        if (Option.isNone(agentOption)) return refuse(`Agent '${run.agentId}' was not found.`);
        const agent = agentOption.value;
        if (!agent.enabled)
          return refuse(
            `Agent '${agent.name}' (${agent.id}) is disabled. Enable it before messaging its runs.`,
          );

        // The same delivery a person's message gets: v2 steers a running turn
        // and otherwise starts a new run on the thread.
        const sendTurn = Effect.fn("TaskAgentService.sendTurn")(function* (
          messageId: MessageId,
          messageText: string,
        ) {
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
              `Couldn't send this to ${agent.name}: the run is still wrapping up. Try again in a moment; it then continues as a new run (run ${id}).`,
            );
          if (message.type === "send")
            yield* sendTurn(MessageId.make(yield* randomId("task-agent-message")), message.text);
          return { ok: true, run, continued: false } satisfies MessageRunResult;
        }

        const activeRefusal = (active: TaskAgentRun) =>
          refuse(
            `Couldn't send this to ${agent.name}: it is already working on this task in another run. Message that run instead (run ${active.id}, thread ${active.threadId}).`,
            active.id,
          );
        const findActive = repository.findActiveAgentRunForTaskAgent({
          taskId: task.id,
          agentId: agent.id,
        });
        const active = yield* findActive;
        if (Option.isSome(active)) return activeRefusal(active.value);
        const timestamp = message.type === "adopted" ? message.startedAt : yield* now;
        // Unarchived task and enabled agent are re-checked inside the insert, so a
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
            `Couldn't send this to ${agent.name}: the task was archived, or the agent was turned off or deleted, while the message was being sent.`,
          );

        if (message.type === "send") {
          pending.current = { continuation, task };
          const startedTask = Option.getOrElse(
            yield* repository
              .getById({ id: task.id })
              .pipe(Effect.orElseSucceed(() => Option.none<Task>())),
            () => task,
          );
          const sent = yield* Effect.exit(
            sendTurn(
              taskAgentRunMessageId(continuation.id),
              `Task-agent run continued:
This thread continues ended run ${run.id} (status "${run.status}") as a new run.
- agentRunId: ${continuation.id}
${claimLine(startedTask, continuation.id)}
Finish as before: release the task in your final task_update, or end with a fenced task_agent_result JSON block.

${message.text}`,
            ),
          );
          if (sent._tag === "Failure") {
            return {
              sendFailure: `Couldn't send this to ${agent.name}${
                readableCauseReason(sent.cause) === undefined
                  ? ""
                  : `: ${readableCauseReason(sent.cause)}`
              }. Try again in a moment.`,
            } as const;
          }
          pending.current = null;
        }
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
              reason: RUN_CUT_OFF_REASON,
              reasonCode: "continuation_interrupted",
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
          reasonCode: "continuation_failed",
          interrupt: false,
        }).pipe(Effect.ignore);
      }
      return refuse(outcome.sendFailure);
    }
    return outcome;
  });

  const messageRun: TaskAgentServiceShape["messageRun"] = ({ id, text }) =>
    continueRun(id, { type: "send", text });

  /**
   * A person's message that starts a v2 run in a task-agent run's thread
   * continues the thread's latest run as agent_run_message would. Where that
   * refuses (archived task, disabled agent, another active run), or the run is
   * still active, the message stays a plain chat turn.
   */
  const continueFromPersonMessage = Effect.fn("TaskAgentService.continueFromPersonMessage")(
    function* (v2Run: OrchestrationV2Run) {
      const latest = yield* repository.findLatestAgentRunByThreadId({ threadId: v2Run.threadId });
      if (Option.isNone(latest) || latest.value.completedAt === null) return;
      const { messages } = yield* threads.getThreadRecords(v2Run.threadId, ["messages"], {
        messageIds: [v2Run.userMessageId],
      });
      if (messages[0]?.createdBy !== "user") return;
      const result = yield* continueRun(latest.value.id, {
        type: "adopted",
        startedAt: iso(v2Run.requestedAt),
      });
      if (!result.ok)
        yield* Effect.logInfo("A person's message did not continue a task-agent run", {
          agentRunId: latest.value.id,
          reason: result.error,
        });
    },
  );

  /**
   * After a server restart only a thread's active task-agent run may continue,
   * and only its own v2 work, so the turn stays accounted, assigned and
   * stoppable. An ended run (whose provider may still hold native background
   * work) or one its agent or task now ends gets no turn outside a run.
   */
  const admitsRestartContinuation = Effect.fn("TaskAgentService.admitsRestartContinuation")(
    function* (input: Parameters<RestartContinuationGate>[0]) {
      const active = yield* repository.findActiveAgentRunByThreadId({ threadId: input.threadId });
      if (Option.isNone(active) || active.value.status.startsWith("finalizing:")) return false;
      const run = active.value;
      const agent = Option.getOrNull(yield* repository.getAgentById({ id: run.agentId }));
      const task = Option.getOrNull(yield* repository.getById({ id: run.taskId }));
      if (endingStopReason(agent, task) !== null) return false;
      const records = yield* readThreadRuns(input.threadId);
      const source = Option.isSome(records)
        ? records.value.runs.find((candidate) => candidate.id === input.sourceRunId)
        : undefined;
      return (
        source !== undefined &&
        DateTime.toEpochMillis(source.requestedAt) >= Date.parse(run.startedAt)
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Task-agent restart continuation refused: run state unreadable", {
            threadId: input.threadId,
            cause,
          }).pipe(Effect.as(false)),
        ),
      ),
  );

  // Decided and sent under the thread's lock, so a finalizer cannot end the
  // run between the decision and the turn. Threads no run used are not ours.
  yield* registerRestartContinuationGate((input, send) =>
    Effect.gen(function* () {
      const owned = yield* repository
        .findLatestAgentRunByThreadId({ threadId: input.threadId })
        .pipe(
          Effect.map(Option.isSome),
          // Unreadable: the admission below refuses what it cannot confirm.
          Effect.orElseSucceed(() => true),
        );
      if (!owned) return yield* Effect.as(send, true);
      return yield* withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (!(yield* admitsRestartContinuation(input))) return false;
          yield* send;
          return true;
        }),
      );
    }),
  );

  const stopRun: TaskAgentServiceShape["stopRun"] = Effect.fn("TaskAgentService.stopRun")(
    function* ({ id }) {
      const run = yield* repository.getAgentRunById({ id });
      if (Option.isNone(run)) return run;
      if (run.value.completedAt === null) yield* stopActiveRun(run.value, "stop-requested");
      return yield* repository.getAgentRunById({ id });
    },
  );

  // A v2 run reaching a terminal status settles the task-agent run on its
  // thread right away; the periodic pass below covers missed events and
  // grace periods. A v2 run a person's message starts may continue an ended
  // run first; events are handled in order, so it is recorded before it ends.
  yield* threads.streamDomainEvents.pipe(
    Stream.filter(
      (event) =>
        event.type === "run.created" ||
        (event.type === "run.updated" &&
          !isActiveRun(event.payload) &&
          event.payload.status !== "queued"),
    ),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (event.type === "run.created") {
          yield* continueFromPersonMessage(event.payload);
          return;
        }
        if (event.type !== "run.updated") return;
        const active = yield* repository.findActiveAgentRunByThreadId({
          threadId: event.threadId,
        });
        if (Option.isSome(active)) yield* reconcileRun(active.value, yield* now);
        // Only v2 work of the thread's latest task-agent run, once that run
        // has ended; later plain conversation in the thread keeps its session.
        const latest = yield* repository.findLatestAgentRunByThreadId({
          threadId: event.threadId,
        });
        const requestedAt = DateTime.toEpochMillis(event.payload.requestedAt);
        if (
          Option.isSome(latest) &&
          latest.value.completedAt !== null &&
          Date.parse(latest.value.startedAt) <= requestedAt &&
          requestedAt <= Date.parse(latest.value.completedAt)
        ) {
          yield* releaseEndedRunSessions(event.threadId);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to handle a v2 run event for task-agent runs", { cause }),
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
