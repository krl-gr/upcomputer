import {
  TaskAgentRunId,
  TaskEventId,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
  type TaskPromptSettings,
} from "@upcomputer/tasks-contracts/v1";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ThreadId,
  type OrchestrationCommand,
} from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import {
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../access/retryOperational.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
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

export interface TaskAgentServiceShape {
  readonly scheduleTaskChanged: (input: TaskChangedInput) => Effect.Effect<void>;
  readonly scheduleAgentChanged: (input: TaskAgentChangedInput) => Effect.Effect<void>;
  /** Stops an active run as `stopped`. None when the run does not exist. */
  readonly stopRun: (input: {
    readonly id: TaskAgentRunId;
  }) => Effect.Effect<Option.Option<TaskAgentRun>, unknown>;
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

export class TaskAgentService extends Context.Service<TaskAgentService, TaskAgentServiceShape>()(
  "@upcomputer/tasks-server/agents/TaskAgentService",
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

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourcePlan(task: Task) {
  if (metadataString(task.metadata, "source") !== "orchestrationProposal") return undefined;
  const planId = metadataString(task.metadata, "proposalId");
  return planId && task.sourceThreadId ? { threadId: task.sourceThreadId, planId } : undefined;
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

const make = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const promptSettings = yield* TaskPromptSettingsStore;
  const orchestration = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const jobs = yield* Queue.bounded<ReconciliationJob>(RECONCILIATION_QUEUE_CAPACITY);

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
        Effect.logWarning("Failed to append private task lifecycle event", {
          taskId: task.id,
          kind,
          cause,
        }),
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
    readonly stopSession: boolean;
    readonly terminalSession?: {
      readonly status: "error" | "interrupted";
      readonly reason: string;
    };
    readonly taskOutput?: string | null;
    readonly events?: ReadonlyArray<{
      readonly id: TaskEventId;
      readonly taskId: Task["id"];
      readonly kind: string;
      readonly payload: unknown;
      readonly createdAt: string;
    }>;
  }) =>
    Effect.gen(function* () {
      const timestamp = yield* now;
      const claimed = yield* repository.claimAgentRunFinalization({
        id: input.run.id,
        finalizingStatus: input.finalizingStatus,
      });
      if (!claimed) return false;
      const thread = yield* projections.getThreadDetailById(input.run.threadId);
      if (input.terminalSession !== undefined && Option.isSome(thread)) {
        const session = thread.value.session;
        if (
          session?.status !== "stopped" &&
          (session?.status !== input.terminalSession.status ||
            session.activeTurnId !== null ||
            session.lastError !== input.terminalSession.reason)
        ) {
          yield* orchestration.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(yield* randomId("task-agent-session-terminal")),
            threadId: input.run.threadId,
            session: {
              threadId: input.run.threadId,
              status: input.terminalSession.status,
              providerName: session?.providerName ?? null,
              ...(session?.providerInstanceId !== undefined
                ? { providerInstanceId: session.providerInstanceId }
                : {}),
              runtimeMode: session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
              activeTurnId: null,
              lastError: input.terminalSession.reason,
              updatedAt: timestamp,
            },
            createdAt: timestamp,
          });
        }
      }
      if (
        input.stopSession &&
        Option.isSome(thread) &&
        thread.value.session !== null &&
        thread.value.session.status !== "stopped"
      ) {
        yield* orchestration.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.make(yield* randomId("task-agent-session-stop")),
          threadId: input.run.threadId,
          createdAt: timestamp,
        });
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
    });

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
        stopSession: true,
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
        Effect.logWarning("Failed to schedule a finished private task-agent run", {
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
    readonly stopSession: boolean;
  }) =>
    Effect.gen(function* () {
      const timestamp = yield* now;
      let taskOutput: string | null | undefined;
      const events = [];
      if (input.task !== null) {
        const recovery =
          "Review the run, then change the task's status, tags or notBefore to retry.";
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
        stopSession: input.stopSession,
        terminalSession: {
          status: input.status === "interrupted" ? "interrupted" : "error",
          reason: input.reason,
        },
        ...(taskOutput !== undefined ? { taskOutput } : {}),
        events,
      });
      if (finalized && input.task !== null) yield* scheduleRunFinished(input.task.id);
    });

  const reconcileActiveRuns = (startup: boolean) =>
    Effect.gen(function* () {
      const activeRuns = yield* repository.listAllActiveAgentRuns();
      const timestamp = yield* now;
      yield* Effect.forEach(
        activeRuns,
        (run) =>
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

            const thread = yield* projections.getThreadDetailById(run.threadId);
            if (Option.isNone(thread)) {
              // startAgent persists the run before it dispatches thread.create, so a
              // live reconciliation tick can see a fresh run before its thread exists.
              if (
                !startup &&
                run.status === "running" &&
                Date.parse(timestamp) - Date.parse(run.startedAt) <=
                  PENDING_SESSION_START_TIMEOUT_MS
              ) {
                return;
              }
              const intendedStatus =
                run.status === "finalizing:interrupted"
                  ? "interrupted"
                  : run.status === "finalizing:failed"
                    ? "failed"
                    : null;
              yield* finishUnrecoverableRun({
                run,
                task: currentTask,
                status: intendedStatus ?? "failed",
                reason:
                  intendedStatus === "interrupted"
                    ? "The app restarted while this run was active. Provider callbacks and pending approvals cannot be resumed safely."
                    : "The task-agent execution thread is missing.",
                stopSession: false,
              });
              return;
            }

            const session = thread.value.session;
            const sessionStatus = session?.status ?? null;
            if (run.status === "finalizing:interrupted" || run.status === "finalizing:failed") {
              const intendedStatus =
                run.status === "finalizing:interrupted" ? "interrupted" : "failed";
              yield* finishUnrecoverableRun({
                run,
                task: currentTask,
                status: intendedStatus,
                reason:
                  session?.lastError?.trim() ||
                  (intendedStatus === "interrupted"
                    ? "The app restarted while this run was active. Provider callbacks and pending approvals cannot be resumed safely."
                    : "The provider run failed before finalization completed."),
                stopSession: sessionStatus !== null && sessionStatus !== "stopped",
              });
              return;
            }
            const persistedInFlight =
              sessionStatus === "starting" ||
              sessionStatus === "running" ||
              session?.activeTurnId != null ||
              sessionStatus === null;
            if (startup && persistedInFlight) {
              yield* finishUnrecoverableRun({
                run,
                task: currentTask,
                status: "interrupted",
                reason:
                  "The app restarted while this run was active. Provider callbacks and pending approvals cannot be resumed safely.",
                stopSession: sessionStatus !== null && sessionStatus !== "stopped",
              });
              return;
            }

            // A person stopping the session is a deliberate stop, not a failure;
            // a stop that follows a failed interrupt keeps its error.
            if (sessionStatus === "stopped" && !session?.lastError?.trim()) {
              yield* stopActiveRun(run, "session-stopped");
              return;
            }
            if (
              sessionStatus === "error" ||
              sessionStatus === "stopped" ||
              sessionStatus === "interrupted"
            ) {
              yield* finishUnrecoverableRun({
                run,
                task: currentTask,
                status: "failed",
                reason:
                  session?.lastError?.trim() ||
                  `The provider session reached terminal state '${sessionStatus}'.`,
                stopSession: false,
              });
              return;
            }
            if (sessionStatus === "ready" && session !== null && session.activeTurnId == null) {
              // The result event may lack its text, so read the finalized reply from the thread.
              const message = latestFinalizedAssistantMessage(thread.value.messages);
              if (
                message !== undefined &&
                (yield* consumeResult({
                  threadId: run.threadId,
                  markdown: message.text,
                  createdAt: message.updatedAt,
                }))
              ) {
                return;
              }
              if (
                startup ||
                Date.parse(timestamp) - Date.parse(session.updatedAt) >
                  PENDING_RESULT_CONSUMPTION_TIMEOUT_MS
              ) {
                // Same grace period: a person may continue the interrupted thread.
                if (thread.value.latestTurn?.state === "interrupted") {
                  yield* stopActiveRun(run, "turn-interrupted");
                  return;
                }
                yield* finishUnrecoverableRun({
                  run,
                  task: currentTask,
                  status: "failed",
                  reason: "The provider turn ended without a valid task-agent result.",
                  // The idle provider session is still alive and can resume background work.
                  stopSession: true,
                });
              }
              return;
            }
            if (
              sessionStatus === null &&
              Date.parse(timestamp) - Date.parse(run.startedAt) > PENDING_SESSION_START_TIMEOUT_MS
            ) {
              yield* finishUnrecoverableRun({
                run,
                task: currentTask,
                status: "failed",
                reason: "The provider session did not start before the task-agent timeout.",
                stopSession: false,
              });
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to reconcile active private task-agent run", {
                agentRunId: run.id,
                cause,
              }),
            ),
          ),
        { discard: true, concurrency: 1 },
      );
    });

  /**
   * Run-status agents start for an unhandled terminal run of another agent;
   * every other agent starts on task state, subject to `runsAgain`.
   */
  const startAgent = (agent: TaskAgent, task: Task) =>
    Effect.gen(function* () {
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
        const triggerThread = yield* projections.getThreadDetailById(triggerRun.value.threadId);
        trigger = {
          run: triggerRun.value,
          agentName: Option.isSome(triggerAgent) ? triggerAgent.value.name : null,
          reason: Option.isSome(triggerThread)
            ? triggerThread.value.session?.lastError?.trim() || null
            : null,
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
      const settings = yield* promptSettings.get;
      const threadId = ThreadId.make(yield* randomId("task-agent"));
      const runId = TaskAgentRunId.make(yield* randomId("task-agent-run"));
      const runtimeMode = agent.config.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode = agent.config.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
      const modelSelection = agent.config.modelSelection;
      const title = `${agent.name}: ${task.title}`;

      const run = yield* repository
        .createAgentRun({
          id: runId,
          taskId: task.id,
          agentId: agent.id,
          threadId,
          modelSelection,
          status: "running",
          startedAt: timestamp,
          completedAt: null,
          triggerRunId: trigger?.run.id ?? null,
        })
        .pipe(
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
        const create: OrchestrationCommand = {
          type: "thread.create",
          commandId: CommandId.make(yield* randomId("task-agent-thread-create")),
          threadId,
          projectId: task.projectId,
          title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: null,
          worktreePath: null,
          sidebarVisible: false,
          createdAt: timestamp,
        };
        const turn: OrchestrationCommand = {
          type: "thread.turn.start",
          commandId: CommandId.make(yield* randomId("task-agent-turn-start")),
          threadId,
          message: {
            messageId: MessageId.make(yield* randomId("task-agent-message")),
            role: "user",
            text: prompt(agent, task, run.id, threadId, settings, globalPosition, trigger),
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          ...(sourcePlan(task) ? { sourceProposedPlan: sourcePlan(task) } : {}),
          createdAt: timestamp,
        };
        yield* orchestration.dispatch(create);
        yield* orchestration.dispatch(turn);
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
            stopSession: true,
          }).pipe(Effect.ignore),
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* finishUnrecoverableRun({
              run,
              task,
              status: "failed",
              reason: `Task-agent provider startup failed: ${String(cause)}`,
              stopSession: true,
            }).pipe(Effect.ignore);
            yield* Effect.logError("Failed to start private task agent", {
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

  const reconcileTask = ({ task, reason, releasedRunId }: TaskChangedInput) =>
    Effect.gen(function* () {
      if (reason !== "run-finished") {
        yield* appendEvent(task, `task.${reason}`, { status: task.status, tags: task.tags });
      }
      const active = yield* repository.listActiveAgentRunsForTask({ id: task.id });
      yield* Effect.forEach(
        active,
        (run) =>
          Effect.gen(function* () {
            const agent = Option.getOrNull(yield* repository.getAgentById({ id: run.agentId }));
            const stopReason =
              reason === "deleted" ? "task-deleted" : endingStopReason(agent, task);
            if (stopReason !== null) yield* stopActiveRun(run, stopReason);
            else if (run.id === releasedRunId) yield* stopActiveRun(run, "released");
          }),
        { discard: true, concurrency: 1 },
      );
      if (reason === "deleted") return;
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
    yield* reconcileActiveRuns(true);
    const agents = (yield* repository.listAllAgents()).filter((agent) => agent.enabled);
    yield* Effect.forEach(
      yield* repository.listAllTasks(),
      (task) => startMatchingAgents(agents, task),
      { discard: true, concurrency: 1 },
    );
  });

  const stopRun: TaskAgentServiceShape["stopRun"] = ({ id }) =>
    Effect.gen(function* () {
      const run = yield* repository.getAgentRunById({ id });
      if (Option.isNone(run)) return run;
      if (run.value.completedAt === null) yield* stopActiveRun(run.value, "stop-requested");
      return yield* repository.getAgentRunById({ id });
    });

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.sleep(ACTIVE_RUN_RECONCILIATION_INTERVAL).pipe(
        Effect.andThen(reconcileActiveRuns(false)),
      ),
    ),
  );

  // Wakes tasks whose notBefore passed since the previous sweep. Tasks already
  // due at startup are covered by `recover`.
  let notBeforeSweptUntil = yield* now;
  yield* Effect.forkScoped(
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
              Effect.logWarning("Failed to wake private tasks reaching notBefore", { cause }),
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
  yield* Effect.forkScoped(Effect.forever(Queue.take(jobs).pipe(Effect.flatMap(process))));

  return {
    scheduleTaskChanged,
    scheduleAgentChanged: (input) =>
      Queue.offer(jobs, { type: "agent", input }).pipe(Effect.asVoid),
    stopRun,
    recover,
  } satisfies TaskAgentServiceShape;
});

export const TaskAgentServiceLive = Layer.effect(TaskAgentService, make);
