import {
  DEFAULT_AUTOMATION_CATCH_UP_POLICY,
  TASK_AGENTS_RPC_METHODS,
  TASK_AGENTS_RPC_NAMESPACE,
  TASK_AUTOMATIONS_RPC_METHODS,
  TASK_AUTOMATIONS_RPC_NAMESPACE,
  TASKS_RPC_METHODS,
  TASKS_RPC_NAMESPACE,
  TaskAgentId,
  TaskAgentsRpcGroup,
  TaskAutomationId,
  TaskAutomationsRpcGroup,
  TaskError,
  TaskEventId,
  TaskId,
  TasksRpcGroup,
  type TaskAutomation,
} from "@upcomputer/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import { releasedRunId, TaskAgentService } from "../agents/TaskAgentService.ts";
import {
  armAutomationSchedule,
  normalizeAutomationTemplate,
} from "../automations/automationWrites.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";

const OWNER_ID = "upcomputer.tasks" as const;
const now = Effect.map(DateTime.now, DateTime.formatIso);

function taskError(message: string, cause?: unknown) {
  return new TaskError({ message, ...(cause === undefined ? {} : { cause }) });
}

function asTaskRpc<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskError ? cause : taskError("Task operation failed.", cause),
    ),
  );
}

export const TASKS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "tasks-rpc-v1",
  ownerId: OWNER_ID,
  version: 1,
  namespace: TASKS_RPC_NAMESPACE,
  group: TasksRpcGroup,
  handlers: () =>
    TasksRpcGroup.toLayer(
      TasksRpcGroup.of({
        [TASKS_RPC_METHODS.create]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const agents = yield* TaskAgentService;
              const crypto = yield* Crypto.Crypto;
              const timestamp = yield* now;
              const id = input.id ?? TaskId.make(`task-${yield* crypto.randomUUIDv4}`);
              const task = yield* repository.upsert({
                id,
                projectId: input.projectId,
                title: input.title,
                description: input.description,
                output: input.output ?? null,
                status: input.status,
                priority: input.priority ?? null,
                createdBy: input.createdBy ?? "user",
                assigneeAgentRunId: input.assigneeAgentRunId ?? null,
                sourceThreadId: input.sourceThreadId ?? null,
                sourceRunId: input.sourceRunId ?? null,
                metadata: input.metadata ?? null,
                tags: input.tags ?? [],
                notBefore: input.notBefore ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
                closedAt: null,
              });
              yield* agents.scheduleTaskChanged({ task, reason: "created" });
              return task;
            }),
          ),
        [TASKS_RPC_METHODS.search]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              return { tasks: yield* repository.search(input) };
            }),
          ),
        [TASKS_RPC_METHODS.page]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).page(input);
            }),
          ),
        [TASKS_RPC_METHODS.runCounts]: () =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).runCounts();
            }),
          ),
        [TASKS_RPC_METHODS.threadRunCounts]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).threadRunCounts(input);
            }),
          ),
        [TASKS_RPC_METHODS.threadTasks]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).threadTasks(input);
            }),
          ),
        [TASKS_RPC_METHODS.items]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).items(input);
            }),
          ),
        [TASKS_RPC_METHODS.subscribe]: () =>
          Stream.unwrap(
            asTaskRpc(
              Effect.gen(function* () {
                return (yield* TaskRepository).changes;
              }),
            ),
          ),
        [TASKS_RPC_METHODS.get]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return Option.getOrNull(yield* (yield* TaskRepository).getById(input));
            }),
          ),
        [TASKS_RPC_METHODS.update]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const agents = yield* TaskAgentService;
              const before = yield* repository.getById({ id: input.id });
              const task = yield* repository.update(input);
              yield* agents.scheduleTaskChanged({
                task,
                reason: "updated",
                releasedRunId: Option.isSome(before)
                  ? releasedRunId({
                      before: before.value,
                      after: task,
                      requestedAssignee: input.assigneeAgentRunId,
                      callerRun: null,
                    })
                  : null,
              });
              return task;
            }),
          ),
        [TASKS_RPC_METHODS.reorder]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskRepository).reorder(input);
            }),
          ),
        [TASKS_RPC_METHODS.delete]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const agents = yield* TaskAgentService;
              const existing = yield* repository.getById(input);
              yield* repository.deleteTask(input);
              if (Option.isSome(existing)) {
                yield* agents.scheduleTaskChanged({ task: existing.value, reason: "deleted" });
              }
            }),
          ),
        [TASKS_RPC_METHODS.addTag]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const agents = yield* TaskAgentService;
              const task = yield* repository.addTag({ ...input, updatedAt: yield* now });
              yield* agents.scheduleTaskChanged({ task, reason: "tag-added" });
              return task;
            }),
          ),
        [TASKS_RPC_METHODS.removeTag]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const agents = yield* TaskAgentService;
              const task = yield* repository.removeTag({ ...input, updatedAt: yield* now });
              yield* agents.scheduleTaskChanged({ task, reason: "tag-removed" });
              return task;
            }),
          ),
        [TASKS_RPC_METHODS.appendEvent]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const crypto = yield* Crypto.Crypto;
              return yield* repository.appendEvent({
                id: input.id ?? TaskEventId.make(`task-event-${yield* crypto.randomUUIDv4}`),
                taskId: input.taskId,
                kind: input.kind,
                payload: input.payload ?? null,
                createdAt: yield* now,
              });
            }),
          ),
        [TASKS_RPC_METHODS.getPromptSettings]: () =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskPromptSettingsStore).get;
            }),
          ),
        [TASKS_RPC_METHODS.updatePromptSettings]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              return yield* (yield* TaskPromptSettingsStore).update(input);
            }),
          ),
      }),
    ),
});

