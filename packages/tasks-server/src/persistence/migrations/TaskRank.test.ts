/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, test } from "vite-plus/test";

import { ProjectId, ThreadId, ProviderInstanceId } from "@upcomputer/contracts";
import { TaskId, TaskAgentId, TaskAgentRunId } from "@upcomputer/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";

import { runExperimentalFeatureMigrations } from "../../../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { TaskRepository } from "../TaskRepository.ts";
import { TaskRepositoryLive } from "../TaskRepositoryLive.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./index.ts";

const directories: string[] = [];
const timestamp = "2026-08-12T00:00:00.000Z";

function pathFor(name: string): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upcomputer-task-rank-"));
  directories.push(directory);
  return NodePath.join(directory, name);
}

async function migrate(
  path: string,
  count: number = TASK_MIGRATION_CONTRIBUTION.migrations.length,
) {
  await Effect.runPromise(
    runExperimentalFeatureMigrations([
      {
        ...TASK_MIGRATION_CONTRIBUTION,
        migrations: TASK_MIGRATION_CONTRIBUTION.migrations.slice(0, count),
      },
    ]).pipe(Effect.provide(NodeSqliteClient.layer({ filename: path }))),
  );
}

function runRepository<A>(path: string, effect: Effect.Effect<A, any, TaskRepository>) {
  const sql = NodeSqliteClient.layer({ filename: path });
  return Effect.runPromise(
    effect.pipe(Effect.provide(TaskRepositoryLive.pipe(Layer.provide(sql)))),
  );
}

