import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskId, type TaskChange, type TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { runExperimentalFeatureMigrations } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TaskScheduleService, TaskScheduleServiceLive } from "./TaskScheduleService.ts";

const timestamp = "2026-10-07T10:00:00.000Z";
const monday = "2026-10-05";
const tuesday = "2026-10-06";
const wednesday = "2026-10-07";

/** A fresh in-memory store per test. */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, TaskScheduleService | TaskRepository | Scope.Scope>,
) =>
  it.effect(name, () =>
    Effect.scoped(body()).pipe(
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

const createTasks = (...ids: string[]) =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    for (const id of ids)
      yield* repository.upsert({
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
        createdAt: timestamp,
        updatedAt: timestamp,
        audience: "person",
      });
    return ids.map((id) => TaskId.make(id));
  });

/** Task ids of a date's entries, in queue order. */
const day = (date: string) =>
  Effect.gen(function* () {
    const entries = yield* (yield* TaskRepository).scheduleEntries({ dates: [date] });
    return entries.map(({ taskId }) => taskId as string);
  });

const ids = (entries: ReadonlyArray<TaskScheduleEntry>) => entries.map(({ id }) => id);

/**
 * Subscribes to task changes; `next` waits for the next one. The subscription
 * is live once its initial sync arrived.
 */
const watchChanges = Effect.gen(function* () {
  const changes = yield* Queue.unbounded<TaskChange>();
  yield* (yield* TaskRepository).changes.pipe(
    Stream.runForEach((change) => Queue.offer(changes, change)),
    Effect.forkScoped,
  );
  assert.equal((yield* Queue.take(changes)).kind, "sync");
  return { next: Queue.take(changes), pending: Queue.size(changes) };
});

test("adds entries at each placement, keeping the given task order", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b, c, d, e] = yield* createTasks("a", "b", "c", "d", "e");
    const first = yield* schedule.add({ taskIds: [a!, b!], date: monday });
    assert.deepStrictEqual(yield* day(monday), ["a", "b"]);
    assert.deepStrictEqual(
      first.entries.map(({ status, startTime }) => [status, startTime]),
      [
        ["open", null],
        ["open", null],
      ],
    );
    yield* schedule.add({ taskIds: [c!], date: monday, placement: { at: "top" } });
    yield* schedule.add({
      taskIds: [d!],
      date: monday,
      placement: { before: first.entries[1]!.id },
    });
    yield* schedule.add({
      taskIds: [e!],
      date: monday,
      placement: { after: first.entries[0]!.id },
    });
    assert.deepStrictEqual(yield* day(monday), ["c", "a", "e", "d", "b"]);

    // A task may be planned twice on one day; an anchor must be on the target date.
    yield* schedule.add({ taskIds: [a!], date: monday, placement: { at: "bottom" } });
    assert.deepStrictEqual(yield* day(monday), ["c", "a", "e", "d", "b", "a"]);
    const refused = yield* Effect.flip(
      schedule.add({ taskIds: [a!], date: tuesday, placement: { after: first.entries[0]!.id } }),
    );
    assert.include(refused.message, "is not on the target date");
    const missing = yield* Effect.flip(
      schedule.add({ taskIds: [TaskId.make("ghost")], date: tuesday }),
    );
    assert.include(missing.message, "'ghost' was not found");
  }));

test("moves keep ids, status and relative order, within a day and across days", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b, c, d] = yield* createTasks("ma", "mb", "mc", "md");
    const { entries } = yield* schedule.add({ taskIds: [a!, b!, c!, d!], date: monday });
    const [ea, eb, ec] = entries;
    yield* schedule.update({ id: eb!.id, status: "done" });

    // Selected out of order and spread over the day, they move as one block.
    const moved = yield* schedule.move({
      ids: [ec!.id, ea!.id],
      date: monday,
      placement: { at: "bottom" },
    });
    assert.deepStrictEqual(yield* day(monday), ["mb", "md", "ma", "mc"]);
    assert.deepStrictEqual(ids(moved.entries), [ea!.id, ec!.id]);

    const across = yield* schedule.move({ ids: [eb!.id, ec!.id], date: tuesday });
    assert.deepStrictEqual(yield* day(monday), ["md", "ma"]);
    assert.deepStrictEqual(yield* day(tuesday), ["mb", "mc"]);
    assert.deepStrictEqual(
      across.entries.map(({ id, status, date }) => [id, status, date]),
      [
        [eb!.id, "done", tuesday],
        [ec!.id, "open", tuesday],
      ],
    );
  }));

