import * as NodeAssert from "node:assert/strict";
import * as NodeTimersPromises from "node:timers/promises";
import { describe, test } from "vite-plus/test";
import type { TaskAutomationListItem, TaskChange } from "@t3tools/tasks-contracts/v1";

import { AutomationStore, moveAutomationId, orderAutomations } from "./automationStore.ts";

const T = "2026-10-07T10:00:00.000Z";

const automation = (
  id: string,
  rank: string | undefined,
  patch: Partial<TaskAutomationListItem> = {},
): TaskAutomationListItem =>
  ({
    id,
    ...(rank === undefined ? {} : { rank }),
    projectId: "project",
    name: id,
    status: "draft",
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    template: { title: id, description: "", status: "new", priority: null, tags: [] },
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
    createdAt: T,
    updatedAt: T,
    taskCount: 0,
    ...patch,
  }) as TaskAutomationListItem;

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

function harness(rows: TaskAutomationListItem[]) {
  let current = rows;
  const calls: Array<{ method: string; input: unknown }> = [];
  const errors: string[] = [];
  let emit: ((change: TaskChange) => void) | undefined;
  const handlers: Record<string, (input: any) => Promise<any>> = {
    search: async () => ({ automations: current }),
  };
  const method = (name: string) => (input: unknown) => {
    calls.push({ method: name, input });
    return handlers[name]!(input);
  };
  const client = {
    tasks: {
      subscribe: (listener: (change: TaskChange) => void) => {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
    },
    automations: Object.fromEntries(
      ["search", "upsert", "setStatus", "delete", "reorder"].map((name) => [name, method(name)]),
    ),
  };
  const store = new AutomationStore(client as never, {
    batchMs: 5,
    releaseMs: 20,
    onError: (title) => errors.push(title),
  });
  return {
    store,
    calls,
    errors,
    handlers,
    setRows: (next: TaskAutomationListItem[]) => {
      current = next;
    },
    emit: (change: Partial<TaskChange>) =>
      emit?.({
        kind: "changed",
        sequence: 1,
        taskIds: [],
        listChanged: false,
        runsChanged: false,
        rootThreadIds: [],
        ...change,
      }),
    count: (name: string) => calls.filter((call) => call.method === name).length,
    ids: () => store.getSnapshot().automations.map(({ id }) => id),
    get live() {
      return emit !== undefined;
    },
  };
}

describe("automation store", () => {
  test("orders by rank, and keeps an older server's order without ranks", () => {
    const rows = [automation("b", "0000000200000000"), automation("a", "0000000100000000")];
    NodeAssert.deepEqual(
      orderAutomations(rows).map(({ id }) => id),
      ["a", "b"],
    );
    const unranked = [automation("b", undefined), automation("a", undefined)];
    NodeAssert.equal(orderAutomations(unranked), unranked);
    NodeAssert.deepEqual(moveAutomationId(["a", "b", "c"], "c", {}), ["c", "a", "b"]);
    NodeAssert.deepEqual(moveAutomationId(["a", "b", "c"], "a", { afterAutomationId: "b" }), [
      "b",
      "a",
      "c",
    ]);
    NodeAssert.deepEqual(moveAutomationId(["a", "b", "c"], "c", { beforeAutomationId: "b" }), [
      "a",
      "c",
      "b",
    ]);
  });

  test("lists automations in the person's order and reads again when tasks change", async () => {
    const h = harness([automation("b", "0000000200000000"), automation("a", "0000000100000000")]);
    NodeAssert.equal(h.store.getSnapshot().status, "loading");
    const release = h.store.retain();
    await until(() => h.store.getSnapshot().status === "ready");
    NodeAssert.deepEqual(h.ids(), ["a", "b"]);

    // A fire creates a task: the list changes, and the count with it.
    h.setRows([
      automation("b", "0000000200000000", { taskCount: 1 }),
      automation("a", "0000000100000000"),
    ]);
    h.emit({ listChanged: true });
    await until(() => h.store.getSnapshot().automations[1]?.taskCount === 1);
    // A change to a task's fields only is no reason to read.
    const reads = h.count("search");
    h.emit({ taskIds: ["task-1" as never] });
    await NodeTimersPromises.setTimeout(20);
    NodeAssert.equal(h.count("search"), reads);
    release();
  });

  test("a reorder shows at once; a failed one returns to the server's order", async () => {
    const h = harness([
      automation("a", "0000000100000000"),
      automation("b", "0000000200000000"),
      automation("c", "0000000300000000"),
    ]);
    const release = h.store.retain();
    await until(() => h.store.getSnapshot().status === "ready");
    const answer = deferred<TaskAutomationListItem>();
    h.handlers.reorder = () => answer.promise;
    const moved = h.store.reorder("c", { afterAutomationId: "a" });
    NodeAssert.deepEqual(h.ids(), ["a", "c", "b"]);
    NodeAssert.deepEqual(h.calls.at(-1), {
      method: "reorder",
      input: { id: "c", afterAutomationId: "a" },
    });
    answer.resolve(automation("c", "0000000180000000"));
    NodeAssert.equal(await moved, true);
    NodeAssert.deepEqual(h.ids(), ["a", "c", "b"]);

    h.handlers.reorder = async () => {
      throw new Error("conflict");
    };
    NodeAssert.equal(await h.store.reorder("b", {}), false);
    NodeAssert.deepEqual(h.ids(), ["a", "c", "b"]);
    NodeAssert.deepEqual(h.errors, ["Could not move the automation"]);
    release();
  });

  test("a read that started before a write does not undo it", async () => {
    const h = harness([automation("a", "0000000100000000")]);
    const release = h.store.retain();
    await until(() => h.store.getSnapshot().status === "ready");
    const slowRead = deferred<{ automations: TaskAutomationListItem[] }>();
    h.handlers.search = () => slowRead.promise;
    h.emit({ listChanged: true });
    await until(() => h.count("search") === 2);
    h.handlers.setStatus = async () => automation("a", "0000000100000000", { status: "enabled" });
    await h.store.setStatus("a", "enabled");
    NodeAssert.equal(h.store.getSnapshot().automations[0]?.status, "enabled");
    // The read from before the write answers with the old state, and is read again.
    h.handlers.search = async () => ({
      automations: [automation("a", "0000000100000000", { status: "enabled", taskCount: 2 })],
    });
    slowRead.resolve({ automations: [automation("a", "0000000100000000")] });
    await until(() => h.store.getSnapshot().automations[0]?.taskCount === 2);
    NodeAssert.equal(h.store.getSnapshot().automations[0]?.status, "enabled");
    release();
  });

  test("a created automation is listed first, and a deleted one goes", async () => {
    const h = harness([automation("a", "0000000100000000")]);
    const release = h.store.retain();
    await until(() => h.store.getSnapshot().status === "ready");
    const { taskCount: _none, ...answer } = automation("new", "0000000080000000");
    h.handlers.upsert = async () => answer;
    const created = await h.store.upsert({} as never);
    NodeAssert.equal(created?.id, "new");
    NodeAssert.deepEqual(h.ids(), ["new", "a"]);
    NodeAssert.equal(h.store.getSnapshot().automations[0]?.taskCount, 0, "a new one created none");
    h.handlers.delete = async () => undefined;
    NodeAssert.equal(await h.store.remove("a"), true);
    NodeAssert.deepEqual(h.ids(), ["new"]);
    release();
  });

  test("a remount within the release grace reads nothing again, and a read keeps unchanged rows", async () => {
    const h = harness([automation("a", "0000000100000000"), automation("b", "0000000200000000")]);
    const release = h.store.retain();
    await until(() => h.store.getSnapshot().status === "ready");
    const [a, b] = h.store.getSnapshot().automations;
    // A thread switch: the panel's views unmount and mount again in one commit.
    release();
    const again = h.store.retain();
    await NodeTimersPromises.setTimeout(30);
    NodeAssert.equal(h.count("search"), 1);
    NodeAssert.ok(h.live);

    h.setRows([
      automation("a", "0000000100000000"),
      automation("b", "0000000200000000", { taskCount: 3 }),
    ]);
    h.emit({ listChanged: true });
    await until(() => h.store.getSnapshot().automations[1]?.taskCount === 3);
    NodeAssert.equal(h.store.getSnapshot().automations[0], a);
    NodeAssert.notEqual(h.store.getSnapshot().automations[1], b);

    again();
    await until(() => !h.live);
  });
});
