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
  let subscribes = 0;
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
    "unarchive",
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
        subscribes += 1;
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
    { batchMs: 5, releaseMs: 20, onError: (title) => errors.push(title), now: () => T },
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
    get subscribes() {
      return subscribes;
    },
    get live() {
      return emitChange !== undefined;
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

describe("planner store: the person's tasks only", () => {
  const ids = (h: ReturnType<typeof harness>) => h.store.getSnapshot().active.ids;
  const pageAudiences = (h: ReturnType<typeof harness>) =>
    h.calls.filter((call) => call.method === "page").map((call) => call.input.audience);

  test("asks the server for the person's tasks and lists only them", async () => {
    const h = harness();
    h.setPage([
      task("mine", "0000000000000001"),
      task("theirs", "0000000000000002", { audience: "agent", status: "Needs Review" }),
    ]);
    await started(h);
    // Even an agent row an older server sends along stays out.
    NodeAssert.deepEqual(ids(h), ["mine"]);

    h.store.setQuery({ projectIds: null, archiveVisible: true, kind: "task" });
    await until(() => h.store.getSnapshot().active.status === "Exhausted" && h.count("page") > 0);
    NodeAssert.deepEqual(pageAudiences(h), ["person", "person", "person"]);
  });

  test("Tasks lists leave out what automations created", async () => {
    const h = harness();
    h.setPage([
      task("mine", "0000000000000001"),
      task("generated", "0000000000000002", { createdBy: "automation:task-automation-1" }),
    ]);
    await started(h);
    h.store.setQuery({ projectIds: null, archiveVisible: true, kind: "task" });
    await until(() => h.store.getSnapshot().active.status === "Exhausted" && h.count("page") > 0);
    const pages = h.calls.filter((call) => call.method === "page").map((call) => call.input);
    NodeAssert.ok(pages.length === 3, "active, done and archived");
    NodeAssert.ok(pages.every((input) => input.excludeAutomationTasks === true));
    NodeAssert.deepEqual(ids(h), ["mine"]);
  });

  test("handing a task to agents takes it out of the planner at once", async () => {
    const h = harness();
    const response = deferred<PlannerTask>();
    h.handlers.update = () => response.promise;
    await started(h);
    void h.store.updateTask("a", { audience: "agent" });
    NodeAssert.deepEqual(ids(h), ["b"]);
    NodeAssert.deepEqual(h.calls.at(-1), {
      method: "update",
      input: { id: "a", audience: "agent" },
    });

    response.resolve(task("a", "0000000000000001", { audience: "agent" }));
    await NodeTimersPromises.setTimeout(10);
    NodeAssert.deepEqual(ids(h), ["b"]);
  });

  test("days leave out agent tasks' entries, and show them again once taken back", async () => {
    const h = harness();
    h.setRange([
      entry("mine", "a", "2026-10-07", "0000000000000001"),
      entry("theirs", "b", "2026-10-07", "0000000000000002"),
    ]);
    await started(h);
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["mine", "theirs"]);

    h.handlers.update = async ({ id, audience }) =>
      task(id, id === "a" ? "0000000000000001" : "0000000000000002", { audience });
    await h.store.updateTask("b", { audience: "agent" });
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["mine"]);
    // The entry is kept, not deleted: taking the task back shows it again.
    NodeAssert.equal(h.count("scheduleDelete"), 0);
    await h.store.updateTask("b", { audience: "person" });
    NodeAssert.deepEqual(dayIds(h, "2026-10-07"), ["mine", "theirs"]);
  });
});

