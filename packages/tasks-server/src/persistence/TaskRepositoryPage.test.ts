import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  TaskAgentId,
  TaskAgentRunId,
  TaskAutomationId,
  TaskId,
  TaskRank,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository, type PersistTaskInput } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const timestamp = "2026-10-05T10:00:00.000Z";
const project = ProjectId.make("project-1");

const database = Layer.effectDiscard(
  runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const TestLayer = TaskRepositoryLive.pipe(Layer.provideMerge(database));

const task = (id: string, tags: string[] = [], overrides: Partial<PersistTaskInput> = {}) => ({
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
  ...overrides,
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

  it.effect("filter by audience, kind and excluded statuses; facets follow audience and kind", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task("f-agent", [], { status: "Backlog" }));
      yield* repository.upsert(task("f-mine", [], { audience: "person" }));
      yield* repository.upsert(task("f-done", [], { audience: "person", status: "Done" }));
      yield* repository.upsert(
        task("f-routine", [], { audience: "person", kind: "routine", status: "Done" }),
      );

      const ids = (input: Parameters<typeof repository.page>[0]) =>
        repository
          .page({ limit: 50, ...input })
          .pipe(
            Effect.map((page) =>
              page.tasks.map((item) => item.id).filter((id) => id.startsWith("f-")),
            ),
          );
      assert.deepStrictEqual(
        (yield* ids({})).toSorted(),
        ["f-agent", "f-done", "f-mine"],
        "all audiences, no routines",
      );
      assert.deepStrictEqual(yield* ids({ audience: "agent" }), ["f-agent"]);
      // The planner's active list.
      assert.deepStrictEqual(yield* ids({ audience: "person", excludeStatuses: ["Done"] }), [
        "f-mine",
      ]);
      assert.deepStrictEqual(yield* ids({ kind: "routine" }), ["f-routine"]);
      const searched = yield* repository.search({ audience: "person", status: "Done" });
      assert.deepStrictEqual(
        searched.map(({ id }) => id),
        ["f-done"],
      );

      const personPage = yield* repository.page({ audience: "person", status: "Done" });
      assert.include(personPage.statuses, "To Do", "facets ignore the selected status");
      assert.notInclude(personPage.statuses, "Backlog", "facets follow the audience");
      const routinePage = yield* repository.page({ kind: "routine" });
      assert.deepStrictEqual(routinePage.statuses, ["Done"], "facets follow the kind");
    }),
  );

  it.effect("kind all lists tasks and routines together under the other filters", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const routine = { audience: "person", kind: "routine" } as const;
      // A new task joins the end, so these are created first to last.
      yield* repository.upsert(task("k-1-task"));
      yield* repository.upsert(task("k-2-routine", ["gym"], routine));
      yield* repository.upsert(task("k-3-mine", ["gym"], { audience: "person" }));
      yield* repository.upsert(
        task("k-4-old", [], { ...routine, archivedAt: "2026-10-05T11:00:00.000Z" }),
      );
      yield* repository.upsert(task("k-5-routine", [], routine));

      const ids = (input: Parameters<typeof repository.search>[0]) =>
        repository
          .search({ limit: 500, ...input })
          .pipe(
            Effect.map((tasks) =>
              tasks.map(({ id }) => id as string).filter((id) => id.startsWith("k-")),
            ),
          );
      assert.deepStrictEqual(yield* ids({}), ["k-1-task", "k-3-mine"], "routines stay out");
      assert.deepStrictEqual(yield* ids({ kind: "routine" }), ["k-2-routine", "k-5-routine"]);
      // Global rank order across kinds.
      assert.deepStrictEqual(yield* ids({ kind: "all" }), [
        "k-1-task",
        "k-2-routine",
        "k-3-mine",
        "k-5-routine",
      ]);
      assert.deepStrictEqual(yield* ids({ kind: "all", archive: "all" }), [
        "k-1-task",
        "k-2-routine",
        "k-3-mine",
        "k-4-old",
        "k-5-routine",
      ]);
      assert.deepStrictEqual(yield* ids({ kind: "all", audience: "agent" }), ["k-1-task"]);
      assert.deepStrictEqual(yield* ids({ kind: "all", tags: ["gym"] }), [
        "k-2-routine",
        "k-3-mine",
      ]);
      const first = yield* repository.page({ kind: "all", projectId: project, limit: 2 });
      assert.isNotNull(first.nextCursor);
      assert.include(first.statuses, "To Do");
    }),
  );

  it.effect("filter on createdBy: one automation's tasks, or none of any automation's", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task("c-manual", [], { createdBy: "agent" }));
      yield* repository.upsert(task("c-a1", [], { createdBy: "automation:task-automation-a" }));
      yield* repository.upsert(
        task("c-a2", [], {
          createdBy: "automation:task-automation-a",
          archivedAt: "2026-10-05T11:00:00.000Z",
        }),
      );
      yield* repository.upsert(task("c-b", [], { createdBy: "automation:task-automation-b" }));
      // Only the prefix counts; a person's creator name that mentions automations does not.
      yield* repository.upsert(task("c-person", [], { createdBy: "Automation:x" }));

      const ids = (input: Parameters<typeof repository.page>[0]) =>
        repository.page({ limit: 50, ...input }).pipe(
          Effect.map((page) =>
            page.tasks
              .map((item) => item.id as string)
              .filter((id) => id.startsWith("c-"))
              .toSorted(),
          ),
        );
      assert.deepStrictEqual(yield* ids({ excludeAutomationTasks: true }), [
        "c-manual",
        "c-person",
      ]);
      assert.deepStrictEqual(yield* ids({ createdBy: "automation:task-automation-a" }), ["c-a1"]);
      assert.deepStrictEqual(
        yield* ids({ createdBy: "automation:task-automation-a", archive: "all" }),
        ["c-a1", "c-a2"],
      );
      assert.deepStrictEqual(
        (yield* repository.search({ excludeAutomationTasks: true }))
          .map(({ id }) => id as string)
          .filter((id) => id.startsWith("c-"))
          .toSorted(),
        ["c-manual", "c-person"],
      );

      const counts = yield* repository.countAutomationTasks({
        ids: ["task-automation-a", "task-automation-b", "task-automation-none"].map((id) =>
          TaskAutomationId.make(id),
        ),
      });
      assert.deepStrictEqual(Object.fromEntries(counts), {
        "task-automation-a": 2,
        "task-automation-b": 1,
        "task-automation-none": 0,
      });
    }),
  );

  it.effect("reorderMany moves a block in its current order, next to a neighbor or first", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      // Each create appends, so the global order is the creation order.
      for (const id of ["rm1", "rm2", "rm3", "rm4", "rm5", "rm6"])
        yield* repository.upsert(task(id));
      const order = () =>
        repository
          .page({ limit: 50 })
          .pipe(
            Effect.map((page) =>
              page.tasks.map((item) => item.id as string).filter((id) => id.startsWith("rm")),
            ),
          );
      assert.deepStrictEqual(yield* order(), ["rm1", "rm2", "rm3", "rm4", "rm5", "rm6"]);

      const moved = yield* repository.reorderMany({
        ids: [TaskId.make("rm5"), TaskId.make("rm2")],
        afterTaskId: TaskId.make("rm3"),
      });
      assert.deepStrictEqual(
        moved.map(({ id }) => id),
        ["rm2", "rm5"],
      );
      assert.deepStrictEqual(yield* order(), ["rm1", "rm3", "rm2", "rm5", "rm4", "rm6"]);

      yield* repository.reorderMany({ ids: [TaskId.make("rm6"), TaskId.make("rm4")] });
      assert.deepStrictEqual((yield* order()).slice(0, 2), ["rm4", "rm6"], "first by default");

      yield* repository.reorderMany({
        ids: [TaskId.make("rm1"), TaskId.make("rm3")],
        beforeTaskId: TaskId.make("rm6"),
      });
      assert.deepStrictEqual(yield* order(), ["rm4", "rm1", "rm3", "rm6", "rm2", "rm5"]);

      const ownNeighbor = yield* Effect.flip(
        repository.reorderMany({ ids: [TaskId.make("rm1")], afterTaskId: TaskId.make("rm1") }),
      );
      assert.equal(ownNeighbor._tag, "TaskPersistenceSqlError");
      yield* Effect.flip(repository.reorderMany({ ids: [TaskId.make("missing")] }));
      assert.deepStrictEqual(yield* order(), ["rm4", "rm1", "rm3", "rm6", "rm2", "rm5"]);
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
