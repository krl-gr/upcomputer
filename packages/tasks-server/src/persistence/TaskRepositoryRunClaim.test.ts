import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const timestamp = "2026-10-11T10:00:00.000Z";
const later = "2026-10-11T10:05:00.000Z";
const project = ProjectId.make("project-claim");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = TaskRepositoryLive.pipe(Layer.provideMerge(database));

const agent = (id: string) => ({
  id: TaskAgentId.make(id),
  projectId: project,
  name: id,
  enabled: true,
  startStatuses: ["To Do"],
  startTags: [],
  startRunStatuses: [],
  config: { role: "developer", modelSelection, instructions: "Test" },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const run = (id: string, taskId: TaskId, agentId: string, completedAt: string | null = null) => ({
  id: TaskAgentRunId.make(id),
  taskId,
  agentId: TaskAgentId.make(agentId),
  threadId: ThreadId.make(`thread-${id}`),
  modelSelection,
  status: completedAt === null ? "running" : "completed",
  startedAt: timestamp,
  completedAt,
  triggerRunId: null,
  continuesRunId: null,
});

it.layer(TestLayer)("Starting a task-agent run", (it) => {
  it.effect("claims the task unless another active run holds it", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const taskId = TaskId.make("task-claim");
      yield* repository.upsertAgent(agent("developer"));
      yield* repository.upsertAgent(agent("reviewer"));
      yield* repository.upsertAgent(agent("doctor"));
      yield* repository.upsert({
        id: taskId,
        projectId: project,
        title: "Claim at start",
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
      const assignee = repository
        .getById({ id: taskId })
        .pipe(Effect.map((task) => Option.getOrThrow(task).assigneeAgentRunId));

      yield* repository.startAgentRun({ ...run("first", taskId, "developer"), startableAt: null });
      assert.strictEqual(yield* assignee, "first");

      // Another agent's run starting meanwhile leaves the active holder alone.
      yield* repository.startAgentRun({ ...run("second", taskId, "reviewer"), startableAt: null });
      assert.strictEqual(yield* assignee, "first");

      // A holder whose run already ended does not keep the task from a new run.
      yield* repository.createAgentRun(run("ended", taskId, "doctor", later));
      yield* repository.update({
        id: taskId,
        assigneeAgentRunId: "ended",
        actor: { type: "server" },
      });
      yield* repository.startAgentRun({ ...run("third", taskId, "doctor"), startableAt: null });
      assert.strictEqual(yield* assignee, "third");
    }),
  );
});
