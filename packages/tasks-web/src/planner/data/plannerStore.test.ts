import * as NodeAssert from "node:assert/strict";
import * as NodeTimersPromises from "node:timers/promises";
import { describe, test } from "vite-plus/test";
import type {
  TaskChange,
  TaskId,
  TaskPageInput,
  TaskPageResult,
  TaskScheduleEntry,
} from "@t3tools/tasks-contracts/v1";

import { PlannerStore } from "./plannerStore.ts";
import type { PlannerTask } from "./pendingOps.ts";

const T = "2026-10-07T10:00:00.000Z";

const task = (id: string, rank: string, patch: Partial<PlannerTask> = {}): PlannerTask =>
  ({
    id,
    rank,
    projectId: "project",
    title: id,
    description: "",
    output: null,
    status: "To Do",
    priority: null,
    createdBy: "person",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: [],
    createdAt: T,
    updatedAt: T,
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: T,
    audience: "person",
    kind: "task",
    runCounts: [],
    ...patch,
  }) as unknown as PlannerTask;

const entry = (
  id: string,
  taskId: string,
  date: string,
  position: string,
  patch: Partial<TaskScheduleEntry> = {},
): TaskScheduleEntry =>
  ({
    id,
    taskId,
    date,
    position,
    startTime: null,
    durationMinutes: null,
    status: "open",
    createdAt: T,
    updatedAt: T,
    ...patch,
  }) as TaskScheduleEntry;

const change = (patch: Partial<TaskChange> = {}): TaskChange => ({
  kind: "changed",
  sequence: 1,
  taskIds: [],
  listChanged: false,
  runsChanged: false,
  rootThreadIds: [],
  ...patch,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await NodeTimersPromises.setTimeout(2);
  }
  throw new Error("Condition did not settle");
}

type Handler = (input: any) => Promise<any>;

/** A fake environment: every RPC is recorded and answered by an overridable handler. */
function harness() {
  const calls: Array<{ method: string; input: any }> = [];
  const errors: string[] = [];
  let emitChange: ((change: TaskChange) => void) | undefined;
  let pageTasks: PlannerTask[] = [task("a", "0000000000000001"), task("b", "0000000000000002")];
  let rangeEntries: TaskScheduleEntry[] = [];
  const handlers: Record<string, Handler> = {
    page: async (_input: TaskPageInput): Promise<TaskPageResult> => ({
      tasks: pageTasks,
      nextCursor: null,
      statuses: [],
    }),
    items: async ({ ids }) => ({ tasks: pageTasks.filter((row) => ids.includes(row.id)) }),
    scheduleRange: async () => ({ entries: rangeEntries, tasks: [] }),
    scheduleProgress: async ({ taskIds }) => ({
      progress: taskIds.map((taskId: string) => ({ taskId, total: 2, handled: 1 })),
    }),
    scheduleForTask: async () => ({ entries: [], nextCursor: null }),
  };
  const method = (name: string) => (input: unknown) => {
    calls.push({ method: name, input });
    const handler = handlers[name];
    if (!handler) throw new Error(`No handler for ${name}`);
    return handler(input);
  };
  const names = [
    "page",
    "items",
    "update",
    "archive",
    "reorder",
    "reorderMany",
    "delete",
    "create",
    "scheduleRange",
    "scheduleProgress",
    "scheduleForTask",
    "scheduleAdd",
    "scheduleMove",
    "scheduleUpdate",
    "scheduleDelete",
  ];
  const tasks = Object.fromEntries(names.map((name) => [name, method(name)]));
  const client = {
    tasks: {
      ...tasks,
      subscribe: (listener: (change: TaskChange) => void) => {
        emitChange = listener;
        return () => {
          emitChange = undefined;
        };
      },
    },
  };
  const store = new PlannerStore(
    {
      environmentId: "local",
      client,
      access: { canReadTasks: true },
    } as never,
    { batchMs: 5, onError: (title) => errors.push(title), now: () => T },
  );
  return {
    store,
    calls,
    errors,
    handlers,
    setPage: (rows: PlannerTask[]) => {
      pageTasks = rows;
    },
    setRange: (rows: TaskScheduleEntry[]) => {
      rangeEntries = rows;
    },
    emit: (event: TaskChange) => emitChange?.(event),
    count: (name: string) => calls.filter((call) => call.method === name).length,
    reset: () => {
      calls.length = 0;
    },
  };
}

async function started(h: ReturnType<typeof harness>) {
  h.store.retain();
  h.emit(change({ kind: "sync", listChanged: true }));
  h.store.setRange("2026-10-06", "2026-10-08");
  await until(() => h.count("page") >= 1 && h.count("scheduleRange") >= 1);
  await until(() => h.store.getSnapshot().active.status === "Exhausted");
  await NodeTimersPromises.setTimeout(15);
  h.reset();
}

