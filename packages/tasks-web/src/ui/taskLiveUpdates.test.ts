import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as NodeTimersPromises from "node:timers/promises";
import type {
  TaskChange,
  TaskPageInput,
  TaskPageResult,
  TaskId,
} from "@t3tools/tasks-contracts/v1";
import { TaskPageLoader, type TaskPageLoadState } from "../state/taskPageLoader.ts";
import type { TasksStateTarget } from "../state/tasksState.ts";
import { createTaskChangeSubscription, type TaskChangeListener } from "../rpc/taskChanges.ts";

const changed = (ids: string[], listChanged = false): TaskChange => ({
  kind: "changed",
  sequence: 1,
  taskIds: ids as TaskId[],
  listChanged,
  runsChanged: false,
  rootThreadIds: [],
});
const sync: TaskChange = { ...changed([]), kind: "sync" };
const row = (id: string, title = id) =>
  ({
    id,
    projectId: "project",
    rank: id,
    title,
    runCounts: [],
  }) as unknown as TaskPageResult["tasks"][number];
const page = (ids = ["a", "b"], more = true): TaskPageResult => ({
  tasks: ids.map((id) => row(id)),
  statuses: ["Backlog"],
  nextCursor: more ? { rank: "0000000000000001" as never, id: ids.at(-1)! as TaskId } : null,
});
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await NodeTimersPromises.setTimeout(2);
  }
  throw new Error("Condition did not settle");
}
function harness() {
  const requests: TaskPageInput[] = [];
  const itemRequests: TaskId[][] = [];
  const states: TaskPageLoadState[] = [];
  let pageResponse = async (_query: TaskPageInput): Promise<TaskPageResult> => page();
  let itemResponse = async (ids: readonly TaskId[]) => ({
    tasks: ids.map((id) => row(id, "updated")),
  });
  const target = {
    environmentId: "local",
    access: { canReadTasks: true },
    client: {
      tasks: {
        page: (query: TaskPageInput) => {
          requests.push(query);
          return pageResponse(query);
        },
        items: ({ ids }: { ids: readonly TaskId[] }) => {
          itemRequests.push([...ids]);
          return itemResponse(ids);
        },
      },
    },
  } as unknown as TasksStateTarget;
  const loader = new TaskPageLoader(target, { limit: 2 }, (state) => states.push(state), 2);
  return {
    loader,
    target,
    requests,
    itemRequests,
    states,
    latest: () => states.at(-1)!,
    pages: (response: typeof pageResponse) => {
      pageResponse = response;
    },
    rows: (response: typeof itemResponse) => {
      itemResponse = response;
    },
  };
}

test("idle lists make no requests; row/run changes batch only loaded IDs and preserve other rows", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  const first = h.latest().page!;
  await NodeTimersPromises.setTimeout(30);
  NodeAssert.equal(h.requests.length, 1);
  h.loader.change(changed(["a", "not-loaded"]));
  h.loader.change(changed(["a"]));
  await until(() => h.itemRequests.length === 1 && h.latest().page!.tasks[0]!.title === "updated");
  NodeAssert.deepEqual(h.itemRequests, [["a"]]);
  NodeAssert.equal(h.requests.length, 1);
  NodeAssert.equal(h.latest().page!.tasks[1], first.tasks[1]);
  NodeAssert.equal(h.latest().loadingMore, false);
  NodeAssert.equal(h.latest().initialLoading, false);
  const current = h.latest().page;
  h.loader.change(changed(["a"]));
  await NodeTimersPromises.setTimeout(15);
  NodeAssert.equal(
    h.latest().page,
    current,
    "identical row snapshots retain the whole page reference",
  );
});

test("Load more during background refresh is queued, not lost; rows stay visible and loadingMore belongs to the click", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  const original = h.latest().page;
  let release!: (value: TaskPageResult) => void;
  h.pages(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  h.loader.change(changed(["a"], true));
  await until(() => h.requests.length === 2);
  NodeAssert.equal(h.latest().page, original);
  NodeAssert.equal(h.latest().loadingMore, false);
  h.loader.loadMore();
  NodeAssert.equal(h.latest().loadingMore, true);
  h.pages(async () => page(["c", "d"], false));
  release(page());
  await until(() => h.latest().page!.tasks.length === 4 && !h.latest().loadingMore);
  NodeAssert.equal(h.requests.length, 3);
  NodeAssert.ok(h.requests[2]?.cursor);
  NodeAssert.deepEqual(
    h.latest().page!.tasks.map(({ id }) => id),
    ["a", "b", "c", "d"],
  );
});

test("Load more after concurrent list changes appends with the cursor without duplicates", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  // "b" was reordered across the page boundary before the next page was read.
  h.pages(async () => page(["b", "c"], false));
  h.loader.loadMore();
  await until(() => h.latest().page!.pages === 2 && !h.latest().loadingMore);
  NodeAssert.equal(h.requests.length, 2);
  NodeAssert.equal(h.requests[1]?.cursor?.id, "b");
  NodeAssert.deepEqual(
    h.latest().page!.tasks.map(({ id }) => id),
    ["a", "b", "c"],
  );
  NodeAssert.equal(h.latest().error, undefined);
});

