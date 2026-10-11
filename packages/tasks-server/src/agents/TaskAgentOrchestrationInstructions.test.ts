import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { orchestrationInstructionsFor } from "../../../provider-core/src/server/orchestrationInstructions.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskAgentOrchestrationInstructionsLive } from "./TaskAgentOrchestrationInstructions.ts";

const timestamp = "2026-10-11T10:00:00.000Z";
const project = ProjectId.make("project-orchestration");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = TaskAgentOrchestrationInstructionsLive.pipe(
  Layer.provideMerge(TaskRepositoryLive.pipe(Layer.provideMerge(database))),
);

it.layer(TestLayer)("Orchestration block for task-agent runs", (it) => {
  it.effect("follows the run's agent tool list and leaves other threads alone", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const taskId = TaskId.make("task-orchestration");
      yield* repository.upsert({
        id: taskId,
        projectId: project,
        title: "Orchestration block",
        description: "",
        output: null,
        status: "To Do",
        priority: null,
        createdBy: "test",
        assigneeAgentRunId: null,
        sourceThreadId: null,
        sourceRunId: null,
        metadata: null,
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      });
      const runThread = (name: string, tools: ReadonlyArray<string> | undefined) =>
        Effect.gen(function* () {
          yield* repository.upsertAgent({
            id: TaskAgentId.make(name),
            projectId: project,
            name,
            enabled: true,
            startStatuses: ["To Do"],
            startTags: [],
            startRunStatuses: [],
            config: {
              role: name,
              modelSelection,
              instructions: "Test",
              ...(tools === undefined ? {} : { tools }),
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          const threadId = ThreadId.make(`thread-${name}`);
          yield* repository.createAgentRun({
            id: TaskAgentRunId.make(`run-${name}`),
            taskId,
            agentId: TaskAgentId.make(name),
            threadId,
            modelSelection,
            status: "running",
            startedAt: timestamp,
            completedAt: null,
            triggerRunId: null,
            continuesRunId: null,
          });
          return threadId;
        });

      const developer = yield* runThread("developer", [
        "read",
        "bash",
        "edit",
        "task_get",
        "task_update",
        "task_event_append",
      ]);
      const delegating = yield* runThread("delegating", ["read", "mcp__t3-code__delegate_task"]);
      const unrestricted = yield* runThread("unrestricted", undefined);

      assert.isFalse(yield* orchestrationInstructionsFor(developer));
      assert.isTrue(yield* orchestrationInstructionsFor(delegating));
      assert.isTrue(yield* orchestrationInstructionsFor(unrestricted));
      assert.isTrue(yield* orchestrationInstructionsFor(ThreadId.make("thread-chat")));
    }),
  );
});
