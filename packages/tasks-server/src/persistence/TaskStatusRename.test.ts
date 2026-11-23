import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  TASK_STATUS_CHANGED_EVENT,
  TaskAutomationId,
  TaskId,
  type TaskAutomation,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository, type PersistTaskInput } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const timestamp = "2026-11-20T10:00:00.000Z";
const alpha = ProjectId.make("project-alpha");
const beta = ProjectId.make("project-beta");

const TestLayer = TaskRepositoryLive.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
  ),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

const task = (id: string, overrides: Partial<PersistTaskInput> = {}): PersistTaskInput => ({
  id: TaskId.make(id),
  projectId: alpha,
  title: id,
  description: "",
  output: null,
  status: "Backlog",
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
  ...overrides,
});

const automation = (id: string, projectId: ProjectId, status: string): TaskAutomation => ({
  id: TaskAutomationId.make(id),
  projectId,
  name: id,
  status: "enabled",
  schedule: { cron: "0 9 * * *", timezone: "UTC" },
  template: { title: id, description: "", status, priority: null, tags: [] },
  catchUpPolicy: "fire-once",
  skipIfOpen: true,
  createdBy: "user",
  sourceThreadId: null,
  nextRunAt: null,
  lastFiredAt: null,
  lastFiredSlot: null,
  lastTaskId: null,
  lastError: null,
  failureCount: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
});

it.layer(TestLayer)("renameTaskStatus", (it) => {
  it.effect("relabels every match in one call, keeps triggers and records the rename", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      for (let index = 0; index < 120; index += 1)
        yield* repository.upsert(
          task(`bulk-${index}`, { status: index % 2 ? "backlog" : "Backlog" }),
        );
      yield* repository.upsert(task("other", { status: "To Do" }));
      const before = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("bulk-0") }));

      const result = yield* repository.renameTaskStatus({
        from: "Backlog",
        to: "Queued",
        actor: { type: "thread", threadId: "thread-bot" as never },
      });

      assert.strictEqual(result.renamed.length, 120);
      const after = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("bulk-0") }));
      assert.strictEqual(after.status, "Queued");
      assert.strictEqual(after.triggerChangedAt, before.triggerChangedAt);
      const other = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("other") }));
      assert.strictEqual(other.status, "To Do");
      const { events } = yield* repository.events({
        taskId: TaskId.make("bulk-1"),
        kinds: [TASK_STATUS_CHANGED_EVENT],
      });
      assert.deepInclude(events[0]?.payload as object, {
        from: "backlog",
        to: "Queued",
        rename: true,
      });

      // The returned ids rename them back: the rename can be undone.
      const back = yield* repository.renameTaskStatus({
        from: "Queued",
        to: "Backlog",
        ids: result.renamed,
        actor: { type: "server" },
      });
      assert.strictEqual(back.renamed.length, 120);
    }),
  );

  it.effect("narrows to ids, a project or tags, and skips person tasks it would break", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(task("n-a", { status: "Needs Input", tags: ["dev"] }));
      yield* repository.upsert(task("n-b", { status: "Needs Input" }));
      yield* repository.upsert(task("n-c", { status: "Needs Input", projectId: beta }));
      yield* repository.upsert(task("p-todo", { status: "To Do", audience: "person" }));

      const byTag = yield* repository.renameTaskStatus({
        from: "Needs Input",
        to: "Needs You",
        tags: ["dev"],
        actor: { type: "server" },
      });
      assert.deepStrictEqual(byTag.renamed, [TaskId.make("n-a")]);
      const byProject = yield* repository.renameTaskStatus({
        from: "Needs Input",
        to: "Needs You",
        projectId: beta,
        actor: { type: "server" },
      });
      assert.deepStrictEqual(byProject.renamed, [TaskId.make("n-c")]);
      const preview = yield* repository.renameTaskStatus({
        from: "Needs Input",
        to: "Needs You",
        ids: [TaskId.make("n-b")],
        dryRun: true,
        actor: { type: "server" },
      });
      assert.deepStrictEqual(preview.renamed, [TaskId.make("n-b")]);
      const untouched = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("n-b") }));
      assert.strictEqual(untouched.status, "Needs Input");

      const person = yield* repository.renameTaskStatus({
        from: "To Do",
        to: "Queued",
        ids: [TaskId.make("p-todo")],
        actor: { type: "server" },
      });
      assert.deepStrictEqual(person.renamed, []);
      assert.strictEqual(person.skipped[0]?.id, TaskId.make("p-todo"));
    }),
  );

  it.effect("renames automation templates only when asked, within the project", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsertAutomation(automation("auto-a", alpha, "Needs Review"));
      yield* repository.upsertAutomation(automation("auto-b", beta, "Needs Review"));
      const templateStatus = (id: string) =>
        repository
          .getAutomationById({ id: TaskAutomationId.make(id) })
          .pipe(Effect.map((found) => Option.getOrThrow(found).template.status));

      yield* repository.renameTaskStatus({
        from: "Needs Review",
        to: "To Verify",
        actor: { type: "server" },
      });
      assert.strictEqual(yield* templateStatus("auto-a"), "Needs Review");

      const result = yield* repository.renameTaskStatus({
        from: "Needs Review",
        to: "To Verify",
        projectId: alpha,
        automationTemplates: true,
        actor: { type: "server" },
      });
      assert.deepStrictEqual(result.automations, ["auto-a"]);
      assert.strictEqual(yield* templateStatus("auto-a"), "To Verify");
      assert.strictEqual(yield* templateStatus("auto-b"), "Needs Review");
    }),
  );
});