describe("planner store: restore", () => {
  const ARCHIVED_AT = "2026-10-01T10:00:00.000Z";
  const everything = { projectIds: null, archiveVisible: true, kind: "task" } as const;

  /** A fake server that records the order of writes and which agents an unarchive would start. */
  async function restoring(rows: PlannerTask[]) {
    const h = harness();
    const server = new Map<string, PlannerTask>(rows.map((row) => [row.id, row]));
    const writes: string[] = [];
    const startedOnUnarchive: string[] = [];
    h.setPage(rows);
    h.handlers.page = async () => ({ tasks: [...server.values()], nextCursor: null, statuses: [] });
    h.handlers.items = async ({ ids }) => ({
      tasks: [...server.values()].filter((row) => ids.includes(row.id)),
    });
    h.handlers.update = async ({ id, status }) => {
      writes.push(`status ${id} ${status}`);
      const row = { ...server.get(id)!, status };
      server.set(id, row);
      return row;
    };
    h.handlers.unarchive = async ({ ids }) => {
      for (const id of ids as string[]) {
        writes.push(`unarchive ${id}`);
        const row = server.get(id)!;
        // An agent with this tag starts on an unarchived To Do agent task.
        if (row.audience === "agent" && row.status === "To Do" && row.tags.includes("dev"))
          startedOnUnarchive.push(id);
        server.set(id, { ...row, archivedAt: null });
      }
      return { results: [] };
    };
    h.store.setQuery(everything);
    await started(h);
    return { h, server, writes, startedOnUnarchive };
  }

  test("an agent task, archived or Done, comes back Restored and its status is written first", async () => {
    const { h, server, writes, startedOnUnarchive } = await restoring([
      task("archived", "0000000000000001", {
        audience: "agent",
        tags: ["dev"],
        archivedAt: ARCHIVED_AT,
      }),
      task("done", "0000000000000002", { audience: "agent", tags: ["dev"], status: "Done" }),
    ]);
    // The planner lists no agent tasks; a task window restores one (an automation's task).
    const restored = h.store.restore(["archived", "done"]);
    const optimistic = h.store.getSnapshot();
    NodeAssert.equal(optimistic.view.tasks.get("archived")?.status, "Restored");
    NodeAssert.equal(optimistic.view.tasks.get("archived")?.archivedAt, null);
    NodeAssert.equal(await restored, true);

    NodeAssert.deepEqual(writes, [
      "status archived Restored",
      "status done Restored",
      "unarchive archived",
    ]);
    NodeAssert.deepEqual(startedOnUnarchive, []);
    for (const id of ["archived", "done"])
      NodeAssert.deepEqual(
        [server.get(id)!.status, server.get(id)!.archivedAt],
        ["Restored", null],
      );
  });

  test("a failed status write unarchives nothing", async () => {
    const { h, writes } = await restoring([
      task("archived", "0000000000000001", {
        audience: "agent",
        tags: ["dev"],
        archivedAt: ARCHIVED_AT,
      }),
    ]);
    h.handlers.update = async () => {
      throw new Error("offline");
    };
    NodeAssert.equal(await h.store.restore(["archived"]), false);
    NodeAssert.deepEqual(writes, []);
    NodeAssert.equal(h.count("unarchive"), 0);
    NodeAssert.deepEqual(h.errors, ["Could not restore the task"]);
    NodeAssert.equal(h.store.getSnapshot().view.tasks.get("archived")?.archivedAt, ARCHIVED_AT);
  });

  test("a person task keeps its own Restore: Done is To Do again, archived is only unarchived", async () => {
    const { h, server, writes } = await restoring([
      task("done", "0000000000000001", { status: "Done" }),
      task("archived", "0000000000000002", { status: "Waiting", archivedAt: ARCHIVED_AT }),
    ]);
    NodeAssert.equal(await h.store.restore(["done", "archived"]), true);
    NodeAssert.deepEqual(writes, ["status done To Do", "unarchive archived"]);
    NodeAssert.deepEqual(
      ["done", "archived"].map((id) => server.get(id)!.status),
      ["To Do", "Waiting"],
    );
  });
});

