/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { TaskAgentId, TaskAgentRunId, TaskId, type Task } from "@upcomputer/tasks-contracts/v1";
import { MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  ExperimentalProviderRuntimeEvents,
  ProjectionSnapshotQuery,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import { TaskAgentResultConsumerLive } from "./TaskAgentResultConsumer.ts";
import { TaskAgentService, type TaskAgentServiceShape } from "./TaskAgentService.ts";

test("startup recovery persists a completed task-agent result before reconciling runs", async () => {
  const createdAt = "2026-09-15T10:00:00.000Z";
  const threadId = ThreadId.make("task-agent-thread-completed");
  const run = {
    id: TaskAgentRunId.make("task-agent-run-completed"),
    taskId: TaskId.make("task-completed"),
    agentId: TaskAgentId.make("agent-completed"),
    threadId,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    status: "running",
    startedAt: createdAt,
    completedAt: null,
    triggerRunId: null,
  } as const;
  const task: Task = {
    id: run.taskId,
    rank: "0000000100000000" as Task["rank"],
    projectId: ProjectId.make("project-completed"),
    title: "Persist completion",
    description: "",
    output: null,
    status: "In Progress",
    priority: null,
    createdBy: "agent",
    assigneeAgentRunId: run.id,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: ["upcomputer-dev"],
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    notBefore: null,
    triggerChangedAt: createdAt,
  };
  let active = true;
  const updates: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  const lifecycle: string[] = [];
  const repository = {
    listAllActiveAgentRuns: () => Effect.sync(() => (active ? [run] : [])),
    findActiveAgentRunByThreadId: () =>
      Effect.sync(() => (active ? Option.some(run) : Option.none())),
    getById: () => Effect.succeed(Option.some(task)),
    claimAgentRunFinalization: () => Effect.succeed(active),
    finalizeAgentRun: (input: Record<string, unknown>) =>
      Effect.sync(() => {
        lifecycle.push("complete");
        completions.push(input);
        updates.push({
          id: task.id,
          status: input.taskStatus,
          output: input.taskOutput,
        });
        active = false;
        return true;
      }),
  } as unknown as TaskRepositoryShape;
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskAgentService, {
      scheduleTaskChanged: () => Effect.void,
      scheduleAgentChanged: () => Effect.void,
      stopRun: () => Effect.succeed(Option.none()),
      recover: Effect.sync(() => {
        lifecycle.push("recover");
      }),
    } satisfies TaskAgentServiceShape),
    Layer.succeed(ExperimentalProviderRuntimeEvents, { stream: Stream.empty }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            messages: [
              {
                id: MessageId.make("assistant-result"),
                role: "assistant",
                text: `~~~task_agent_result\n{"status":"Needs Agent Review","summary":"Verified completion.","blocked":false,"events":[]}\n~~~`,
                turnId: null,
                streaming: false,
                createdAt,
                updatedAt: createdAt,
              },
            ],
          }),
        ),
    } as never),
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(TaskAgentResultConsumerLive.pipe(Layer.provide(dependencies)));
        yield* Effect.sleep("50 millis");
      }),
    ),
  );

  NodeAssert.deepEqual(updates, [
    { id: task.id, status: "Needs Agent Review", output: "Verified completion." },
  ]);
  NodeAssert.equal(completions[0]?.status, "completed");
  NodeAssert.deepEqual(lifecycle, ["complete", "recover"]);
});

test("a result consumer that loses finalization ownership performs no task mutation", async () => {
  const createdAt = "2026-09-15T10:00:00.000Z";
  const threadId = ThreadId.make("task-agent-thread-lost-result-race");
  const run = {
    id: TaskAgentRunId.make("task-agent-run-lost-result-race"),
    taskId: TaskId.make("task-lost-result-race"),
    agentId: TaskAgentId.make("agent-lost-result-race"),
    threadId,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    status: "running",
    startedAt: createdAt,
    completedAt: null,
    triggerRunId: null,
  } as const;
  let taskReads = 0;
  let finalizations = 0;
  const repository = {
    listAllActiveAgentRuns: () => Effect.succeed([run]),
    findActiveAgentRunByThreadId: () => Effect.succeed(Option.some(run)),
    claimAgentRunFinalization: () => Effect.succeed(false),
    getById: () =>
      Effect.sync(() => {
        taskReads += 1;
        return Option.none();
      }),
    finalizeAgentRun: () =>
      Effect.sync(() => {
        finalizations += 1;
        return true;
      }),
  } as unknown as TaskRepositoryShape;
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskAgentService, {
      scheduleTaskChanged: () => Effect.void,
      scheduleAgentChanged: () => Effect.void,
      stopRun: () => Effect.succeed(Option.none()),
      recover: Effect.void,
    } satisfies TaskAgentServiceShape),
    Layer.succeed(ExperimentalProviderRuntimeEvents, { stream: Stream.empty }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            messages: [
              {
                id: MessageId.make("assistant-lost-result-race"),
                role: "assistant",
                text: `~~~task_agent_result\n{"status":"Needs Review","summary":"Must not win.","blocked":false,"events":[]}\n~~~`,
                turnId: null,
                streaming: false,
                createdAt,
                updatedAt: createdAt,
              },
            ],
          }),
        ),
    } as never),
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(TaskAgentResultConsumerLive.pipe(Layer.provide(dependencies)));
        yield* Effect.sleep("50 millis");
      }),
    ),
  );

  NodeAssert.equal(taskReads, 0);
  NodeAssert.equal(finalizations, 0);
});