const TASK_AGENTS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "task-agents-rpc-v1",
  ownerId: OWNER_ID,
  version: 1,
  namespace: TASK_AGENTS_RPC_NAMESPACE,
  group: TaskAgentsRpcGroup,
  handlers: () =>
    TaskAgentsRpcGroup.toLayer(
      TaskAgentsRpcGroup.of({
        [TASK_AGENTS_RPC_METHODS.upsert]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const taskAgents = yield* TaskAgentService;
              const crypto = yield* Crypto.Crypto;
              const timestamp = yield* now;
              const id = input.id ?? TaskAgentId.make(`task-agent-${yield* crypto.randomUUIDv4}`);
              const existing = yield* repository.getAgentById({ id });
              const agent = yield* repository.upsertAgent({
                id,
                projectId: input.projectId ?? null,
                name: input.name,
                enabled: input.enabled ?? true,
                startStatuses: input.startStatuses ?? [],
                startTags: input.startTags ?? [],
                startRunStatuses: input.startRunStatuses ?? [],
                config: input.config,
                createdAt: Option.isSome(existing) ? existing.value.createdAt : timestamp,
                updatedAt: timestamp,
              });
              yield* taskAgents.scheduleAgentChanged({ agent, reason: "upserted" });
              return agent;
            }),
          ),
        [TASK_AGENTS_RPC_METHODS.search]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              return { agents: yield* repository.searchAgents(input) };
            }),
          ),
        [TASK_AGENTS_RPC_METHODS.delete]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const taskAgents = yield* TaskAgentService;
              const existing = yield* repository.getAgentById(input);
              yield* repository.deleteAgent(input);
              if (Option.isSome(existing)) {
                yield* taskAgents.scheduleAgentChanged({
                  agent: existing.value,
                  reason: "deleted",
                });
              }
            }),
          ),
        [TASK_AGENTS_RPC_METHODS.searchRuns]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              return { runs: yield* repository.searchAgentRuns(input) };
            }),
          ),
      }),
    ),
});

const TASK_AUTOMATIONS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "task-automations-rpc-v1",
  ownerId: OWNER_ID,
  version: 1,
  namespace: TASK_AUTOMATIONS_RPC_NAMESPACE,
  group: TaskAutomationsRpcGroup,
  handlers: () =>
    TaskAutomationsRpcGroup.toLayer(
      TaskAutomationsRpcGroup.of({
        [TASK_AUTOMATIONS_RPC_METHODS.upsert]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const status = input.status ?? "draft";
              const repository = yield* TaskRepository;
              const crypto = yield* Crypto.Crypto;
              const timestamp = yield* now;
              const id =
                input.id ?? TaskAutomationId.make(`task-automation-${yield* crypto.randomUUIDv4}`);
              const existing = yield* repository.getAutomationById({ id });
              const armed = armAutomationSchedule(input.schedule, status, new Date(timestamp));
              if (Result.isFailure(armed)) return yield* Effect.fail(taskError(armed.failure));
              return yield* repository.upsertAutomation({
                id,
                projectId: input.projectId,
                name: input.name,
                status,
                schedule: input.schedule,
                template: normalizeAutomationTemplate(
                  input.template,
                  Option.isSome(existing) ? existing.value.template : undefined,
                ),
                catchUpPolicy: input.catchUpPolicy ?? DEFAULT_AUTOMATION_CATCH_UP_POLICY,
                skipIfOpen: input.skipIfOpen ?? true,
                createdBy:
                  input.createdBy ?? (Option.isSome(existing) ? existing.value.createdBy : "user"),
                sourceThreadId:
                  input.sourceThreadId ??
                  (Option.isSome(existing) ? existing.value.sourceThreadId : null),
                nextRunAt: armed.success,
                lastFiredAt: Option.isSome(existing) ? existing.value.lastFiredAt : null,
                lastFiredSlot: Option.isSome(existing) ? existing.value.lastFiredSlot : null,
                lastTaskId: Option.isSome(existing) ? existing.value.lastTaskId : null,
                lastError: null,
                failureCount: 0,
                createdAt: Option.isSome(existing) ? existing.value.createdAt : timestamp,
                updatedAt: timestamp,
              });
            }),
          ),
        [TASK_AUTOMATIONS_RPC_METHODS.setStatus]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              const existing = yield* repository.getAutomationById({ id: input.id });
              if (Option.isNone(existing)) {
                return yield* Effect.fail(taskError(`Automation '${input.id}' was not found.`));
              }
              const timestamp = yield* now;
              const armed = armAutomationSchedule(
                existing.value.schedule,
                input.status,
                new Date(timestamp),
              );
              if (Result.isFailure(armed)) return yield* Effect.fail(taskError(armed.failure));
              const next: TaskAutomation = {
                ...existing.value,
                status: input.status,
                nextRunAt: armed.success,
                lastError: null,
                failureCount: 0,
                updatedAt: timestamp,
              };
              return yield* repository.upsertAutomation(next);
            }),
          ),
        [TASK_AUTOMATIONS_RPC_METHODS.search]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              return { automations: yield* repository.searchAutomations(input) };
            }),
          ),
        [TASK_AUTOMATIONS_RPC_METHODS.delete]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              yield* repository.deleteAutomation(input);
            }),
          ),
        [TASK_AUTOMATIONS_RPC_METHODS.searchRuns]: (input) =>
          asTaskRpc(
            Effect.gen(function* () {
              const repository = yield* TaskRepository;
              return { runs: yield* repository.searchAutomationRuns(input) };
            }),
          ),
      }),
    ),
});

export const TASK_RPC_CONTRIBUTIONS = [
  TASKS_RPC_CONTRIBUTION,
  TASK_AGENTS_RPC_CONTRIBUTION,
  TASK_AUTOMATIONS_RPC_CONTRIBUTION,
] as const;
