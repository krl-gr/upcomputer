import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskId, type TaskChange, type TaskReminder } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskReminderSweeperLive } from "./TaskReminderSweeper.ts";
import { TaskScheduleService, TaskScheduleServiceLive } from "./TaskScheduleService.ts";

// Berlin is UTC+2 on these dates: 09:30 there is 07:30Z, reminded at 07:20Z.
const today = "2026-10-07";
const tomorrow = "2026-10-08";
const setTime = (iso: string) => TestClock.setTime(Date.parse(iso));

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

/** The schedule over a database file; providing it again is a server restart. */
const storeOn = (filename: string) =>
  TaskScheduleServiceLive.pipe(
    Layer.provideMerge(TaskRepositoryLive),
    Layer.provideMerge(
      Layer.effectDiscard(runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION])),
    ),
    Layer.provideMerge(Layer.merge(NodeSqliteClient.layer({ filename }), NodeServices.layer)),
  );
const memoryStore = storeOn(":memory:");
const databaseFile = () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "task-reminders-"));
  directories.push(directory);
  return NodePath.join(directory, "tasks.sqlite");
};

const createTask = (id: string, timestamp = "2026-10-07T06:00:00.000Z") =>
  Effect.flatMap(TaskRepository, (repository) =>
    repository.upsert({
      id: TaskId.make(id),
      projectId: ProjectId.make("project-1"),
      title: `Task ${id}`,
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
      audience: "person",
    }),
  );

/** One timed entry for a new task; returns the entry id. */
const plan = (taskId: string, startTime: string, date = today) =>
  Effect.gen(function* () {
    yield* createTask(taskId);
    const { entries } = yield* (yield* TaskScheduleService).add({
      taskIds: [TaskId.make(taskId)],
      date,
      startTime,
    });
    return entries[0]!.id;
  });

const inBerlin = Effect.flatMap(TaskScheduleService, (schedule) =>
  schedule.updateSettings({ scheduleTimeZone: "Europe/Berlin" }),
);

/** Task ids of the reminders a claim sends now. */
const claim = Effect.flatMap(TaskRepository, (repository) =>
  repository.claimDueReminders({ limit: 50 }),
).pipe(Effect.map((reminders) => reminders.map(({ taskId }) => taskId as string)));

it.effect("a due reminder is claimed once and published on the change stream", () =>
  Effect.gen(function* () {
    yield* setTime("2026-10-07T06:00:00.000Z");
    yield* inBerlin;
    const entryId = yield* plan("a", "09:30");
    const changes = yield* Queue.unbounded<TaskChange>();
    yield* (yield* TaskRepository).changes.pipe(
      Stream.runForEach((change) => Queue.offer(changes, change)),
      Effect.forkScoped,
    );
    assert.equal((yield* Queue.take(changes)).kind, "sync");

    assert.deepStrictEqual(yield* claim, []);
    yield* setTime("2026-10-07T07:19:59.000Z");
    assert.deepStrictEqual(yield* claim, []);
    yield* setTime("2026-10-07T07:20:00.000Z");
    const reminders = yield* (yield* TaskRepository).claimDueReminders({ limit: 50 });
    const expected: TaskReminder[] = [
      { entryId, taskId: TaskId.make("a"), title: "Task a", date: today, startTime: "09:30" },
    ];
    assert.deepStrictEqual(reminders, expected);
    const published = yield* Queue.take(changes);
    assert.deepStrictEqual(published.reminders, expected);
    assert.deepStrictEqual(published.taskIds, []);
    assert.isFalse(published.listChanged);
    assert.deepStrictEqual(yield* claim, []);
  }).pipe(Effect.provide(memoryStore)),
);

it.effect("a claim is stored, so a restart never sends it again", () =>
  Effect.gen(function* () {
    const filename = databaseFile();
    yield* setTime("2026-10-07T06:00:00.000Z");
    yield* Effect.gen(function* () {
      yield* inBerlin;
      yield* plan("early", "09:30");
      yield* plan("late", "11:00");
      yield* setTime("2026-10-07T07:20:00.000Z");
      assert.deepStrictEqual(yield* claim, ["early"]);
    }).pipe(Effect.provide(storeOn(filename)));

    yield* Effect.gen(function* () {
      // What the sweeper does first after a restart.
      yield* (yield* TaskRepository).recomputeReminders();
      assert.deepStrictEqual(yield* claim, []);
      yield* setTime("2026-10-07T08:50:00.000Z");
      assert.deepStrictEqual(yield* claim, ["late"]);
      assert.deepStrictEqual(yield* claim, []);
    }).pipe(Effect.provide(storeOn(filename)));
  }),
);

