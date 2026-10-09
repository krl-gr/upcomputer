import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId, TaskRank } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const timestamp = "2026-10-05T10:00:00.000Z";
const project = ProjectId.make("project-1");

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = TaskRepositoryLive.pipe(Layer.provideMerge(database));

const task = (id: string, tags: string[] = []) => ({
  id: TaskId.make(id),
  projectId: project,
  title: id,
  description: "",
  output: null,
  status: "To Do",
  priority: null,
  createdBy: "test",
  assigneeAgentRunId: null,
  sourceThreadId: null,
  sourceRunId: null,
  metadata: null,
  tags,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
});

const run = (id: string, taskId: string, status: string, startedAt: string) => ({
  id: TaskAgentRunId.make(id),
  taskId: TaskId.make(taskId),
  agentId: TaskAgentId.make(`agent-${id}`),
  threadId: ThreadId.make(`thread-${id}`),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  status,
  startedAt,
  completedAt: status === "running" ? null : startedAt,
  triggerRunId: null,
  continuesRunId: null,
});

it.layer(TestLayer)("TaskRepository list items", (it) => {
  it.effect("carry the status of each task's latest run only", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task("retried"));
      yield* repository.upsert(task("idle"));
      // An older failed run, then a newer completed one.
      yield* repository.createAgentRun(
        run("r-old", "retried", "failed", "2026-10-05T10:00:00.000Z"),
      );
      yield* repository.createAgentRun(
        run("r-new", "retried", "completed", "2026-10-05T11:00:00.000Z"),
      );

      const page = yield* repository.page({ limit: 10 });
      const byId = new Map(page.tasks.map((item) => [item.id, item]));
      assert.equal(byId.get(TaskId.make("retried"))?.latestRunStatus, "completed");
      assert.equal(byId.get(TaskId.make("idle"))?.latestRunStatus, null);

      const items = yield* repository.items({ ids: [TaskId.make("retried")] });
      assert.equal(items.tasks[0]?.latestRunStatus, "completed");
    }),
  );

  it.effect("filter by tags with AND: a task needs every requested tag", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task("both", ["browser-use", "ui"]));
      yield* repository.upsert(task("one", ["browser-use"]));
      yield* repository.upsert(task("other", ["ui", "dev-2"]));

      const ids = (tags: string[]) =>
        repository
          .page({ tags, limit: 10 })
          .pipe(Effect.map((page) => page.tasks.map((item) => item.id).toSorted()));
      assert.deepStrictEqual(yield* ids(["browser-use", "ui"]), ["both"]);
      assert.deepStrictEqual(yield* ids(["browser-use"]), ["both", "one"]);
    }),
  );
});

it.layer(TestLayer)("TaskRepository order", (it) => {
  it.effect("new tasks join the end, so a queue created in order runs in that order", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({ ...task("first", ["dev"]), status: "To Do" });
      yield* repository.upsert({ ...task("second", ["dev"]), status: "Backlog" });
      yield* repository.upsert(task("unrelated"));
      yield* repository.upsert({ ...task("third", ["dev"]), status: "Backlog" });

      const ids = (input: Parameters<typeof repository.search>[0]) =>
        repository.search(input).pipe(Effect.map((tasks) => tasks.map(({ id }) => id)));
      assert.deepStrictEqual(yield* ids({}), ["first", "second", "unrelated", "third"]);
      // The hand-off takes the head of this list.
      assert.deepStrictEqual(yield* ids({ status: "Backlog", tags: ["dev"] }), ["second", "third"]);

      // An explicit reorder still decides, and the next new task goes after everything.
      yield* repository.reorder({ id: TaskId.make("third"), beforeTaskId: TaskId.make("second") });
      yield* repository.upsert({ ...task("fourth", ["dev"]), status: "Backlog" });
      assert.deepStrictEqual(yield* ids({ status: "Backlog", tags: ["dev"] }), [
        "third",
        "second",
        "fourth",
      ]);
    }),
  );

  it.effect("appending at the end of the rank space rebalances", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({ ...task("last"), rank: TaskRank.make("fffffffffffffffe") });
      yield* repository.upsert(task("after-last"));

      const tasks = yield* repository.search({});
      assert.deepStrictEqual(tasks.map(({ id }) => id).slice(-2), ["last", "after-last"]);
      assert.isBelow(tasks.at(-1)!.rank.localeCompare("fffffffffffffffe"), 0);
    }),
  );
});