const dayIds = (h: ReturnType<typeof harness>, date: string) =>
  (h.store.getSnapshot().view.days.get(date) ?? []).map((row) => row.id);

describe("planner store: change events", () => {
  test("a schedule change refetches the loaded days only when a changed date is on screen", async () => {
    const h = harness();
    await started(h);
    h.emit(change({ scheduleDates: ["2026-11-20"], taskIds: ["a" as TaskId] }));
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("scheduleRange"), 0);
    h.emit(change({ scheduleDates: ["2026-10-07"], taskIds: ["a" as TaskId] }));
    h.emit(change({ scheduleDates: ["2026-10-08"], taskIds: ["b" as TaskId] }));
    await until(() => h.count("scheduleRange") === 1);
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("scheduleRange"), 1, "two changes in one batch, one read");
    NodeAssert.equal(h.count("items"), 0, "schedule-only writes do not reload list rows");
    NodeAssert.equal(h.count("page"), 0);
  });

  test("a schedule change refreshes the progress of exactly the tracked tasks it names", async () => {
    const h = harness();
    await started(h);
    h.store.trackProgress(["a", "b"]);
    await until(() => h.count("scheduleProgress") === 1);
    NodeAssert.deepEqual(h.calls.at(-1)!.input.taskIds, ["a", "b"]);
    h.reset();
    h.emit(change({ scheduleDates: ["2026-12-01"], taskIds: ["b" as TaskId, "z" as TaskId] }));
    await until(() => h.count("scheduleProgress") === 1);
    NodeAssert.deepEqual(
      h.calls.find((call) => call.method === "scheduleProgress")!.input.taskIds,
      ["b"],
    );
    NodeAssert.deepEqual(h.store.getSnapshot().progress.get("b"), { total: 2, handled: 1 });
  });

  test("a detail window's schedule follows its task's changes", async () => {
    const h = harness();
    await started(h);
    const stop = h.store.watchSchedule("a");
    await until(() => h.count("scheduleForTask") === 1);
    h.emit(change({ scheduleDates: ["2026-12-01"], taskIds: ["b" as TaskId] }));
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("scheduleForTask"), 1);
    h.emit(change({ scheduleDates: ["2026-12-01"], taskIds: ["a" as TaskId] }));
    await until(() => h.count("scheduleForTask") === 2);
    stop();
    h.emit(change({ scheduleDates: ["2026-12-01"], taskIds: ["a" as TaskId] }));
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("scheduleForTask"), 2);
  });

  test("an edited task that only a day shows is reloaded by itself", async () => {
    const h = harness();
    h.handlers.scheduleRange = async () => ({
      entries: [entry("e1", "x", "2026-10-07", "0000000000000001")],
      tasks: [task("x", "0000000000000009")],
    });
    await started(h);
    h.handlers.items = async ({ ids }) => ({
      tasks: ids.map((id: string) => task(id, "0000000000000009", { title: "renamed" })),
    });
    h.emit(change({ taskIds: ["x" as TaskId] }));
    await until(() => h.store.getSnapshot().view.tasks.get("x")?.title === "renamed");
    NodeAssert.deepEqual(
      h.calls.filter((call) => call.method === "items").map((call) => call.input.ids),
      [["x"]],
    );
  });

  test("a sync reloads lists, days, progress and open schedules", async () => {
    const h = harness();
    await started(h);
    h.store.trackProgress(["a"]);
    h.store.watchSchedule("a");
    await until(() => h.count("scheduleForTask") === 1 && h.count("scheduleProgress") === 1);
    h.reset();
    h.emit(change({ kind: "sync", listChanged: true }));
    await until(
      () =>
        h.count("page") >= 1 &&
        h.count("scheduleRange") === 1 &&
        h.count("scheduleProgress") === 1 &&
        h.count("scheduleForTask") === 1,
    );
  });
});