it.effect("a new time or date makes the reminder due again; other edits keep it sent", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    yield* setTime("2026-10-07T06:00:00.000Z");
    yield* inBerlin;
    const entryId = yield* plan("a", "09:30");
    yield* setTime("2026-10-07T07:20:00.000Z");
    assert.deepStrictEqual(yield* claim, ["a"]);

    yield* schedule.update({ id: entryId, durationMinutes: 45 });
    yield* schedule.move({ ids: [entryId], date: today, placement: { at: "top" } });
    assert.deepStrictEqual(yield* claim, []);

    yield* schedule.update({ id: entryId, startTime: "10:00" });
    assert.deepStrictEqual(yield* claim, []);
    yield* setTime("2026-10-07T07:50:00.000Z");
    assert.deepStrictEqual(yield* claim, ["a"]);

    yield* schedule.move({ ids: [entryId], date: tomorrow });
    assert.deepStrictEqual(yield* claim, []);
    yield* setTime("2026-10-08T07:50:00.000Z");
    assert.deepStrictEqual(yield* claim, ["a"]);
  }).pipe(Effect.provide(memoryStore)),
);

it.effect("settings changes recompute pending reminders, and turning them off stops them", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    yield* setTime("2026-10-07T06:00:00.000Z");
    yield* inBerlin;
    yield* plan("a", "09:30");
    yield* plan("b", "12:00");
    yield* plan("c", "14:00");

    // A longer lead: 09:30 Berlin (07:30Z) is now due at 06:30Z.
    yield* schedule.updateSettings({ reminderLeadMinutes: 60 });
    yield* setTime("2026-10-07T06:30:00.000Z");
    assert.deepStrictEqual(yield* claim, ["a"]);

    // Another zone: 12:00 is 10:00Z in Berlin, 12:00Z in UTC. 09:30 now
    // means 09:30Z, a new instant, so `a` is reminded again at 08:30Z.
    yield* schedule.updateSettings({ scheduleTimeZone: "UTC" });
    yield* setTime("2026-10-07T09:00:00.000Z");
    assert.deepStrictEqual(yield* claim, ["a"]);
    yield* setTime("2026-10-07T11:00:00.000Z");
    assert.deepStrictEqual(yield* claim, ["b"]);

    yield* schedule.updateSettings({ remindersEnabled: false });
    yield* setTime("2026-10-07T13:00:00.000Z");
    assert.deepStrictEqual(yield* claim, []);
    yield* schedule.updateSettings({ remindersEnabled: true });
    assert.deepStrictEqual(yield* claim, ["c"]);

    const settings = yield* schedule.settings();
    assert.deepStrictEqual(
      [settings.scheduleTimeZone, settings.remindersEnabled, settings.reminderLeadMinutes],
      ["UTC", true, 60],
    );
    const refused = yield* Effect.flip(schedule.updateSettings({ scheduleTimeZone: "Mars/Base" }));
    assert.include(refused.message, "Mars/Base");
    // null follows the server's zone again.
    const cleared = yield* schedule.updateSettings({ scheduleTimeZone: null });
    assert.isNull(cleared.scheduleTimeZone);
    assert.isTrue(cleared.serverTimeZone.length > 0);
  }).pipe(Effect.provide(memoryStore)),
);

it.effect("no reminder for handled entries, finished tasks or entries that already started", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const repository = yield* TaskRepository;
    yield* setTime("2026-10-07T06:00:00.000Z");
    yield* inBerlin;
    const handled = yield* plan("handled", "09:30");
    yield* schedule.update({ id: handled, status: "done" });
    yield* plan("done", "09:30");
    yield* repository.update({
      actor: { type: "person" },
      id: TaskId.make("done"),
      status: "Done",
    });
    yield* plan("archived", "09:30");
    yield* repository.setArchived({
      ids: [TaskId.make("archived")],
      archived: true,
      actor: { type: "person" },
    });
    yield* plan("yesterday", "09:30", "2026-10-06");
    yield* plan("missed", "08:30");
    yield* plan("open", "09:30");

    // The server slept through 08:30 Berlin (06:30Z): that one is stale now.
    yield* setTime("2026-10-07T07:20:00.000Z");
    assert.deepStrictEqual(yield* claim, ["open"]);
    // Each was claimed, sent or not, so nothing is left due.
    const sql = yield* SqlClient.SqlClient;
    const left = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM task_schedule_entries
      WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL`;
    assert.equal(left[0]!.count, 0);

    // Reopening a handled entry before it starts brings its reminder back.
    yield* schedule.update({ id: handled, status: "open" });
    assert.deepStrictEqual(yield* claim, ["handled"]);
  }).pipe(Effect.provide(memoryStore)),
);

it.effect("the sweeper sends due reminders on its own", () =>
  Effect.gen(function* () {
    const changes = yield* Queue.unbounded<TaskChange>();
    yield* (yield* TaskRepository).changes.pipe(
      Stream.runForEach((change) => Queue.offer(changes, change)),
      Effect.forkScoped,
    );
    yield* inBerlin;
    yield* plan("a", "09:30");
    yield* setTime("2026-10-07T07:20:00.000Z");
    let change = yield* Queue.take(changes);
    while (change.reminders === undefined) change = yield* Queue.take(changes);
    assert.deepStrictEqual(
      change.reminders.map(({ taskId }) => taskId),
      [TaskId.make("a")],
    );
  }).pipe(
    Effect.provide(TaskReminderSweeperLive.pipe(Layer.provideMerge(memoryStore))),
    Effect.provide(Layer.effectDiscard(setTime("2026-10-07T06:00:00.000Z"))),
  ),
);
