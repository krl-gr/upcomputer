import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskEventId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const at = "2026-11-19T10:00:00.000Z";

const event = (id: string, taskId: string) => ({
  id: TaskEventId.make(id),
  taskId: TaskId.make(taskId),
  kind: "note",
  payload: { text: id },
  createdAt: at,
});

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

it.layer(TaskRepositoryLive.pipe(Layer.provideMerge(database)))("Task events", (it) => {
  it.effect("belong to an existing task and go when it is deleted", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const missing = yield* Effect.exit(repository.appendEvent(event("lost", "task-made-up")));
      assert.isTrue(Exit.isFailure(missing));
      assert.deepStrictEqual(
        (yield* repository.events({ taskId: TaskId.make("task-made-up") })).events,
        [],
      );

      yield* repository.upsert({
        id: TaskId.make("task-real"),
        projectId: ProjectId.make("project"),
        title: "Real",
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
        createdAt: at,
        updatedAt: at,
      });
      yield* repository.appendEvent(event("kept", "task-real"));
      const stored = (yield* repository.events({ taskId: TaskId.make("task-real") })).events;
      assert.isTrue(stored.some(({ id }) => id === "kept"));

      yield* repository.deleteTask({ id: TaskId.make("task-real") });
      assert.deepStrictEqual(
        (yield* repository.events({ taskId: TaskId.make("task-real") })).events,
        [],
      );
    }),
  );
});