test("snapshot refresh retains the loaded prefix; failed background requests retain usable rows/cursor", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  h.pages(async (query) => (query.cursor ? page(["c"], false) : page()));
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  h.loader.loadMore();
  await until(() => h.latest().page!.tasks.length === 3);
  const previous = h.latest().page;
  h.loader.change(sync);
  await until(() => h.requests.length === 4);
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(h.latest().page, previous);
  h.pages(async () => {
    throw new Error("Offline");
  });
  h.loader.refresh();
  await until(() => !!h.latest().error);
  NodeAssert.equal(h.latest().page, previous);
  NodeAssert.equal(h.latest().loadingMore, false);
  h.pages(async () => page());
  h.loader.refresh();
  await until(() => !h.latest().error);
});

test("stale responses after filter change/unmount cannot publish", async () => {
  const h = harness();
  let release!: (value: TaskPageResult) => void;
  h.pages(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  h.loader.change(sync);
  await until(() => h.requests.length === 1);
  h.loader.dispose();
  release(page());
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(h.states.length, 0);
});

test("events arriving during a request are reconciled afterwards", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  let release!: (value: TaskPageResult) => void;
  h.pages(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  h.loader.change(sync);
  await until(() => h.requests.length === 1);
  h.loader.change(changed(["a"]));
  release(page());
  await until(() => h.latest()?.page?.tasks[0]?.title === "updated");
  NodeAssert.equal(h.requests.length, 1);
  NodeAssert.deepEqual(h.itemRequests, [["a"]]);
});

test("a reconnect uses one shared stream, detects gaps, retries failures, and releases it on last unsubscribe", async () => {
  const opens: {
    signal: AbortSignal;
    listener: TaskChangeListener;
    fail: (error: unknown) => void;
  }[] = [];
  const subscribe = createTaskChangeSubscription(
    (signal, listener) =>
      new Promise<void>((_resolve, reject) => {
        opens.push({ signal, listener, fail: reject });
      }),
    1,
  );
  const one: TaskChange[] = [],
    two: TaskChange[] = [];
  const offOne = subscribe((event) => one.push(event));
  opens[0]!.listener(sync);
  const offTwo = subscribe((event) => two.push(event));
  await NodeTimersPromises.setTimeout(0);
  NodeAssert.equal(opens.length, 1);
  NodeAssert.equal(two[0]?.kind, "sync");
  opens[0]!.listener({ ...changed(["a"]), sequence: 2 });
  opens[0]!.listener({ ...changed(["a"]), sequence: 5 });
  NodeAssert.equal(one.at(-1)?.kind, "sync", "a bounded stream gap forces reconciliation");
  opens[0]!.fail(new Error("Disconnected"));
  await until(() => opens.length === 2);
  opens[1]!.listener({ ...sync, sequence: 0 });
  NodeAssert.equal(one.at(-1)?.sequence, 0, "server restart resets the stream sequence via sync");
  offOne();
  NodeAssert.equal(opens[1]!.signal.aborted, false);
  offTwo();
  NodeAssert.equal(opens[1]!.signal.aborted, true);
  opens[1]!.fail(new Error("Cancelled"));
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(opens.length, 2);
});

test("a row event queued with Load more is not consumed by the append request", async (context) => {
  const h = harness();
  context.onTestFinished(() => h.loader.dispose());
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  h.pages(async () => page(["c"], false));
  h.loader.change(changed(["a"]));
  h.loader.loadMore();
  await until(
    () => h.latest()?.page?.tasks.length === 3 && h.latest().page!.tasks[0]!.title === "updated",
  );
  NodeAssert.equal(h.requests.length, 2);
  NodeAssert.deepEqual(h.itemRequests, [["a"]]);
});

test("an environment reconnect reuses a cached multi-page query without resetting its prefix", async (context) => {
  const h = harness();
  h.pages(async (query) => (query.cursor ? page(["c"], false) : page()));
  h.loader.change(sync);
  await until(() => !!h.latest()?.page);
  h.loader.loadMore();
  await until(() => h.latest().page!.pages === 2);
  const cached = h.latest().page!;
  h.loader.dispose();
  const states: TaskPageLoadState[] = [];
  const reconnected = new TaskPageLoader(
    h.target,
    { limit: 2 },
    (state) => states.push(state),
    2,
    cached,
  );
  context.onTestFinished(() => reconnected.dispose());
  reconnected.change(sync);
  await until(() => h.requests.length === 4);
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(
    states.length,
    0,
    "identical reconciliation neither clears rows nor emits a loading state",
  );
  // The caller retains its cache when no new state needs publishing.
  reconnected.loadMore();
  await NodeTimersPromises.setTimeout(10);
  NodeAssert.equal(h.requests.length, 4, "there is no next page after the preserved prefix");
  NodeAssert.equal(states.at(-1)?.page, cached);
});
