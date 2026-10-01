import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as NodeTimersPromises from "node:timers/promises";
import { ThreadId } from "@upcomputer/contracts";
import type { TaskChange, TaskThreadRunCountsResult } from "@upcomputer/tasks-contracts/v1";
import type { TasksWebRpcClient } from "../rpc/tasksRpcClient.ts";
import { ThreadRunCountsStore } from "../state/threadRunCounts.ts";

const thread = (id: string) => ThreadId.make(id);
const result = (ids: readonly ThreadId[], count = 1): TaskThreadRunCountsResult => ({
  threads: ids.map((threadId) => ({ threadId, runCounts: [{ status: "completed", count }] })),
});
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await NodeTimersPromises.setTimeout(5);
  }
  NodeAssert.fail("Did not settle");
}
function harness() {
  const queries: readonly ThreadId[][] = [];
  const calls = queries as ThreadId[][];
  let listener!: (event: TaskChange) => void;
  let opens = 0;
  let closes = 0;
  let response = async (ids: readonly ThreadId[]) => result(ids);
  const client = {
    tasks: {
      subscribe: (callback: typeof listener) => {
        opens++;
        listener = callback;
        return () => {
          closes++;
        };
      },
      threadRunCounts: ({ threadIds }: { threadIds: readonly ThreadId[] }) => {
        calls.push([...threadIds]);
        return response(threadIds);
      },
    },
  } as unknown as TasksWebRpcClient;
  const store = new ThreadRunCountsStore(client, 2);
  return {
    store,
    queries,
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
    reply: (next: typeof response) => {
      response = next;
    },
    change: (ids: string[], runsChanged = true, sync = false) =>
      listener({
        kind: sync ? "sync" : "changed",
        sequence: 1,
        taskIds: [],
        rootThreadIds: ids.map(thread),
        runsChanged,
        listChanged: false,
      }),
  };
}

test("sidebar shares a stream and batches mounted roots, with no idle or cosmetic refresh requests", async () => {
  const h = harness();
  let notified = 0;
  const stops = Array.from({ length: 200 }, (_, i) =>
    h.store.subscribe(thread(String(i)), () => notified++),
  );
  await until(() => notified === 200);
  NodeAssert.equal(h.opens, 1);
  NodeAssert.equal(h.queries.length, 1);
  NodeAssert.equal(h.queries[0]?.length, 200);
  const stable = h.store.get(thread("0"));
  h.change(["0"], false);
  h.change(["not-mounted"]);
  await NodeTimersPromises.setTimeout(25);
  NodeAssert.equal(h.queries.length, 1);
  h.change(["0"]);
  h.change(["0"]);
  h.change(["1"]);
  await until(() => h.queries.length === 2);
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.deepEqual(h.queries[1], ["0", "1"]);
  NodeAssert.equal(h.store.get(thread("0")), stable);
  NodeAssert.equal(notified, 200);
  for (const stop of stops) stop();
  NodeAssert.equal(h.closes, 1);
});

test("sidebar batches more than 500 roots and refreshes all mounted roots on reconnect", async () => {
  const h = harness();
  const stops = Array.from({ length: 1001 }, (_, i) =>
    h.store.subscribe(thread(String(i)), () => {}),
  );
  await until(() => h.store.get(thread("1000")).length > 0);
  NodeAssert.deepEqual(
    h.queries.map((q) => q.length),
    [500, 500, 1],
  );
  h.reply(async (ids) => result(ids, 2));
  h.change([], true, true);
  await until(() => h.store.get(thread("1000"))[0]?.count === 2);
  NodeAssert.equal(h.opens, 1);
  NodeAssert.deepEqual(
    h.queries.map((q) => q.length),
    [500, 500, 1, 500, 500, 1],
  );
  for (const stop of stops) stop();
});

test("events during an aggregate request are reconciled, and deleted tasks clear the old root counts", async () => {
  const h = harness();
  let finish!: (value: TaskThreadRunCountsResult) => void;
  h.reply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stop = h.store.subscribe(thread("a"), () => {});
  await until(() => h.queries.length === 1);
  h.change(["a"]);
  h.reply(async (ids) => result(ids, 2));
  finish(result([thread("a")]));
  await until(() => h.store.get(thread("a"))[0]?.count === 2);
  NodeAssert.equal(h.queries.length, 2);
  h.reply(async () => ({ threads: [{ threadId: thread("a"), runCounts: [] }] }));
  h.change(["a"]);
  await until(() => h.store.get(thread("a")).length === 0);
  stop();
});

test("unmount/recreate discards late snapshots and request failures retain the last counts", async () => {
  const h = harness();
  let finish!: (value: TaskThreadRunCountsResult) => void;
  h.reply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stop = h.store.subscribe(thread("a"), () => {});
  await until(() => h.queries.length === 1);
  stop();
  h.reply(async (ids) => result(ids, 2));
  const stop2 = h.store.subscribe(thread("a"), () => {});
  await until(() => h.store.get(thread("a"))[0]?.count === 2);
  stop(); // A repeated stale cleanup must not unsubscribe the remounted row.
  finish(result([thread("a")], 9));
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(h.store.get(thread("a"))[0]?.count, 2);
  h.reply(async () => {
    throw Error("offline");
  });
  h.change(["a"]);
  await until(() => h.queries.length === 3);
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(h.store.get(thread("a"))[0]?.count, 2);
  stop2();
  await NodeTimersPromises.setTimeout(15);
  NodeAssert.equal(h.queries.length, 3);
  NodeAssert.equal(h.opens, 2);
  NodeAssert.equal(h.closes, 2);
});