test("copies entries to several dates as new open entries with their timing", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b] = yield* createTasks("ca", "cb");
    const { entries } = yield* schedule.add({ taskIds: [a!, b!], date: monday });
    yield* schedule.update({ id: entries[0]!.id, status: "done", startTime: "09:30" });
    yield* schedule.update({ id: entries[1]!.id, durationMinutes: 45 });

    const copied = yield* schedule.copy({
      ids: [entries[1]!.id, entries[0]!.id],
      dates: [tuesday, wednesday],
    });
    assert.equal(copied.entries.length, 4);
    for (const date of [tuesday, wednesday]) {
      const onDate = copied.entries.filter((entry) => entry.date === date);
      assert.deepStrictEqual(
        onDate.map(({ taskId, status, startTime, durationMinutes }) => [
          taskId,
          status,
          startTime,
          durationMinutes,
        ]),
        [
          ["ca", "open", "09:30", null],
          ["cb", "open", null, 45],
        ],
      );
    }
    assert.notInclude(ids(copied.entries), entries[0]!.id);
    assert.deepStrictEqual(yield* day(monday), ["ca", "cb"]);
  }));

test("moveOpen carries only open entries to the end of the next date, in order", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b, c, d] = yield* createTasks("oa", "ob", "oc", "od");
    const { entries } = yield* schedule.add({ taskIds: [a!, b!, c!], date: monday });
    yield* schedule.update({ id: entries[1]!.id, status: "done" });
    yield* schedule.update({ id: entries[2]!.id, startTime: "14:00" });
    yield* schedule.add({ taskIds: [d!], date: tuesday });

    const moved = yield* schedule.moveOpen({ fromDate: monday, toDate: tuesday });
    assert.deepStrictEqual(ids(moved.entries), [entries[0]!.id, entries[2]!.id]);
    assert.deepStrictEqual(yield* day(monday), ["ob"]);
    assert.deepStrictEqual(yield* day(tuesday), ["od", "oa", "oc"]);
    assert.equal(moved.entries[1]!.startTime, "14:00", "timing is kept");
    assert.deepStrictEqual(
      (yield* schedule.moveOpen({ fromDate: monday, toDate: tuesday })).entries,
      [],
    );
  }));

test("a used-up gap renumbers only that day and keeps its order", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b, x, other] = yield* createTasks("ra", "rb", "rx", "rother");
    const { entries } = yield* schedule.add({ taskIds: [a!, b!], date: monday });
    const elsewhere = yield* schedule.add({ taskIds: [other!], date: tuesday });
    // Each insert halves the gap after `a`; 40 inserts exhaust 32 bits of it.
    for (let index = 0; index < 40; index += 1)
      yield* schedule.add({
        taskIds: [x!],
        date: monday,
        placement: { after: entries[0]!.id },
      });
    const order = yield* day(monday);
    assert.equal(order.length, 42);
    assert.equal(order[0], "ra");
    assert.equal(order[41], "rb");
    const positions = (yield* (yield* TaskRepository).scheduleEntries({ dates: [monday] })).map(
      ({ position }) => position,
    );
    assert.equal(new Set(positions).size, 42);
    const [untouched] = yield* (yield* TaskRepository).scheduleEntries({
      ids: ids(elsewhere.entries),
    });
    assert.equal(untouched!.position, elsewhere.entries[0]!.position);
  }));

test("a timed drop goes before the first later entry and leaves untimed ones in place", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [u1, nine, u2, eleven, dropped] = yield* createTasks("u1", "t9", "u2", "t11", "td");
    const { entries } = yield* schedule.add({
      taskIds: [u1!, nine!, u2!, eleven!],
      date: tuesday,
    });
    yield* schedule.update({ id: entries[1]!.id, startTime: "09:00" });
    yield* schedule.update({ id: entries[3]!.id, startTime: "11:00" });
    const source = yield* schedule.add({ taskIds: [dropped!], date: monday });

    yield* schedule.move({
      ids: ids(source.entries),
      date: tuesday,
      startTime: "10:00",
      durationMinutes: 30,
    });
    assert.deepStrictEqual(yield* day(tuesday), ["u1", "t9", "u2", "td", "t11"]);
    const [placed] = yield* (yield* TaskRepository).scheduleEntries({
      ids: ids(source.entries),
    });
    assert.deepStrictEqual([placed!.startTime, placed!.durationMinutes], ["10:00", 30]);

    // Later than every timed entry: last. Clearing the time keeps the place.
    yield* schedule.move({ ids: ids(source.entries), date: tuesday, startTime: "18:00" });
    assert.deepStrictEqual(yield* day(tuesday), ["u1", "t9", "u2", "t11", "td"]);
    yield* schedule.update({ id: source.entries[0]!.id, startTime: null });
    assert.deepStrictEqual(yield* day(tuesday), ["u1", "t9", "u2", "t11", "td"]);
  }));