function input(id: string, status = "Backlog") {
  return {
    id: TaskId.make(id),
    projectId: ProjectId.make("project-1"),
    title: id,
    description: "description",
    output: null,
    status,
    priority: null,
    createdBy: "test",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    metadata: { retained: true },
    tags: ["rank-test"],
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: null,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

test("migration backfills ranks in the former visible order without changing task data", async () => {
  const path = pathFor("migration.sqlite");
  await migrate(path, 7);
  const db = new NodeSqlite.DatabaseSync(path);
  const insert = db.prepare(`INSERT INTO tasks (
    id, project_id, title, description, output, status, priority, created_by,
    assignee_worker_id, source_thread_id, source_run_id, metadata_json,
    created_at, updated_at, closed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run(
    "older",
    "project-1",
    "Older",
    "keep",
    "output",
    "Backlog",
    "high",
    "user",
    "run-1",
    "thread-1",
    "source-1",
    '{"keep":true}',
    timestamp,
    timestamp,
    null,
  );
  insert.run(
    "newer",
    "project-2",
    "Newer",
    "keep too",
    null,
    "To Do",
    null,
    "agent",
    null,
    null,
    null,
    "null",
    timestamp,
    "2026-08-12T01:00:00.000Z",
    null,
  );
  db.close();

  await migrate(path);
  const migrated = new NodeSqlite.DatabaseSync(path);
  const rows = migrated.prepare("SELECT * FROM tasks ORDER BY rank ASC, id ASC").all() as Array<
    Record<string, unknown>
  >;
  migrated.close();
  NodeAssert.deepEqual(
    rows.map(({ id }) => id),
    ["newer", "older"],
  );
  NodeAssert.match(String(rows[0]?.rank), /^[0-9a-f]{16}$/);
  NodeAssert.equal(rows[1]?.source_thread_id, "thread-1");
  NodeAssert.equal(rows[1]?.source_run_id, "source-1");
  NodeAssert.equal(rows[1]?.output, "output");
  NodeAssert.equal(rows[1]?.assignee_worker_id, "run-1");
  NodeAssert.equal(rows[1]?.metadata_json, '{"keep":true}');
});

test("prepend, filtered search, field updates, semantic reorder, and exhaustion rebalance preserve one global order", async () => {
  const path = pathFor("repository.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(input("c"));
      yield* repository.upsert(input("b", "To Do"));
      yield* repository.upsert(input("a"));
      const initial = yield* repository.listAllTasks();
      NodeAssert.deepEqual(
        initial.map(({ id }) => id),
        ["a", "b", "c"],
      );

      const originalRank = initial[0]!.rank;
      const updated = yield* repository.update({ id: TaskId.make("a"), status: "Needs Review" });
      NodeAssert.equal(updated.rank, originalRank);
      NodeAssert.deepEqual(
        (yield* repository.search({ status: "Backlog" })).map(({ id }) => id),
        ["c"],
      );

      yield* repository.reorder({ id: TaskId.make("c"), beforeTaskId: TaskId.make("a") });
      NodeAssert.deepEqual(
        (yield* repository.listAllTasks()).map(({ id }) => id),
        ["c", "a", "b"],
      );
      yield* repository.reorder({ id: TaskId.make("c"), afterTaskId: TaskId.make("b") });
      NodeAssert.deepEqual(
        (yield* repository.listAllTasks()).map(({ id }) => id),
        ["a", "b", "c"],
      );
    }),
  );

  const db = new NodeSqlite.DatabaseSync(path);
  db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run("0000000000000001", "a");
  db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run("0000000000000002", "b");
  db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run("0000000000000003", "c");
  db.close();

  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.reorder({
        id: TaskId.make("c"),
        afterTaskId: TaskId.make("a"),
        beforeTaskId: TaskId.make("b"),
      });
      const tasks = yield* repository.listAllTasks();
      NodeAssert.deepEqual(
        tasks.map(({ id }) => id),
        ["a", "c", "b"],
      );
      NodeAssert.equal(new Set(tasks.map(({ rank }) => rank)).size, 3);

      yield* repository.upsert(input("d"));
      yield* Effect.all(
        [
          repository.reorder({
            id: TaskId.make("c"),
            afterTaskId: TaskId.make("a"),
            beforeTaskId: TaskId.make("b"),
          }),
          repository.reorder({
            id: TaskId.make("d"),
            afterTaskId: TaskId.make("a"),
            beforeTaskId: TaskId.make("b"),
          }),
        ],
        { concurrency: "unbounded" },
      );
      const concurrent = yield* repository.listAllTasks();
      NodeAssert.equal(new Set(concurrent.map(({ rank }) => rank)).size, 4);
      NodeAssert.equal(concurrent[0]?.id, "a");
      NodeAssert.equal(concurrent.at(-1)?.id, "b");
      NodeAssert.deepEqual(
        new Set(concurrent.slice(1, -1).map(({ id }) => id)),
        new Set(["c", "d"]),
      );
    }),
  );
});

test("filtered cursor pages cover all 248 tasks, retain status facets, and continue after concurrent changes", async () => {
  const path = pathFor("pages.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      // The only working task is deliberately last in rank order.
      yield* repository.upsert(input("working", "in progress"));
      for (let index = 0; index < 247; index += 1)
        yield* repository.upsert(input(`backlog-${index}`));
      const first = yield* repository.page({ limit: 100 });
      NodeAssert.equal(first.tasks.length, 100);
      NodeAssert.equal(first.tasks[0]?.id, "backlog-246");
      NodeAssert.ok(first.statuses.includes("in progress"));
      NodeAssert.ok(first.nextCursor);
      const second = yield* repository.page({ limit: 100, cursor: first.nextCursor! });
      const third = yield* repository.page({ limit: 100, cursor: second.nextCursor! });
      NodeAssert.equal(third.tasks.length, 48);
      NodeAssert.equal(third.nextCursor, null);
      NodeAssert.equal(
        new Set([...first.tasks, ...second.tasks, ...third.tasks].map(({ id }) => id)).size,
        248,
      );
      NodeAssert.equal(third.tasks.at(-1)?.id, "working");
      const filtered = yield* repository.page({ status: "in progress", limit: 100 });
      NodeAssert.deepEqual(
        filtered.tasks.map(({ id }) => id),
        ["working"],
      );
      NodeAssert.ok(filtered.statuses.includes("Backlog"));
      NodeAssert.equal(filtered.nextCursor, null);
      NodeAssert.equal((yield* repository.page({ tags: ["missing"] })).tasks.length, 0);
      NodeAssert.equal(
        (yield* repository.page({ projectId: ProjectId.make("other") })).tasks.length,
        0,
      );

      // Unrelated status changes and reorders do not invalidate a keyset cursor.
      yield* repository.update({ id: first.tasks[1]!.id, status: "done" });
      yield* repository.reorder({ id: TaskId.make("working"), beforeTaskId: first.tasks[0]!.id });
      const continued = yield* repository.page({ limit: 100, cursor: first.nextCursor! });
      NodeAssert.deepEqual(
        continued.tasks.map(({ id }) => id),
        second.tasks.map(({ id }) => id),
      );
      yield* repository.update({ id: TaskId.make("working"), status: "done" });
      NodeAssert.equal((yield* repository.page({ status: "in progress" })).tasks.length, 0);
    }),
  );
});

test("run counts include history beyond 500, and run cursors/filtering are independent of that cap", async () => {
  const path = pathFor("counts.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(input("task-with-runs"));
      for (let index = 0; index < 502; index += 1) {
        yield* repository.createAgentRun({
          id: TaskAgentRunId.make(`run-${String(index).padStart(4, "0")}`),
          taskId: TaskId.make("task-with-runs"),
          agentId: TaskAgentId.make("agent"),
          threadId: ThreadId.make(`thread-${index}`),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          status: index === 501 ? "running" : index === 500 ? "failed" : "completed",
          startedAt: timestamp,
          completedAt: index === 501 ? null : timestamp,
          triggerRunId: null,
        });
      }
      const page = yield* repository.page({});
      NodeAssert.deepEqual(page.tasks[0]?.runCounts, [
        { status: "completed", count: 500 },
        { status: "failed", count: 1 },
        { status: "running", count: 1 },
      ]);
      const active = yield* repository.searchAgentRuns({
        taskId: TaskId.make("task-with-runs"),
        activeOnly: true,
      });
      NodeAssert.deepEqual(
        active.map(({ id }) => id),
        ["run-0501"],
      );
      const first = yield* repository.searchAgentRuns({
        taskId: TaskId.make("task-with-runs"),
        limit: 500,
      });
      const last = first.at(-1)!;
      const rest = yield* repository.searchAgentRuns({
        taskId: TaskId.make("task-with-runs"),
        cursor: { id: last.id, startedAt: last.startedAt },
      });
      NodeAssert.equal(rest.length, 2);
      NodeAssert.equal(
        (yield* repository.searchAgentRuns({ status: "failed" }))[0]?.id,
        "run-0500",
      );
    }),
  );
});

test("new tasks prepend after exhausted head space, while updates and upserts preserve existing rank", async () => {
  const path = pathFor("prepend.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(input("old"));
    }),
  );
  const db = new NodeSqlite.DatabaseSync(path);
  db.prepare("UPDATE tasks SET rank = '0000000000000001'").run();
  db.close();
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const fresh = yield* repository.upsert(input("new"));
      NodeAssert.deepEqual(
        (yield* repository.listAllTasks()).map(({ id }) => id),
        ["new", "old"],
      );
      const updated = yield* repository.upsert({ ...input("new"), title: "Updated" });
      NodeAssert.equal(updated.rank, fresh.rank);
      yield* repository.update({ id: TaskId.make("old"), title: "Old updated" });
      NodeAssert.deepEqual(
        (yield* repository.listAllTasks()).map(({ id }) => id),
        ["new", "old"],
      );
    }),
  );
});

test("getById returns only its own tags, and a crowded head rebalances every task before prepending", async () => {
  const path = pathFor("own-tags.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({ ...input("b"), tags: ["b-only"] });
      yield* repository.upsert({ ...input("a"), tags: ["a-two", "a-one"] });
      const a = yield* repository.getById({ id: TaskId.make("a") });
      NodeAssert.deepEqual(Option.getOrThrow(a).tags, ["a-one", "a-two"]);
    }),
  );
  const db = new NodeSqlite.DatabaseSync(path);
  db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run("0000000000000001", "a");
  db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run("0000000000000002", "b");
  db.close();
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const fresh = yield* repository.upsert(input("new"));
      const tasks = yield* repository.listAllTasks();
      NodeAssert.deepEqual(
        tasks.map(({ id }) => id),
        ["new", "a", "b"],
      );
      NodeAssert.equal(new Set(tasks.map(({ rank }) => rank)).size, 3);
      NodeAssert.equal(tasks[0]!.rank, fresh.rank);
    }),
  );
});

test("task streams publish committed changes from every mutation path; cosmetic edits preserve cursors", async () => {
  const path = pathFor("live.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(input("a"));
      yield* repository.upsert(input("b"));
      const first = yield* repository.page({ limit: 1 });
      const pull = yield* Stream.toPull(repository.changes);
      const sync = (yield* pull)[0]!;
      NodeAssert.equal(sync.kind, "sync");
      let sequence = sync.sequence;
      const next = () =>
        pull.pipe(
          Effect.map((events) => {
            const event = events[0]!;
            NodeAssert.equal(event.sequence, ++sequence);
            NodeAssert.equal(event.kind, "changed");
            return event;
          }),
        );
      yield* repository.update({
        id: TaskId.make("a"),
        title: "Renamed",
        description: "New description",
        output: "Result",
      });
      const edited = yield* next();
      NodeAssert.equal(edited.listChanged, false);
      NodeAssert.deepEqual(edited.taskIds, ["a"]);
      NodeAssert.equal(
        (yield* repository.page({ limit: 1, cursor: first.nextCursor! })).tasks[0]?.id,
        "a",
      );
      NodeAssert.equal(
        (yield* repository.items({ ids: [TaskId.make("a")] })).tasks[0]?.title,
        "Renamed",
      );

      yield* repository.update({ id: TaskId.make("a"), status: "in progress" });
      NodeAssert.equal((yield* next()).listChanged, true);
      yield* repository.reorder({ id: TaskId.make("a"), beforeTaskId: TaskId.make("b") });
      NodeAssert.equal((yield* next()).listChanged, true);
      yield* repository.addTag({ taskId: TaskId.make("a"), tag: "extra", updatedAt: timestamp });
      NodeAssert.equal((yield* next()).listChanged, true);
      yield* repository.removeTag({ taskId: TaskId.make("a"), tag: "extra", updatedAt: timestamp });
      NodeAssert.equal((yield* next()).listChanged, true);
      yield* repository.replaceTags({ taskId: TaskId.make("a"), tags: ["replaced"] });
      NodeAssert.equal((yield* next()).listChanged, true);

      const runId = TaskAgentRunId.make("live-run");
      yield* repository.createAgentRun({
        id: runId,
        taskId: TaskId.make("a"),
        agentId: TaskAgentId.make("agent"),
        threadId: ThreadId.make("thread"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        triggerRunId: null,
      });
      const started = yield* next();
      NodeAssert.equal(started.runsChanged, true);
      NodeAssert.equal(started.listChanged, false);
      NodeAssert.deepEqual(
        (yield* repository.items({ ids: [TaskId.make("a")] })).tasks[0]?.runCounts,
        [{ status: "running", count: 1 }],
      );
      yield* repository.claimAgentRunFinalization({
        id: runId,
        finalizingStatus: "finalizing:result",
      });
      NodeAssert.equal((yield* next()).runsChanged, true);
      yield* repository.finalizeAgentRun({
        id: runId,
        finalizingStatus: "finalizing:result",
        status: "completed",
        completedAt: timestamp,
        taskId: TaskId.make("a"),
        taskOutput: "Finished",
        releaseAssignment: true,
        events: [],
      });
      const finished = yield* next();
      NodeAssert.equal(finished.runsChanged, true);
      NodeAssert.equal(finished.listChanged, false);

      // A rollback must not leave an observable event or advance the stream.
      yield* Effect.exit(
        repository.reorder({ id: TaskId.make("a"), beforeTaskId: TaskId.make("missing") }),
      );
      yield* repository.deleteTask({ id: TaskId.make("a") });
      NodeAssert.equal((yield* next()).listChanged, true);
      NodeAssert.ok(Option.isNone(yield* repository.getById({ id: TaskId.make("a") })));
      NodeAssert.equal((yield* repository.items({ ids: [TaskId.make("a")] })).tasks.length, 0);
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  );
});

test("slow task subscribers receive a detectable sequence gap; reconnect always starts with sync", async () => {
  const path = pathFor("overflow.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert(input("a"));
      const pull = yield* Stream.toPull(repository.changes);
      const first = (yield* pull)[0]!;
      for (let index = 0; index < 270; index += 1)
        yield* repository.update({ id: TaskId.make("a"), title: `Title ${index}` });
      const events = yield* pull;
      NodeAssert.ok(events[0]!.sequence > first.sequence + 1);
      const reconnected = yield* Stream.toPull(repository.changes);
      const sync = (yield* reconnected)[0]!;
      NodeAssert.equal(sync.kind, "sync");
      NodeAssert.equal(sync.sequence, first.sequence + 270);
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  );
});

test("outer proposal-style transactions publish a single event after commit, never on rollback", async () => {
  const path = pathFor("batch.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const pull = yield* Stream.toPull(repository.changes);
      const sync = (yield* pull)[0]!;
      yield* Effect.exit(
        repository.withChangeTransaction(
          Effect.gen(function* () {
            yield* repository.upsert(input("rolled-back"));
            yield* Effect.fail("rollback");
          }),
        ),
      );
      NodeAssert.ok(Option.isNone(yield* repository.getById({ id: TaskId.make("rolled-back") })));
      yield* repository.withChangeTransaction(
        Effect.gen(function* () {
          yield* repository.upsert(input("a"));
          // A failed nested savepoint must also discard its deferred notifications.
          yield* Effect.exit(
            repository.withChangeTransaction(
              Effect.gen(function* () {
                yield* repository.upsert(input("nested-rollback"));
                yield* Effect.fail("rollback nested");
              }),
            ),
          );
          yield* repository.upsert(input("b"));
        }),
      );
      const event = (yield* pull)[0]!;
      NodeAssert.equal(event.sequence, sync.sequence + 1);
      NodeAssert.deepEqual(event.taskIds, ["a", "b"]);
      NodeAssert.equal(event.listChanged, true);
      NodeAssert.deepEqual(
        (yield* repository.listAllTasks()).map(({ id }) => id),
        ["b", "a"],
      );
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  );
});

function originRun(id: string, taskId: string, status = "completed") {
  return {
    id: TaskAgentRunId.make(id),
    taskId: TaskId.make(taskId),
    agentId: TaskAgentId.make("origin-agent"),
    threadId: ThreadId.make(`thread-${id}`),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    status,
    startedAt: timestamp,
    completedAt: status === "running" ? null : timestamp,
    triggerRunId: null,
  };
}

test("server creation lineage follows invocation threads across generations without proposals or model-supplied run ids", async () => {
  const path = pathFor("origins.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const root = ThreadId.make("original-chat");
      const a = yield* repository.upsert({ ...input("a"), sourceThreadId: root });
      NodeAssert.equal(a.rootThreadId, root);
      NodeAssert.equal(a.parentTaskId, null);
      yield* repository.createAgentRun(originRun("ra", "a"));
      const b = yield* repository.upsert({
        ...input("b"),
        sourceThreadId: ThreadId.make("untrusted-other-chat"),
        originThreadId: ThreadId.make("thread-ra"),
        sourceRunId: "untrusted-run",
      });
      NodeAssert.equal(b.rootThreadId, root);
      NodeAssert.equal(b.parentTaskId, "a");
      NodeAssert.equal(b.parentRunId, "ra");
      NodeAssert.equal(b.sourceRunId, "ra");
      yield* repository.createAgentRun(originRun("rb", "b", "failed"));
      const c = yield* repository.upsert({
        ...input("c"),
        originThreadId: ThreadId.make("thread-rb"),
      });
      NodeAssert.equal(c.rootThreadId, root);
      NodeAssert.equal(c.parentTaskId, "b");
      NodeAssert.equal(c.parentRunId, "rb");
      yield* repository.createAgentRun(originRun("rc", "c"));
      const updated = yield* repository.upsert({
        ...c,
        rootThreadId: ThreadId.make("attempted-reparent"),
        parentTaskId: c.id,
        title: "changed",
      });
      NodeAssert.equal(updated.rootThreadId, root);
      NodeAssert.equal(updated.parentTaskId, "b");
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root] })).threads[0]?.runCounts,
        [
          { status: "completed", count: 2 },
          { status: "failed", count: 1 },
        ],
      );
      const pull = yield* Stream.toPull(repository.changes);
      yield* pull;
      yield* repository.deleteTask({ id: a.id });
      const deleted = (yield* pull)[0]!;
      NodeAssert.deepEqual(deleted.rootThreadIds, [root]);
      NodeAssert.equal(deleted.runsChanged, true);
      NodeAssert.equal(
        Option.getOrThrow(yield* repository.getById({ id: c.id })).rootThreadId,
        root,
      );
      const d = yield* repository.upsert({ ...input("d"), sourceRunId: "rc" });
      NodeAssert.equal(d.rootThreadId, root);
      NodeAssert.equal(d.parentTaskId, "c");
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root, ThreadId.make("unrelated")] }))
          .threads,
        [
          {
            threadId: root,
            runCounts: [
              { status: "completed", count: 1 },
              { status: "failed", count: 1 },
            ],
          },
          { threadId: "unrelated", runCounts: [] },
        ],
      );
    }).pipe(Effect.scoped),
  );
});

test("a blocked run only counts as awaiting input while it is its task's latest run", async () => {
  const path = pathFor("superseded-blocked.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const root = ThreadId.make("blocked-chat");
      const at = (minute: number) => `2026-01-01T00:0${minute}:00.000Z`;
      yield* repository.upsert({ ...input("redone"), sourceThreadId: root });
      yield* repository.upsert({ ...input("waiting"), sourceThreadId: root });
      yield* repository.createAgentRun({
        ...originRun("r1", "redone", "blocked"),
        startedAt: at(1),
        completedAt: at(1),
      });
      yield* repository.createAgentRun({
        ...originRun("r2", "redone"),
        startedAt: at(2),
        completedAt: at(2),
      });
      yield* repository.createAgentRun({
        ...originRun("r3", "waiting"),
        startedAt: at(1),
        completedAt: at(1),
      });
      yield* repository.createAgentRun({
        ...originRun("r4", "waiting", "blocked"),
        startedAt: at(2),
        completedAt: at(2),
      });
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root] })).threads[0]?.runCounts,
        [
          { status: "blocked", count: 1 },
          { status: "blocked:superseded", count: 1 },
          { status: "completed", count: 2 },
        ],
      );
      const tasks = (yield* repository.items({
        ids: [TaskId.make("redone"), TaskId.make("waiting")],
      })).tasks;
      NodeAssert.deepEqual(Object.fromEntries(tasks.map((task) => [task.id, task.runCounts])), {
        redone: [
          { status: "blocked:superseded", count: 1 },
          { status: "completed", count: 1 },
        ],
        waiting: [
          { status: "blocked", count: 1 },
          { status: "completed", count: 1 },
        ],
      });
      // The environment total applies the same rules to every task, with or without an origin.
      yield* repository.upsert(input("orphan"));
      yield* repository.createAgentRun({
        ...originRun("r5", "orphan", "failed"),
        startedAt: at(3),
        completedAt: at(3),
      });
      yield* repository.upsert(input("deleted"));
      yield* repository.createAgentRun({
        ...originRun("r6", "deleted", "failed"),
        startedAt: at(3),
        completedAt: at(3),
      });
      yield* repository.deleteTask({ id: TaskId.make("deleted") });
      NodeAssert.deepEqual((yield* repository.runCounts()).runCounts, [
        { status: "blocked", count: 1 },
        { status: "blocked:superseded", count: 1 },
        { status: "completed", count: 2 },
        { status: "failed", count: 1 },
      ]);
    }).pipe(Effect.scoped),
  );
});

test("thread tasks list open before closed tasks in global order, with the Tasks table's run counts", async () => {
  const path = pathFor("thread-tasks.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const root = ThreadId.make("menu-chat");
      const at = (minute: number) => `2026-01-01T00:0${minute}:00.000Z`;
      // New tasks are prepended, so the global order is the reverse of creation.
      yield* repository.upsert({
        ...input("closed-second"),
        sourceThreadId: root,
        closedAt: timestamp,
      });
      yield* repository.upsert({ ...input("open-second"), sourceThreadId: root });
      yield* repository.upsert({
        ...input("elsewhere"),
        sourceThreadId: ThreadId.make("other-chat"),
      });
      yield* repository.upsert({
        ...input("closed-first"),
        sourceThreadId: root,
        closedAt: timestamp,
      });
      yield* repository.upsert({ ...input("open-first"), sourceThreadId: root });
      yield* repository.createAgentRun({
        ...originRun("r1", "open-first", "blocked"),
        startedAt: at(1),
        completedAt: at(1),
      });
      yield* repository.createAgentRun({
        ...originRun("r2", "open-first"),
        startedAt: at(2),
        completedAt: at(2),
      });
      yield* repository.createAgentRun(originRun("r3", "closed-first", "failed"));

      const { tasks } = yield* repository.threadTasks({ threadId: root });
      NodeAssert.deepEqual(
        tasks.map(({ id }) => id),
        ["open-first", "open-second", "closed-first", "closed-second"],
      );
      NodeAssert.deepEqual(tasks[0]?.runCounts, [
        { status: "blocked:superseded", count: 1 },
        { status: "completed", count: 1 },
      ]);
      NodeAssert.deepEqual(tasks[1]?.runCounts, []);
      NodeAssert.deepEqual(tasks[2]?.runCounts, [{ status: "failed", count: 1 }]);
      NodeAssert.deepEqual(tasks[0]?.tags, ["rank-test"]);
      NodeAssert.deepEqual(
        (yield* repository.threadTasks({ threadId: root, limit: 3 })).tasks.map(({ id }) => id),
        ["open-first", "open-second", "closed-first"],
      );
      NodeAssert.deepEqual(
        (yield* repository.threadTasks({ threadId: ThreadId.make("no-tasks") })).tasks,
        [],
      );

      for (let index = 0; index < 50; index++) {
        yield* repository.upsert({ ...input(`bulk-${index}`), sourceThreadId: root });
      }
      const capped = yield* repository.threadTasks({ threadId: root, limit: 500 });
      NodeAssert.equal(capped.tasks.length, 50);
      NodeAssert.equal((yield* repository.threadTasks({ threadId: root })).tasks.length, 50);
      NodeAssert.ok(capped.tasks.every((task) => task.closedAt === null));
    }).pipe(Effect.scoped),
  );
  const db = new NodeSqlite.DatabaseSync(path);
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE root_thread_id = ?
      ORDER BY closed_at IS NOT NULL, rank ASC, id ASC LIMIT 50`)
    .all("menu-chat");
  db.close();
  NodeAssert.match(JSON.stringify(plan), /tasks_root_thread_id/);
});

test("origins migration leaves historical tasks unknown, including descendants of unknown legacy parents", async () => {
  const path = pathFor("legacy-origins.sqlite");
  await migrate(path, 10);
  const db = new NodeSqlite.DatabaseSync(path);
  db.prepare(`INSERT INTO tasks (id, rank, project_id, title, description, status, created_by, source_thread_id, metadata_json, created_at, updated_at)
    VALUES ('legacy', '0000000000000001', 'project-1', 'Legacy', '', 'Backlog', 'test', 'old-chat', '{}', ?, ?)`).run(
    timestamp,
    timestamp,
  );
  db.close();
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      NodeAssert.equal(
        Option.getOrThrow(yield* repository.getById({ id: TaskId.make("legacy") })).rootThreadId,
        null,
      );
      yield* repository.createAgentRun(originRun("legacy-run", "legacy"));
      const child = yield* repository.upsert({
        ...input("child"),
        originThreadId: ThreadId.make("thread-legacy-run"),
      });
      NodeAssert.equal(child.rootThreadId, null);
      NodeAssert.equal(child.parentTaskId, "legacy");
      const plain = yield* repository.upsert(input("without-chat"));
      NodeAssert.equal(plain.rootThreadId, null);
      const unresolved = yield* repository.upsert({
        ...input("unresolved"),
        sourceThreadId: ThreadId.make("some-chat"),
        sourceRunId: "missing-run",
      });
      NodeAssert.equal(unresolved.rootThreadId, null);
    }),
  );
});

