import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as NodeTimersPromises from "node:timers/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskChange, TaskRunCount } from "@upcomputer/tasks-contracts/v1";
import type { TasksWebRpcClient } from "../rpc/tasksRpcClient.ts";
import { EnvironmentRunCountsStore } from "../state/environmentRunCounts.ts";
import { WorkingRunCount } from "./TaskNavigationRunCounts.tsx";

async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await NodeTimersPromises.setTimeout(5);
  }
  NodeAssert.fail("Did not settle");
}

function harness() {
  let listener!: (event: TaskChange) => void;
  let opens = 0;
  let closes = 0;
  let requests = 0;
  let counts: TaskRunCount[] = [{ status: "completed", count: 1 }];
  let fail = false;
  const client = {
    tasks: {
      subscribe: (callback: typeof listener) => {
        opens++;
        listener = callback;
        return () => {
          closes++;
        };
      },
      runCounts: async () => {
        requests++;
        if (fail) throw new Error("offline");
        return { runCounts: counts };
      },
    },
  } as unknown as TasksWebRpcClient;
  const change = (runsChanged: boolean, kind: TaskChange["kind"] = "changed") =>
    listener({
      kind,
      sequence: 1,
      taskIds: [],
      rootThreadIds: [],
      listChanged: false,
      runsChanged,
    });
  return {
    store: new EnvironmentRunCountsStore(client, 2),
    change,
    setCounts: (next: TaskRunCount[]) => {
      counts = next;
    },
    setFail: (next: boolean) => {
      fail = next;
    },
    get opens() {
      return opens;
    },
    get closes() {
      return closes;
    },
    get requests() {
      return requests;
    },
  };
}

test("environment run counts load once per subscription and reload only on run changes", async () => {
  const h = harness();
  let notified = 0;
  const first = h.store.subscribe(() => notified++);
  const second = h.store.subscribe(() => notified++);
  NodeAssert.equal(h.opens, 1, "listeners share one task stream");
  await until(() => h.store.get().length === 1);
  NodeAssert.equal(h.requests, 1);

  h.change(false);
  await NodeTimersPromises.setTimeout(20);
  NodeAssert.equal(h.requests, 1, "task edits without run changes do not reload");

  h.setCounts([
    { status: "completed", count: 1 },
    { status: "failed", count: 1 },
  ]);
  h.change(true);
  await until(() => h.store.get().length === 2);
  NodeAssert.equal(notified, 4, "both listeners hear the initial load and the change");

  first();
  second();
  NodeAssert.equal(h.closes, 1);
  NodeAssert.deepEqual(h.store.get(), [], "an unobserved store keeps no stale counts");
});

test("environment run counts retry after a failed request", async () => {
  const h = harness();
  h.setFail(true);
  const stop = h.store.subscribe(() => {});
  await until(() => h.requests === 1);
  h.setFail(false);
  await until(() => h.store.get().length === 1);
  stop();
});

test("the Tasks entry shows only working runs, as one number", () => {
  const render = (counts: TaskRunCount[]) =>
    renderToStaticMarkup(createElement(WorkingRunCount, { counts }));
  NodeAssert.equal(
    render([
      { status: "completed", count: 1126 },
      { status: "failed", count: 74 },
      { status: "blocked", count: 2 },
    ]),
    "",
    "history alone shows no badge and no zero",
  );
  NodeAssert.equal(render([]), "");
  const html = render([
    { status: "completed", count: 1126 },
    { status: "running", count: 2 },
    { status: "interrupted", count: 3 },
    { status: "running", count: 1 },
  ]);
  NodeAssert.match(html, /^<span [^>]*>3<\/span>$/, "environments sum into one number");
  NodeAssert.match(html, /aria-label="Running task agents · 3"/);
  NodeAssert.match(html, /text-sky-600/, "the Working color");
});