test("deleting a task deletes its entries and names their dates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const schedule = yield* TaskScheduleService;
      const repository = yield* TaskRepository;
      const [gone, kept] = yield* createTasks("gone", "kept");
      yield* schedule.add({ taskIds: [gone!, kept!], date: monday });
      yield* schedule.add({ taskIds: [gone!], date: wednesday });

      const { next } = yield* watchChanges;
      yield* repository.deleteTask({ id: gone! });
      const change = yield* next;
      assert.deepStrictEqual(change.taskIds.map(String), ["gone"]);
      assert.deepStrictEqual(change.scheduleDates, [monday, wednesday]);
      assert.deepStrictEqual(yield* day(monday), ["kept"]);
      assert.deepStrictEqual(yield* day(wednesday), []);
      assert.deepStrictEqual(
        (yield* schedule.forTask({ taskId: gone! })).entries,
        [],
        "no orphaned entries",
      );
    }),
  ));

test("each write publishes one change with its dates and tasks, never the list", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const schedule = yield* TaskScheduleService;
      const [a, b] = yield* createTasks("wa", "wb");
      const { next, pending } = yield* watchChanges;

      const added = yield* schedule.add({ taskIds: [a!, b!], date: monday });
      const addChange = yield* next;
      assert.deepStrictEqual(addChange.scheduleDates, [monday]);
      assert.deepStrictEqual([...addChange.taskIds].toSorted(), ["wa", "wb"]);
      assert.equal(addChange.listChanged, false);

      yield* schedule.move({ ids: [added.entries[1]!.id], date: wednesday });
      const moveChange = yield* next;
      assert.deepStrictEqual(moveChange.scheduleDates, [monday, wednesday]);
      assert.deepStrictEqual(moveChange.taskIds.map(String), ["wb"]);

      yield* schedule.copy({ ids: [added.entries[0]!.id], dates: [tuesday, wednesday] });
      assert.deepStrictEqual((yield* next).scheduleDates, [tuesday, wednesday]);

      yield* schedule.update({ id: added.entries[0]!.id, status: "skipped" });
      assert.deepStrictEqual((yield* next).scheduleDates, [monday]);

      yield* schedule.remove({ ids: [added.entries[0]!.id] });
      const removeChange = yield* next;
      assert.deepStrictEqual(removeChange.scheduleDates, [monday]);
      assert.deepStrictEqual(removeChange.taskIds.map(String), ["wa"]);
      // One change per write: nothing else is queued.
      assert.equal(yield* pending, 0);
    }),
  ));

test("reads a range with its tasks once, a task's entries, and progress", () =>
  Effect.gen(function* () {
    const schedule = yield* TaskScheduleService;
    const [a, b, idle] = yield* createTasks("pa", "pb", "pidle");
    const first = yield* schedule.add({ taskIds: [a!, b!], date: monday, startTime: "08:00" });
    yield* schedule.add({ taskIds: [a!], date: wednesday });
    yield* schedule.update({ id: first.entries[0]!.id, status: "done" });

    const range = yield* schedule.range({ from: monday, to: wednesday });
    const ours = range.entries.filter(({ taskId }) => ["pa", "pb"].includes(taskId));
    assert.deepStrictEqual(
      ours.map(({ taskId, date }) => [taskId, date]),
      [
        ["pa", monday],
        ["pb", monday],
        ["pa", wednesday],
      ],
    );
    const titles = range.tasks.map(({ title }) => title);
    assert.equal(titles.filter((title) => title === "pa").length, 1);
    assert.equal(range.tasks.find(({ id }) => id === "pa")?.audience, "person");

    const page = yield* schedule.forTask({ taskId: a!, limit: 1 });
    assert.deepStrictEqual(
      page.entries.map(({ date }) => date),
      [monday],
    );
    const rest = yield* schedule.forTask({ taskId: a!, cursor: page.nextCursor! });
    assert.deepStrictEqual(
      rest.entries.map(({ date }) => date),
      [wednesday],
    );
    assert.equal(rest.nextCursor, null);

    const { progress } = yield* schedule.progress({ taskIds: [a!, idle!] });
    assert.deepStrictEqual(progress, [
      { taskId: a!, total: 2, handled: 1 },
      { taskId: idle!, total: 0, handled: 0 },
    ]);
    const ranged = yield* schedule.progress({ taskIds: [a!], from: tuesday, to: wednesday });
    assert.deepStrictEqual(ranged.progress, [{ taskId: a!, total: 1, handled: 0 }]);

    const tooLong = yield* Effect.flip(schedule.range({ from: "2026-01-01", to: "2026-03-05" }));
    assert.include(tooLong.message, "at most 62 days");
    const backwards = yield* Effect.flip(schedule.range({ from: tuesday, to: monday }));
    assert.include(backwards.message, "ends before it starts");
  }));
