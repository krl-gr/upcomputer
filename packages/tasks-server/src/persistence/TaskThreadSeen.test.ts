import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId, type TaskChange } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "./migrations/index.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { TaskRepositoryLive } from "./TaskRepositoryLive.ts";

const at = (minute: number) => `2026-10-27T10:${String(minute).padStart(2, "0")}:00.000Z`;
const project = ProjectId.make("project-seen");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const chat = ThreadId.make("chat");
const other = ThreadId.make("other");

const seedAgent = Effect.gen(function* () {
  yield* (yield* TaskRepository).upsertAgent({
    id: TaskAgentId.make("agent"),
    projectId: project,
    name: "agent",
    enabled: true,
    startStatuses: ["To Do"],
    startTags: [],
    startRunStatuses: [],
    config: { role: "developer", modelSelection, instructions: "Test" },
    createdAt: at(0),
    updatedAt: at(0),
  });
});

const seedTask = (id: string, root: ThreadId) =>
  Effect.gen(function* () {
    yield* (yield* TaskRepository).upsert({
      id: TaskId.make(id),
      projectId: project,
      title: id,
      description: "",
      output: null,
      status: "To Do",
      priority: null,
      createdBy: "test",
      assigneeAgentRunId: null,
      sourceThreadId: root,
      sourceRunId: null,
      metadata: null,
      tags: [],
      createdAt: at(0),
      updatedAt: at(0),
      archivedAt: null,
    });
  });

const seedRun = (
  id: string,
  task: string,
  status: string,
  startedAt: string,
  completedAt: string | null,
) =>
  Effect.gen(function* () {
    yield* (yield* TaskRepository).createAgentRun({
      id: TaskAgentRunId.make(id),
      taskId: TaskId.make(task),
      agentId: TaskAgentId.make("agent"),
      threadId: ThreadId.make(`thread-${id}`),
      modelSelection,
      status,
      startedAt,
      completedAt,
      triggerRunId: null,
      continuesRunId: null,
    });
  });

const counts = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const result = yield* (yield* TaskRepository).threadRunCounts({ threadIds: [threadId] });
    return Object.fromEntries(
      (result.threads[0]?.runCounts ?? []).map(({ status, count }) => [status, count]),
    );
  });

const database = (
  migrations: Parameters<
    typeof runExperimentalFeatureMigrations
  >[0][number] = TASK_MIGRATION_CONTRIBUTION,
) =>
  Layer.effectDiscard(runExperimentalFeatureMigrations([migrations])).pipe(
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

it.layer(TaskRepositoryLive.pipe(Layer.provideMerge(database())))("Thread run counts", (it) => {
  it.effect("count active runs always and finished runs only after the seen watermark", () =>
    Effect.gen(function* () {
      const repository = yield* TaskRepository;
      const changes = yield* Queue.unbounded<TaskChange>();
      yield* repository.changes.pipe(
        Stream.runForEach((change) => Queue.offer(changes, change)),
        Effect.forkScoped,
      );
      assert.equal((yield* Queue.take(changes)).kind, "sync");

      yield* seedAgent;
      for (const id of ["a", "b", "c", "d"]) yield* seedTask(id, chat);
      yield* seedTask("x", other);
      yield* seedRun("a1", "a", "completed", at(0), at(1));
      yield* seedRun("a2", "a", "running", at(2), null);
      // The latest run of b awaits input; c's blocked run is history once c2 started.
      yield* seedRun("b1", "b", "blocked", at(0), at(2));
      yield* seedRun("c1", "c", "blocked", at(0), at(1));
      yield* seedRun("c2", "c", "failed", at(3), at(5));
      yield* seedRun("d1", "d", "finalizing:result", at(4), null);
      yield* seedRun("x1", "x", "completed", at(0), at(1));
      yield* Queue.clear(changes);

      // Never seen: everything counts, as before.
      assert.deepStrictEqual(yield* counts(chat), {
        blocked: 1,
        "blocked:superseded": 1,
        completed: 1,
        failed: 1,
        "finalizing:result": 1,
        running: 1,
      });

      yield* repository.markThreadsSeen({ threadIds: [chat], seenAt: at(4) });
      const published = yield* Queue.take(changes);
      assert.isTrue(published.runsChanged);
      assert.deepStrictEqual(published.rootThreadIds, [chat]);
      assert.deepStrictEqual(published.taskIds, []);
      assert.deepStrictEqual(yield* counts(chat), {
        blocked: 1,
        failed: 1,
        "finalizing:result": 1,
        running: 1,
      });
      // Another thread keeps its own watermark.
      assert.deepStrictEqual(yield* counts(other), { completed: 1 });

      // A late mark from another client does not bring seen runs back.
      yield* repository.markThreadsSeen({ threadIds: [chat], seenAt: at(3) });
      assert.deepStrictEqual(yield* counts(chat), {
        blocked: 1,
        failed: 1,
        "finalizing:result": 1,
        running: 1,
      });

      yield* repository.markThreadsSeen({ threadIds: [chat, other], seenAt: at(10) });
      assert.deepStrictEqual(yield* counts(chat), {
        blocked: 1,
        "finalizing:result": 1,
        running: 1,
      });
      assert.deepStrictEqual(yield* counts(other), {});

      // A run that finishes after the watermark counts again until the next look.
      yield* seedRun("x2", "x", "interrupted", at(11), at(12));
      assert.deepStrictEqual(yield* counts(other), { interrupted: 1 });
    }),
  );
});

it.effect("the upgrade marks runs that finished before it as seen", () =>
  Effect.gen(function* () {
    yield* seedAgent;
    yield* seedTask("old", ThreadId.make("old-chat"));
    yield* seedRun("old-done", "old", "completed", at(0), at(1));
    yield* seedRun("old-failed", "old", "failed", at(0), at(2));
    yield* seedRun("old-running", "old", "running", at(3), null);
    yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);

    assert.deepStrictEqual(yield* counts(ThreadId.make("old-chat")), { running: 1 });
    // Runs that finish after the upgrade count; a thread that had no tasks has no watermark.
    yield* seedRun("old-later", "old", "completed", at(4), "2999-01-01T00:00:00.000Z");
    yield* seedTask("new", ThreadId.make("new-chat"));
    yield* seedRun("new-done", "new", "completed", at(0), at(1));
    assert.deepStrictEqual(yield* counts(ThreadId.make("old-chat")), {
      completed: 1,
      running: 1,
    });
    assert.deepStrictEqual(yield* counts(ThreadId.make("new-chat")), { completed: 1 });
  }).pipe(
    Effect.provide(
      TaskRepositoryLive.pipe(
        Layer.provideMerge(
          database({
            ...TASK_MIGRATION_CONTRIBUTION,
            migrations: TASK_MIGRATION_CONTRIBUTION.migrations.filter(
              (migration) => migration.version < 37,
            ),
          }),
        ),
      ),
    ),
  ),
);