describe("planner store: routines", () => {
  const routinesQuery = { projectIds: null, archiveVisible: false, kind: "routine" } as const;

  test("Routines asks for the person's routines and lists only them", async () => {
    const h = harness();
    h.setPage([
      task("todo", "0000000000000001"),
      task("stretch", "0000000000000002", { kind: "routine" }),
    ]);
    await started(h);
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["todo"]);

    h.store.setQuery(routinesQuery);
    await until(() => h.store.getSnapshot().active.status === "Exhausted" && h.count("page") > 0);
    const pages = h.calls.filter((call) => call.method === "page").map((call) => call.input);
    NodeAssert.deepEqual(
      pages.map(({ kind, audience }) => [kind, audience]),
      [["routine", "person"]],
    );
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["stretch"]);
  });

  test("a routine's progress counts the given week, and a new week asks again", async () => {
    const h = harness();
    await started(h);
    h.store.trackProgress(["a"], { from: "2026-10-05", to: "2026-10-11" });
    await until(() => h.count("scheduleProgress") === 1);
    NodeAssert.deepEqual(h.calls.at(-1)!.input, {
      taskIds: ["a"],
      from: "2026-10-05",
      to: "2026-10-11",
    });
    // The same week again is no new read; another week (or none) is.
    h.store.trackProgress(["a"], { from: "2026-10-05", to: "2026-10-11" });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("scheduleProgress"), 1);
    h.store.trackProgress(["a"], null);
    await until(() => h.count("scheduleProgress") === 2);
    NodeAssert.deepEqual(h.calls.at(-1)!.input, { taskIds: ["a"] });
  });

  test("a routine is created as the person's routine", async () => {
    const h = harness();
    h.handlers.create = async (input) => task("new", "0000000000000000", input);
    await started(h);
    h.store.setQuery(routinesQuery);
    await h.store.createTask({ title: "stretch", description: "", kind: "routine" });
    const created = h.calls.find((call) => call.method === "create")!.input;
    NodeAssert.deepEqual([created.kind, created.audience], ["routine", "person"]);
    NodeAssert.ok(h.store.getSnapshot().active.ids.includes("new"));
  });
});

describe("planner store: between mounts", () => {
  test("a remount within the release grace stays live and reads nothing again", async () => {
    const h = harness();
    await started(h);
    const active = h.store.getSnapshot().active;
    // `started` holds one retain; the panel's planner adds and drops another on a thread switch.
    const release = h.store.retain();
    release();
    const again = h.store.retain();
    await NodeTimersPromises.setTimeout(40);
    NodeAssert.equal(h.subscribes, 1);
    NodeAssert.equal(h.calls.length, 0);
    NodeAssert.equal(h.store.getSnapshot().active, active);
    again();
    NodeAssert.ok(h.live);
  });

  test("the last release stops following changes after the grace; a later mount starts from the kept pages", async () => {
    const h = harness();
    const release = h.store.retain();
    h.emit(change({ kind: "sync", listChanged: true }));
    await until(() => h.store.getSnapshot().active.status === "Exhausted");
    release();
    NodeAssert.ok(h.live);
    await until(() => !h.live);
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, []);
    // Mounted again later: rows at once from the kept pages, then one background read.
    h.reset();
    h.store.retain();
    NodeAssert.equal(h.store.getSnapshot().active.status, "Exhausted");
    NodeAssert.deepEqual(h.store.getSnapshot().active.ids, ["a", "b"]);
    NodeAssert.equal(h.subscribes, 2);
  });

  test("a background read keeps the objects of unchanged tasks and entries", async () => {
    const h = harness();
    h.setRange([entry("e1", "a", "2026-10-07", "1"), entry("e2", "b", "2026-10-07", "2")]);
    await started(h);
    const tasks = h.store.getSnapshot().view.tasks;
    const [e1, e2] = h.store.getSnapshot().view.days.get("2026-10-07")!;
    h.setPage([task("a", "0000000000000001"), task("b", "0000000000000002", { title: "B" })]);
    h.setRange([
      entry("e1", "a", "2026-10-07", "1"),
      entry("e2", "b", "2026-10-07", "2", { startTime: "09:00" }),
    ]);
    h.emit(change({ kind: "sync", listChanged: true }));
    await until(() => h.store.getSnapshot().view.tasks.get("b")?.title === "B");
    await until(
      () => h.store.getSnapshot().view.days.get("2026-10-07")?.[1]?.startTime === "09:00",
    );
    const next = h.store.getSnapshot();
    NodeAssert.equal(next.view.tasks.get("a"), tasks.get("a"));
    NodeAssert.notEqual(next.view.tasks.get("b"), tasks.get("b"));
    NodeAssert.equal(next.view.days.get("2026-10-07")?.[0], e1);
    NodeAssert.notEqual(next.view.days.get("2026-10-07")?.[1], e2);
  });
});
