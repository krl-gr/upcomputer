import type { Task, TaskAgent, TaskAgentRun, TaskAgentRunId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import { AnalyticsService, ProviderRegistry } from "../../../../apps/server/src/extensionApi.ts";
import type { TaskRepositoryShape } from "../persistence/TaskRepository.ts";

/**
 * Why a run ended, decided where it ends. Free text (a blocker, a provider
 * error) stays in the task's history; only these codes leave the server.
 */
export type AgentRunReasonCode =
  // The run released its task with task_update, or ended with a task_agent_result.
  | "released"
  | "released_blocked"
  | "result"
  | "result_blocked"
  // A person, a task or agent change, or the end of its v2 turn stopped it.
  | "stop_requested"
  | "session_stopped"
  | "turn_interrupted"
  | "task_archived"
  | "task_deleted"
  | "agent_disabled"
  | "agent_deleted"
  // A stop or failure a restart found half written and finished.
  | "finalization_resumed"
  | "finalization_incomplete"
  | "thread_missing"
  | "start_timeout"
  | "startup_failed"
  | "startup_interrupted"
  | "continuation_failed"
  | "continuation_interrupted"
  | "provider_failed"
  | "no_result";

const OUTCOMES = new Set(["completed", "failed", "blocked", "interrupted", "stopped"]);

/**
 * What started the run. Scheduled tasks and webhooks start chat turns, not
 * runs; a run on a task an automation created counts as `schedule`.
 */
export function agentRunTrigger(input: {
  readonly run: Pick<TaskAgentRun, "triggerRunId" | "continuesRunId">;
  readonly task: Pick<Task, "metadata"> | null;
  readonly agent: Pick<TaskAgent, "startTags"> | null;
}): "failure_handler" | "message" | "schedule" | "tag" | "status" {
  if (input.run.triggerRunId !== null) return "failure_handler";
  if (input.run.continuesRunId !== null) return "message";
  const metadata = input.task?.metadata;
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "source" in metadata &&
    metadata.source === "automation"
  )
    return "schedule";
  return (input.agent?.startTags.length ?? 0) > 0 ? "tag" : "status";
}

/**
 * Records `agent_run.finished` for a run its caller just finalized. Best
 * effort: a run whose details cannot be read is not reported, and recording
 * never fails the finalization.
 */
export const makeAgentRunFinishedRecorder = Effect.fn("makeAgentRunFinishedRecorder")(function* (
  repository: TaskRepositoryShape,
) {
  const analytics = yield* Effect.serviceOption(AnalyticsService);
  const providers = yield* Effect.serviceOption(ProviderRegistry);
  const sql = yield* Effect.serviceOption(SqlClient.SqlClient);
  return (input: { readonly runId: TaskAgentRunId; readonly reasonCode: AgentRunReasonCode }) =>
    Option.isNone(analytics)
      ? Effect.void
      : Effect.gen(function* () {
          const found = yield* repository.getAgentRunById({ id: input.runId });
          if (Option.isNone(found)) return;
          const run = found.value;
          if (!OUTCOMES.has(run.status) || run.completedAt === null) return;
          const task = Option.getOrNull(yield* repository.getById({ id: run.taskId }));
          const agent = Option.getOrNull(yield* repository.getAgentById({ id: run.agentId }));
          // Instance ids are user-chosen, so only the driver behind one is sent.
          const provider = Option.isSome(providers)
            ? (yield* providers.value.getProviders).find(
                (candidate) => candidate.instanceId === run.modelSelection.instanceId,
              )?.driver
            : undefined;
          const isBot = Option.isSome(sql)
            ? (yield* sql.value<{ readonly found: number }>`
                  SELECT 1 AS found FROM bots WHERE agent_id = ${run.agentId}`).length > 0
            : false;
          yield* analytics.value.record("agent_run.finished", {
            outcome: run.status,
            reasonCode: input.reasonCode,
            provider: provider ?? "unknown",
            durationMs: Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt)),
            trigger: agentRunTrigger({ run, task, agent }),
            isBot,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logDebug("agent_run.finished not recorded", {
              agentRunId: input.runId,
              cause,
            }),
          ),
        );
});
