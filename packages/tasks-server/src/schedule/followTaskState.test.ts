import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  TaskAgentId,
  TaskAgentRunId,
  TaskId,
  type TaskActor,
  type TaskChange,
  type TaskKind,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService, TaskScheduleServiceLive } from "./TaskScheduleService.ts";

const created = "2026-10-01T09:00:00.000Z";
const monday = "2026-10-05";
const tuesday = "2026-10-06";
const wednesday = "2026-10-07";
const thursday = "2026-10-08";
const friday = "2026-10-09";
const person: TaskActor = { type: "person" };

/** A fresh in-memory store per test, on Wednesday 2026-10-07 10:00 UTC in a UTC schedule. */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, TaskScheduleService | TaskRepository | Scope.Scope>,
) =>
  it.effect(name, () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${wednesday}T10:00:00.000Z`));
      yield* (yield* TaskScheduleService).updateSettings({ scheduleTimeZone: "UTC" });
      return yield* body();
    }).pipe(
      Effect.scoped,
      Effect.provide(
        TaskScheduleServiceLive.pipe(
          Layer.provideMerge(TaskRepositoryLive),
          Layer.provideMerge(
            Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
          ),
          Layer.provideMerge(
            Layer.merge(NodeSqliteClient.layer({ filename: ":memory:" }), NodeServices.layer),
          ),
        ),
      ),
    ),
  );

const createTask = (
  id: string,
  options: { readonly kind?: TaskKind; readonly audience?: "agent" | "person" } = {},
) =>
  Effect.gen(function* () {
    yield* (yield* TaskRepository).upsert({
      id: TaskId.make(id),
      projectId: ProjectId.make("project-1"),
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
      tags: [],
      createdAt: created,
      updatedAt: created,
      audience: options.audience ?? "person",
      kind: options.kind ?? "task",
    });
    return TaskId.make(id);
  });

/** Plans the task on each date and returns the entry ids in that order. */
const plan = (taskId: TaskId, ...dates: string[]) =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const ids = [];
    for (const date of dates) {
      const { entries } = yield* schedule.add({ taskIds: [taskId], date });
      ids.push(entries[0]!.id);
    }
    return ids;
  });

/** The task's entries as `date status`, in date order. */
const entriesOf = (taskId: TaskId) =>
  Effect.gen(function* () {
    const { entries } = yield* (yield* TaskScheduleService).forTask({ taskId });
    return entries.map(({ date, status }) => `${date} ${status}`);
  });

const setStatus = (id: TaskId, status: string) =>
  Effect.gen(function* () {
    yield* TestClock.adjust("1 minute");
    return yield* (yield* TaskRepository).update({ id, status, actor: person });
  });

const watchChanges = Effect.gen(function* () {
  const changes = yield* Queue.unbounded<TaskChange>();
  yield* (yield* TaskRepository).changes.pipe(
    Stream.runForEach((change) => Queue.offer(changes, change)),
    Effect.forkScoped,
  );
  assert.equal((yield* Queue.take(changes)).kind, "sync");
  return { next: Queue.take(changes) };
});

test("a task becoming Done closes its entries up to today and drops later ones", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const task = yield* createTask("task");
    const other = yield* createTask("other");
    const [, skipped] = yield* plan(task, monday, tuesday, wednesday, thursday, friday);
    yield* schedule.update({ id: skipped!, status: "skipped" });
    yield* plan(other, thursday);
    const changes = yield* watchChanges;

    yield* setStatus(task, "Done");

    assert.deepStrictEqual(yield* entriesOf(task), [
      `${monday} done`,
      `${tuesday} skipped`,
      `${wednesday} done`,
    ]);
    assert.deepStrictEqual(yield* entriesOf(other), [`${thursday} open`]);
    // One change carries the status and the dates, so the planner reloads them.
    const change = yield* changes.next;
    assert.deepStrictEqual(change.taskIds, [task]);
    assert.isTrue(change.listChanged);
    assert.deepStrictEqual(change.scheduleDates, [monday, wednesday, thursday, friday]);

    // Writes that keep the status move nothing.
    yield* (yield* TaskRepository).update({ id: task, title: "renamed", actor: person });
    assert.deepStrictEqual(yield* entriesOf(task), [
      `${monday} done`,
      `${tuesday} skipped`,
      `${wednesday} done`,
    ]);
    assert.isUndefined((yield* changes.next).scheduleDates);
  }));

test("today is the date in the schedule's time zone", () =>
  Effect.gen(function* () {
    // 10:01 UTC on Wednesday is already Thursday at UTC+14.
    yield* (yield* TaskScheduleService).updateSettings({ scheduleTimeZone: "Pacific/Kiritimati" });
    const task = yield* createTask("task");
    yield* plan(task, thursday, friday);

    yield* setStatus(task, "Done");

    assert.deepStrictEqual(yield* entriesOf(task), [`${thursday} done`]);
  }));

test("reopening a Done task reopens only today's entry it closed", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const task = yield* createTask("task");
    const [, , doneByHand] = yield* plan(task, monday, wednesday, wednesday);
    yield* schedule.update({ id: doneByHand!, status: "done" });

    yield* setStatus(task, "Done");
    assert.deepStrictEqual(yield* entriesOf(task), [
      `${monday} done`,
      `${wednesday} done`,
      `${wednesday} done`,
    ]);

    const reopened = yield* setStatus(task, "In Progress");
    assert.equal(reopened.status, "In Progress");
    const { entries } = yield* schedule.forTask({ taskId: task });
    assert.deepStrictEqual(
      entries.map(({ id, date, status }) => [id === doneByHand ? "by hand" : date, status]),
      [
        [monday, "done"],
        [wednesday, "open"],
        ["by hand", "done"],
      ],
    );
  }));

test("reopening leaves an entry the person changed after the task became Done", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const task = yield* createTask("task");
    const [entry] = yield* plan(task, wednesday);
    yield* setStatus(task, "Done");
    yield* TestClock.adjust("1 minute");
    yield* schedule.update({ id: entry!, startTime: "15:00" });

    yield* setStatus(task, "To Do");

    assert.deepStrictEqual(yield* entriesOf(task), [`${wednesday} done`]);
  }));

test("a task Done on an earlier day reopens with nothing to reopen", () =>
  Effect.gen(function* () {
    const task = yield* createTask("task");
    yield* plan(task, wednesday, thursday);
    yield* setStatus(task, "Done");
    yield* TestClock.adjust("1 day");

    yield* setStatus(task, "To Do");

    assert.deepStrictEqual(yield* entriesOf(task), [`${wednesday} done`]);
  }));

test("cancelling or archiving skips open entries; deleting removes them", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const repository = yield* TaskRepository;
    const cancelled = yield* createTask("cancelled");
    const [done] = yield* plan(cancelled, monday, wednesday, thursday);
    yield* schedule.update({ id: done!, status: "done" });
    yield* setStatus(cancelled, "Cancelled");
    assert.deepStrictEqual(yield* entriesOf(cancelled), [
      `${monday} done`,
      `${wednesday} skipped`,
      `${thursday} skipped`,
    ]);

    const archived = yield* createTask("archived");
    yield* plan(archived, tuesday, thursday);
    yield* repository.setArchived({ ids: [archived], archived: true, actor: person });
    assert.deepStrictEqual(yield* entriesOf(archived), [
      `${tuesday} skipped`,
      `${thursday} skipped`,
    ]);
    // Unarchiving brings the task back, not the plan.
    yield* repository.setArchived({ ids: [archived], archived: false, actor: person });
    assert.deepStrictEqual(yield* entriesOf(archived), [
      `${tuesday} skipped`,
      `${thursday} skipped`,
    ]);

    const deleted = yield* createTask("deleted");
    yield* plan(deleted, wednesday);
    yield* repository.deleteTask({ id: deleted });
    assert.isFalse(
      (yield* repository.scheduleEntries({ dates: [wednesday] })).some(
        ({ taskId }) => taskId === deleted,
      ),
    );
  }));

test("a routine's entries keep their own daily cycle", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const routine = yield* createTask("routine", { kind: "routine" });
    yield* plan(routine, tuesday, wednesday, thursday);

    yield* setStatus(routine, "Done");
    yield* repository.setArchived({ ids: [routine], archived: true, actor: person });

    assert.deepStrictEqual(yield* entriesOf(routine), [
      `${tuesday} open`,
      `${wednesday} open`,
      `${thursday} open`,
    ]);
  }));

test("an agent run's result status moves the entries too", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const task = yield* createTask("agent-task", { audience: "agent" });
    yield* plan(task, wednesday, thursday);
    const agentId = TaskAgentId.make("agent");
    const runId = TaskAgentRunId.make("run");
    const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
    yield* repository.upsertAgent({
      id: agentId,
      projectId: ProjectId.make("project-1"),
      name: "Agent",
      enabled: true,
      startStatuses: ["To Do"],
      startTags: [],
      config: { role: "Developer", modelSelection, instructions: "Test" },
      startRunStatuses: [],
      createdAt: created,
      updatedAt: created,
    });
    yield* repository.createAgentRun({
      id: runId,
      taskId: task,
      agentId,
      threadId: ThreadId.make("thread"),
      modelSelection,
      status: "running",
      startedAt: created,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    assert.isTrue(
      yield* repository.claimAgentRunFinalization({
        id: runId,
        finalizingStatus: "finalizing:result",
      }),
    );

    assert.isTrue(
      yield* repository.finalizeAgentRun({
        id: runId,
        finalizingStatus: "finalizing:result",
        status: "completed",
        completedAt: `${wednesday}T10:05:00.000Z`,
        taskId: task,
        taskStatus: "Done",
        releaseAssignment: true,
        events: [],
      }),
    );

    assert.deepStrictEqual(yield* entriesOf(task), [`${wednesday} done`]);
  }));

test("marking an entry in the plan leaves its task's status alone", () =>
  Effect.gen(function* () {
    const task = yield* createTask("task");
    const [entry] = yield* plan(task, wednesday);
    yield* (yield* TaskScheduleService).update({ id: entry!, status: "done" });
    const saved = yield* (yield* TaskRepository).getById({ id: task });
    assert.equal(Option.getOrThrow(saved).status, "To Do");
  }));