describe("planner store: optimistic writes", () => {
  test("a move shows at once and a failed one returns to the server's state", async () => {
    const h = harness();
    h.setRange([
      entry("e1", "a", "2026-10-07", "0000000000000001"),
      entry("e2", "b", "2026-10-07", "0000000000000002"),
    ]);
    await started(h);
    const response = deferred<never>();
    h.handlers.scheduleMove = () => response.promise;
    const moved = h.store.moveEntries({
      ids: ["e2" as never],
      date: "2026-10-08",
      placement: { at: "bottom" },
    });
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["e1"]);
    NodeAssert.deepEqual(dayIds(h, "2026-10-08"), ["e2"]);
    response.reject(new Error("offline"));
    NodeAssert.equal(await moved, false);
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["e1", "e2"]);
    NodeAssert.deepEqual(h.errors, ["Could not move the entry"]);
  });

  test("a done toggle hides the row at once and a stale page read cannot bring it back", async () => {
    const h = harness();
    await started(h);
    const stalePage = deferred<TaskPageResult>();
    h.handlers.page = () => stalePage.promise;
    h.emit(change({ listChanged: true }));
    await until(() => h.count("page") === 1);
    // The read above started before the write; it answers after the write did.
    h.handlers.update = async (input) => task(input.id, "0000000000000001", { status: "Done" });
    NodeAssert.equal(await h.store.updateTask("a", { status: "Done" }), true);
    stalePage.resolve({
      tasks: [task("a", "0000000000000001"), task("b", "0000000000000002")],
      nextCursor: null,
      statuses: [],
    });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["b"]);
  });

  test("a reorder keeps its order against a read that started before it", async () => {
    const h = harness();
    await started(h);
    const stalePage = deferred<TaskPageResult>();
    h.handlers.page = () => stalePage.promise;
    h.emit(change({ listChanged: true }));
    await until(() => h.count("page") === 1);
    h.handlers.reorder = async (input) => task(input.id, "0000000000000000");
    const reordered = h.store.reorder(["b"], { beforeTaskId: "a" });
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["b", "a"], "optimistic");
    await reordered;
    stalePage.resolve({
      tasks: [task("a", "0000000000000001"), task("b", "0000000000000002")],
      nextCursor: null,
      statuses: [],
    });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["b", "a"]);
  });

  test("a moved entry stays where it went when an older day read answers late", async () => {
    const h = harness();
    h.setRange([entry("e1", "a", "2026-10-07", "0000000000000001")]);
    await started(h);
    const staleRange = deferred<unknown>();
    h.handlers.scheduleRange = () => staleRange.promise;
    h.emit(change({ scheduleDates: ["2026-10-07"] }));
    await until(() => h.count("scheduleRange") === 1);
    h.handlers.scheduleMove = async () => ({
      entries: [entry("e1", "a", "2026-10-08", "0000000000000001", { updatedAt: T })],
    });
    await h.store.moveEntries({ ids: ["e1" as never], date: "2026-10-08" });
    staleRange.resolve({
      entries: [entry("e1", "a", "2026-10-07", "0000000000000001")],
      tasks: [],
    });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), []);
    NodeAssert.deepEqual(dayIds(h, "2026-10-08"), ["e1"]);
  });

  test("an added entry is not dropped by a day read that started before it existed", async () => {
    const h = harness();
    await started(h);
    const staleRange = deferred<unknown>();
    h.handlers.scheduleRange = () => staleRange.promise;
    h.emit(change({ scheduleDates: ["2026-10-07"] }));
    await until(() => h.count("scheduleRange") === 1);
    h.handlers.scheduleAdd = async () => ({
      entries: [entry("e9", "a", "2026-10-07", "0000000000000005")],
    });
    const added = h.store.addEntries({ taskIds: ["a" as TaskId], date: "2026-10-07" });
    NodeAssert.equal(dayIds(h, "2026-10-07").length, 1, "optimistic entry");
    await added;
    staleRange.resolve({ entries: [], tasks: [] });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["e9"]);
  });

  test("a deleted entry is not brought back by a late read", async () => {
    const h = harness();
    h.setRange([entry("e1", "a", "2026-10-07", "0000000000000001")]);
    await started(h);
    const staleRange = deferred<unknown>();
    h.handlers.scheduleRange = () => staleRange.promise;
    h.emit(change({ scheduleDates: ["2026-10-07"] }));
    await until(() => h.count("scheduleRange") === 1);
    h.handlers.scheduleDelete = async () => ({
      entries: [entry("e1", "a", "2026-10-07", "0000000000000001")],
    });
    await h.store.deleteEntries(["e1"]);
    staleRange.resolve({
      entries: [entry("e1", "a", "2026-10-07", "0000000000000001")],
      tasks: [],
    });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), []);
  });

  test("entries added by a drop land where the server will put them", async () => {
    const h = harness();
    h.setRange([
      entry("e1", "a", "2026-10-07", "0000000000000001", { startTime: "09:00" }),
      entry("e2", "b", "2026-10-07", "0000000000000002"),
      entry("e3", "b", "2026-10-07", "0000000000000003", { startTime: "13:00" }),
    ]);
    await started(h);
    h.handlers.scheduleAdd = () => new Promise(() => undefined);
    void h.store.addEntries({ taskIds: ["a" as TaskId], date: "2026-10-07", startTime: "11:00" });
    const ids = dayIds(h, "2026-10-07");
    NodeAssert.equal(ids[2]!.startsWith("pending-entry-"), true, "before the 13:00 entry");
    NodeAssert.deepEqual([ids[0], ids[1], ids[3]], ["e1", "e2", "e3"]);
  });
});