test("run changes publish affected roots only after commit; rolled-back ancestry never leaks", async () => {
  const path = pathFor("origin-events.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const root = ThreadId.make("chat");
      yield* repository.upsert({ ...input("a"), sourceThreadId: root });
      const pull = yield* Stream.toPull(repository.changes);
      yield* pull;
      yield* repository.withChangeTransaction(
        Effect.gen(function* () {
          yield* repository.createAgentRun(originRun("ra", "a"));
          yield* repository.upsert({ ...input("b"), sourceRunId: "ra" });
          yield* repository.createAgentRun(originRun("rb", "b"));
        }),
      );
      const event = (yield* pull)[0]!;
      NodeAssert.deepEqual(event.rootThreadIds, [root]);
      NodeAssert.equal(event.runsChanged, true);
      yield* repository
        .withChangeTransaction(
          repository
            .createAgentRun(originRun("rollback", "a"))
            .pipe(Effect.andThen(Effect.fail("rollback"))),
        )
        .pipe(Effect.catch(() => Effect.void));
      yield* repository.update({ id: TaskId.make("a"), title: "Next committed change" });
      const next = (yield* pull)[0]!;
      NodeAssert.equal(next.sequence, event.sequence + 1);
      NodeAssert.deepEqual(next.rootThreadIds, []);
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root] })).threads[0]?.runCounts,
        [{ status: "completed", count: 2 }],
      );
    }).pipe(Effect.scoped),
  );
});

