import {
  TASK_STATUS_CHANGED_EVENT,
  TaskEventId,
  TaskStatusChangedPayload,
  type TaskAgentRunId,
  type TaskId,
} from "@t3tools/tasks-contracts/v1";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import type { AgentRunReasonCode } from "../telemetry/agentRuns.ts";
import type { TaskChangedInput } from "./TaskAgentService.ts";
import {
  parseTaskAgentResultMarkdown,
  type ParsedTaskAgentResultEvent,
} from "./TaskAgentResultParser.ts";

function eventKind(value: string | null): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `task.agent-result.${normalized}` : "task.agent-result.note";
}

const decodeStatusChange = Schema.decodeUnknownOption(TaskStatusChangedPayload);

/** Status names compare without case or spacing: "done" only respells "Done". */
function sameStatus(left: string, right: string): boolean {
  const normalize = (status: string) => status.trim().replace(/\s+/g, " ").toLowerCase();
  return normalize(left) === normalize(right);
}

/** Whether the run itself changed the task status, e.g. with task_update. */
const runChangedTaskStatus = (
  repository: TaskRepositoryShape,
  taskId: TaskId,
  runId: TaskAgentRunId,
) =>
  repository.events({ taskId, kinds: [TASK_STATUS_CHANGED_EVENT], limit: 200 }).pipe(
    Effect.map(({ events }) =>
      events.some((event) => {
        const change = decodeStatusChange(event.payload);
        return (
          Option.isSome(change) &&
          change.value.actor.type === "agent-run" &&
          change.value.actor.agentRunId === runId
        );
      }),
    ),
  );

/** The fields read from a v1 or v2 conversation message. */
interface AssistantMessageLike {
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
}

export function latestFinalizedAssistantMessage<M extends AssistantMessageLike>(
  messages: ReadonlyArray<M>,
): M | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message !== undefined &&
      message.role === "assistant" &&
      !message.streaming &&
      message.text.trim()
    )
      return message;
  }
  return undefined;
}

/**
 * Finalizes the thread's active run from a task_agent_result block. Returns
 * whether the markdown contained a valid result for that run; finalization itself is
 * claimed once, so concurrent callers cannot double-finalize.
 */
export const makeTaskAgentResultConsumer =
  (deps: {
    readonly repository: TaskRepositoryShape;
    readonly scheduleTaskChanged: (input: TaskChangedInput) => Effect.Effect<void>;
    readonly recordRunFinished?: (input: {
      readonly runId: TaskAgentRunId;
      readonly reasonCode: AgentRunReasonCode;
    }) => Effect.Effect<void>;
  }) =>
  (input: { readonly threadId: ThreadId; readonly markdown: string; readonly createdAt: string }) =>
    Effect.gen(function* () {
      const { repository } = deps;
      const result = parseTaskAgentResultMarkdown(input.markdown);
      if (!result) return false;
      const active = yield* repository.findActiveAgentRunByThreadId({ threadId: input.threadId });
      if (Option.isNone(active)) return true;
      const run = active.value;
      // A continuation shares its thread; the run it continues reported this result.
      if (Date.parse(input.createdAt) < Date.parse(run.startedAt)) return false;
      const finalizingStatus = "finalizing:result";
      const claimed = yield* repository.claimAgentRunFinalization({
        id: run.id,
        finalizingStatus,
      });
      if (!claimed) return true;
      const taskOption = yield* repository.getById({ id: run.taskId });
      const recordFinished = (finalized: boolean, reasonCode: AgentRunReasonCode) =>
        finalized && deps.recordRunFinished !== undefined
          ? deps.recordRunFinished({ runId: run.id, reasonCode })
          : Effect.void;
      if (Option.isNone(taskOption)) {
        const finalized = yield* repository.finalizeAgentRun({
          id: run.id,
          finalizingStatus,
          status: "failed",
          completedAt: input.createdAt,
          taskId: run.taskId,
          releaseAssignment: true,
          events: [],
        });
        yield* recordFinished(finalized, "task_deleted");
        return true;
      }
      const task = taskOption.value;
      const reportedStatus = result.status ?? (result.blocked ? "blocked" : null);
      // The result block reports; it never overwrites a status the run set
      // itself during the run, and a respelling of the current status is no change.
      const targetStatus =
        reportedStatus === null ||
        sameStatus(reportedStatus, task.status) ||
        (yield* runChangedTaskStatus(repository, task.id, run.id))
          ? null
          : reportedStatus;
      const summary =
        result.summary ??
        (reportedStatus
          ? `Task agent reported status "${reportedStatus}".`
          : "Task agent completed.");
      const events = [
        {
          id: TaskEventId.make(`${run.id}:task-agent-result`),
          taskId: task.id,
          kind: "task.agent-result",
          payload: {
            source: "task_agent_result",
            agentId: run.agentId,
            agentRunId: run.id,
            threadId: input.threadId,
            status: reportedStatus,
            blocked: result.blocked,
            summary,
          },
          createdAt: input.createdAt,
        },
        ...result.events.map((agentEvent: ParsedTaskAgentResultEvent, index) => ({
          id: TaskEventId.make(`${run.id}:task-agent-result:${index}`),
          taskId: task.id,
          kind: eventKind(agentEvent.kind),
          payload: {
            source: "task_agent_result",
            agentRunId: run.id,
            threadId: input.threadId,
            message: agentEvent.message,
            payload: agentEvent.payload,
          },
          createdAt: input.createdAt,
        })),
      ];
      const statusChanged = targetStatus !== null && targetStatus !== task.status;
      const finalized = yield* repository.finalizeAgentRun({
        id: run.id,
        finalizingStatus,
        status: result.blocked ? "blocked" : "completed",
        completedAt: input.createdAt,
        taskId: task.id,
        ...(targetStatus !== null ? { taskStatus: targetStatus } : {}),
        taskOutput: summary,
        releaseAssignment: true,
        events,
      });
      yield* recordFinished(finalized, result.blocked ? "result_blocked" : "result");
      // A blocked run can start agents waiting on run statuses even when the
      // task status stays the same.
      if (finalized && (statusChanged || result.blocked)) {
        const updated = yield* repository.getById({ id: task.id });
        if (Option.isSome(updated)) {
          yield* deps.scheduleTaskChanged({
            task: updated.value,
            reason: statusChanged ? "updated" : "run-finished",
          });
        }
      }
      return true;
    });
