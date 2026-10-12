import * as NodeAssert from "node:assert/strict";
import { createElement, act } from "react";
import { afterEach, test, vi } from "vite-plus/test";
import type { TaskChange, TaskPageInput, TaskPageResult } from "@t3tools/tasks-contracts/v1";

import { RecentMap } from "../state/recent.ts";
import {
  readableAgentsState,
  reuseAgentsState,
  type AgentsDataState,
  type ScopedTaskAgent,
  type ScopedTaskAgentRun,
} from "../state/agentsState.ts";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

const rows = (count: number, changed?: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    projectId: "project",
    rank: String(index).padStart(6, "0"),
    title: index === changed ? "Changed" : `Task ${index}`,
    status: "To Do",
    runCounts: [],
  })) as unknown as TaskPageResult["tasks"];

const settle = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/**
 * The Tasks table's data as the panel beside a thread sees it: a thread switch
 * unmounts and mounts the panel in one commit, while the sidebar keeps the
 * environment's change stream open.
 */
async function tableHarness() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  const { create } = await import("react-test-renderer");
  const { useTaskPages } = await import("./useTaskPages.ts");
  const { recentTaskPages } = await import("../state/taskPages.ts");
  const { createTaskChangeSubscription } = await import("../rpc/taskChanges.ts");

  const requests: TaskPageInput[] = [];
  let changed: number | undefined;
  const subscribe = createTaskChangeSubscription(
    (signal, listener) =>
      new Promise<void>((resolve) => {
        setTimeout(() => listener({ kind: "sync", sequence: 1 } as TaskChange), 5);
        signal.addEventListener("abort", () => resolve());
      }),
  );
  const sidebar = subscribe(() => undefined);
  const target = (canReadTasks: boolean) => ({
    environmentId: "local",
    client: {
      tasks: {
        subscribe,
        page: async (input: TaskPageInput): Promise<TaskPageResult> => {
          requests.push(input);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { tasks: rows(100, changed), statuses: ["To Do"], nextCursor: null };
        },
      },
    },
    access: { canReadTasks, reason: "No access" },
    projectNameById: new Map(),
  });
  const readable = [target(true)] as never;
  const unreadable = [target(false)] as never;
  const tags: string[] = [];
  let renders: Array<readonly { readonly id: string; readonly title: string }[]> = [];
  function Table(props: { readonly targets: never }) {
    renders.push(useTaskPages(props.targets, null, "all", tags, "active").tasks);
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  return {
    requests,
    recentTaskPages,
    get renders() {
      return renders;
    },
    change: (index: number) => {
      changed = index;
    },
    /** Mounts the table again, as a thread switch does. */
    open: async (key: string, targets: never = readable) => {
      renders = [];
      requests.length = 0;
      await act(async () => {
        renderer?.unmount();
        renderer = create(createElement(Table, { key, targets }));
      });
    },
    readable,
    unreadable,
    close: async () => {
      await act(async () => renderer?.unmount());
      sidebar();
    },
  };
}

test("a remounted table shows its last rows on the first render and refreshes them in the background", async () => {
  const h = await tableHarness();
  await h.open("first thread");
  await settle(80);
  NodeAssert.equal(h.renders[0]?.length, 0, "a first open has nothing kept yet");
  const shown = h.renders.at(-1)!;
  NodeAssert.equal(shown.length, 100);

  await h.open("second thread");
  const first = h.renders[0]!;
  NodeAssert.equal(first.length, 100);
  NodeAssert.ok(
    first.every((task, index) => task === shown[index]),
    "the same row objects on the first render",
  );
  await settle(250);
  NodeAssert.equal(h.requests.length, 1, "one background read");
  NodeAssert.ok(
    h.renders.every((tasks) => tasks === first),
    "an unchanged background read repaints nothing",
  );
  await h.close();
});

test("a background read replaces only the rows that changed", async () => {
  const h = await tableHarness();
  await h.open("first thread");
  await settle(80);
  const shown = h.renders.at(-1)!;
  h.change(5);
  await h.open("second thread");
  await settle(250);
  const next = h.renders.at(-1)!;
  NodeAssert.equal(next[5]?.title, "Changed");
  NodeAssert.notEqual(next[5], shown[5]);
  NodeAssert.ok(next.every((task, index) => index === 5 || task === shown[index]));
  await h.close();
});

test("an environment that lost task access shows no kept rows, and they are forgotten", async () => {
  const h = await tableHarness();
  await h.open("first thread");
  await settle(80);
  NodeAssert.equal(h.recentTaskPages.size, 1);
  await h.open("second thread", h.unreadable);
  await settle(50);
  NodeAssert.ok(h.renders.every((tasks) => tasks.length === 0));
  NodeAssert.equal(h.requests.length, 0);
  NodeAssert.equal(h.recentTaskPages.size, 0);
  await h.close();
});

test("kept data holds only the most recently used keys", () => {
  const recent = new RecentMap<string, number>(2);
  recent.set("a", 1);
  recent.set("b", 2);
  NodeAssert.equal(recent.get("a"), 1);
  recent.set("c", 3);
  NodeAssert.equal(recent.size, 2);
  NodeAssert.equal(recent.get("b"), undefined, "the least recently used key goes first");
  NodeAssert.equal(recent.get("a"), 1);
  NodeAssert.equal(recent.get("c"), 3);
});

test("agents and runs keep unchanged objects, and kept data shows only readable environments", () => {
  const agent = (environmentId: string, id: string, name = id) =>
    ({ environmentId, id, name, updatedAt: "2026-10-12" }) as unknown as ScopedTaskAgent;
  const run = (environmentId: string, id: string) =>
    ({ environmentId, id, startedAt: "2026-10-12" }) as unknown as ScopedTaskAgentRun;
  const state = (agents: ScopedTaskAgent[], runs: ScopedTaskAgentRun[]): AgentsDataState => ({
    byEnvironment: {
      local: { status: "ready", agents: [], runs: [] },
      remote: { status: "ready", agents: [], runs: [] },
    },
    agents,
    runs,
  });
  const previous = state(
    [agent("local", "a"), agent("remote", "a")],
    [run("local", "r"), run("remote", "r")],
  );
  NodeAssert.equal(
    reuseAgentsState(
      previous,
      state([agent("local", "a"), agent("remote", "a")], [run("local", "r"), run("remote", "r")]),
    ),
    previous,
  );
  const renamed = reuseAgentsState(
    previous,
    state(
      [agent("local", "a"), agent("remote", "a", "Renamed")],
      [run("local", "r"), run("remote", "r")],
    ),
  );
  NodeAssert.equal(renamed.agents[0], previous.agents[0]);
  NodeAssert.notEqual(renamed.agents[1], previous.agents[1]);
  NodeAssert.equal(renamed.runs, previous.runs);

  NodeAssert.equal(
    readableAgentsState(previous, () => true),
    previous,
  );
  const local = readableAgentsState(previous, (environmentId) => environmentId === "local");
  NodeAssert.deepEqual(Object.keys(local.byEnvironment), ["local"]);
  NodeAssert.deepEqual(
    [...local.agents, ...local.runs].map((row) => row.environmentId),
    ["local", "local"],
  );
});