test("thread summaries use indexed aggregation over a large run history, not capped search results", async () => {
  const path = pathFor("origin-load.sqlite");
  await migrate(path);
  const db = new NodeSqlite.DatabaseSync(path);
  db.exec("BEGIN");
  const task =
    db.prepare(`INSERT INTO tasks (id, rank, project_id, title, description, status, created_by, metadata_json, created_at, updated_at, root_thread_id)
    VALUES (?, ?, 'project-1', 'Task', '', 'Backlog', 'test', '{}', ?, ?, ?)`);
  const run =
    db.prepare(`INSERT INTO task_agent_runs (id, task_id, agent_id, thread_id, model_selection_json, status, started_at, completed_at)
    VALUES (?, ?, 'agent', ?, '{}', ?, ?, ?)`);
  for (let i = 0; i < 10000; i++) {
    task.run(
      `task-${i}`,
      (i + 1).toString(16).padStart(16, "0"),
      timestamp,
      timestamp,
      `root-${i % 100}`,
    );
    for (let j = 0; j < 5; j++)
      run.run(
        `run-${i}-${j}`,
        `task-${i}`,
        `thread-${i}-${j}`,
        j === 4 ? "failed" : "completed",
        timestamp,
        timestamp,
      );
  }
  db.exec("COMMIT");
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN SELECT t.root_thread_id, r.status, COUNT(*) FROM tasks t JOIN task_agent_runs r ON r.task_id = t.id
    WHERE t.root_thread_id IN (SELECT value FROM json_each(?)) GROUP BY t.root_thread_id, r.status`)
    .all('["root-0"]');
  NodeAssert.match(JSON.stringify(plan), /tasks_root_thread_id/);
  NodeAssert.match(JSON.stringify(plan), /task_agent_runs_task_status/);
  db.close();
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const start = performance.now();
      const result = yield* repository.threadRunCounts({
        threadIds: Array.from({ length: 100 }, (_, i) => ThreadId.make(`root-${i}`)),
      });
      console.log(
        `Indexed summary: 10,000 tasks / 50,000 runs / 100 roots in ${Math.round(performance.now() - start)}ms`,
      );
      NodeAssert.equal(result.threads.length, 100);
      for (const row of result.threads)
        NodeAssert.deepEqual(row.runCounts, [
          { status: "completed", count: 400 },
          { status: "failed", count: 100 },
        ]);
    }),
  );
});

test("run finalization refreshes root counters, and task assignment is not creation ancestry", async () => {
  const path = pathFor("origin-finalization.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const root = ThreadId.make("chat");
      const task = yield* repository.upsert({ ...input("a"), sourceThreadId: root });
      const run = originRun("running", "a", "running");
      yield* repository.createAgentRun(run);
      const unrelated = yield* repository.upsert({
        ...input("assigned"),
        sourceThreadId: ThreadId.make("other-chat"),
        assigneeAgentRunId: run.id,
      });
      NodeAssert.equal(unrelated.parentRunId, null);
      NodeAssert.equal(unrelated.rootThreadId, "other-chat");
      const pull = yield* Stream.toPull(repository.changes);
      yield* pull;
      NodeAssert.equal(
        yield* repository.claimAgentRunFinalization({
          id: run.id,
          finalizingStatus: "finalizing:result",
        }),
        true,
      );
      NodeAssert.deepEqual((yield* pull)[0]?.rootThreadIds, [root]);
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root] })).threads[0]?.runCounts,
        [{ status: "finalizing:result", count: 1 }],
      );
      NodeAssert.equal(
        yield* repository.finalizeAgentRun({
          id: run.id,
          taskId: task.id,
          finalizingStatus: "finalizing:result",
          status: "completed",
          completedAt: timestamp,
          releaseAssignment: true,
          events: [],
        }),
        true,
      );
      NodeAssert.deepEqual((yield* pull)[0]?.rootThreadIds, [root]);
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [root] })).threads[0]?.runCounts,
        [{ status: "completed", count: 1 }],
      );
    }).pipe(Effect.scoped),
  );
});

test("proposal annotations inherit from the authoritative parent even when the model omits or misstates sourceRunId", async () => {
  const path = pathFor("origin-proposal.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({
        ...input("a"),
        sourceThreadId: ThreadId.make("chat"),
        metadata: { proposalId: "proposal", agentName: "Parent agent" },
      });
      yield* repository.createAgentRun(originRun("ra", "a"));
      for (const sourceRunId of [null, "wrong-run"]) {
        const child = yield* repository.upsert({
          ...input(`child-${sourceRunId}`),
          originThreadId: ThreadId.make("thread-ra"),
          sourceRunId,
        });
        NodeAssert.equal(child.rootThreadId, "chat");
        NodeAssert.equal(child.sourceRunId, "ra");
        NodeAssert.deepEqual(child.metadata, {
          retained: true,
          source: "orchestrationProposal",
          proposalId: "proposal",
          parentTaskId: "a",
          parentAgentRunId: "ra",
          parentAgentName: "Parent agent",
        });
      }
    }),
  );
});

test("recreating a task with retained historical runs notifies its root; cosmetic upserts do not", async () => {
  const path = pathFor("origin-recreated.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const task = { ...input("a"), sourceThreadId: ThreadId.make("chat") };
      yield* repository.upsert(task);
      yield* repository.createAgentRun(originRun("ra", "a"));
      yield* repository.deleteTask({ id: task.id });
      const pull = yield* Stream.toPull(repository.changes);
      yield* pull;
      yield* repository.upsert(task);
      NodeAssert.deepEqual((yield* pull)[0]?.rootThreadIds, ["chat"]);
      NodeAssert.deepEqual(
        (yield* repository.threadRunCounts({ threadIds: [task.sourceThreadId] })).threads[0]
          ?.runCounts,
        [{ status: "completed", count: 1 }],
      );
      yield* repository.upsert({ ...task, title: "Cosmetic" });
      const event = (yield* pull)[0]!;
      NodeAssert.equal(event.runsChanged, false);
      NodeAssert.deepEqual(event.rootThreadIds, []);
    }).pipe(Effect.scoped),
  );
});

test("reusing deleted IDs cannot create ancestry cycles, and ambiguous invocation threads stay unknown", async () => {
  const path = pathFor("origin-cycles.sqlite");
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      yield* repository.upsert({ ...input("a"), sourceThreadId: ThreadId.make("chat") });
      yield* repository.createAgentRun(originRun("ra", "a"));
      yield* repository.upsert({ ...input("b"), sourceRunId: "ra" });
      yield* repository.createAgentRun(originRun("rb", "b"));
      yield* repository.deleteTask({ id: TaskId.make("a") });
      const cycle = yield* repository
        .upsert({ ...input("a"), sourceRunId: "rb" })
        .pipe(Effect.exit);
      NodeAssert.equal(cycle._tag, "Failure");
      NodeAssert.equal(Option.isNone(yield* repository.getById({ id: TaskId.make("a") })), true);
      yield* repository.createAgentRun(originRun("self", "future"));
      NodeAssert.equal(
        (yield* repository.upsert({ ...input("future"), sourceRunId: "self" }).pipe(Effect.exit))
          ._tag,
        "Failure",
      );
      yield* repository.createAgentRun({
        ...originRun("duplicate-thread", "b"),
        threadId: ThreadId.make("thread-rb"),
      });
      const ambiguous = yield* repository.upsert({
        ...input("ambiguous"),
        originThreadId: ThreadId.make("thread-rb"),
        sourceRunId: "rb",
      });
      NodeAssert.equal(ambiguous.rootThreadId, null);
      NodeAssert.equal(ambiguous.parentRunId, null);
    }),
  );
});

test("trigger semantics migration starts a task without runs at its last update", async () => {
  const path = pathFor("trigger-migration.sqlite");
  await migrate(path, 11);
  const db = new NodeSqlite.DatabaseSync(path);
  db.prepare(`INSERT INTO tasks (
    id, rank, project_id, title, description, output, status, priority, created_by,
    assignee_worker_id, source_thread_id, source_run_id, metadata_json,
    created_at, updated_at, closed_at
  ) VALUES ('legacy', '0000000100000000', 'project-1', 'Legacy', '', NULL, 'To Do', NULL, 'test',
    NULL, NULL, NULL, 'null', ?, ?, NULL)`).run(timestamp, "2026-08-13T00:00:00.000Z");
  db.close();
  await migrate(path);
  await runRepository(
    path,
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const task = Option.getOrThrow(yield* repository.getById({ id: TaskId.make("legacy") }));
      NodeAssert.equal(task.triggerChangedAt, "2026-08-13T00:00:00.000Z");
      NodeAssert.equal(task.notBefore, null);
      yield* repository.upsertAgent({
        id: TaskAgentId.make("agent"),
        projectId: null,
        name: "Agent",
        enabled: true,
        startStatuses: [],
        startTags: [],
        startRunStatuses: ["failed"],
        config: {
          role: "Agent",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          instructions: "Work.",
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      NodeAssert.deepEqual(
        Option.getOrThrow(yield* repository.getAgentById({ id: TaskAgentId.make("agent") }))
          .startRunStatuses,
        ["failed"],
      );
    }),
  );
});
