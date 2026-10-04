import { TaskEventId } from "@t3tools/tasks-contracts/v1";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TaskRepositoryShape } from "../persistence/TaskRepository.ts";
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
      if (Option.isNone(taskOption)) {
        yield* repository.finalizeAgentRun({
          id: run.id,
          finalizingStatus,
          status: "failed",
          completedAt: input.createdAt,
          taskId: run.taskId,
          releaseAssignment: true,
          events: [],
        });
        return true;
      }
      const task = taskOption.value;
      const targetStatus = result.status ?? (result.blocked ? "blocked" : null);
      const summary =
        result.summary ??
        (targetStatus ? `Task agent reported status "${targetStatus}".` : "Task agent completed.");
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
            status: targetStatus,
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
