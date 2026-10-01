import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { persistPlannedTaskMove, planVisibleTaskMove, type TaskOrderItem } from "./taskReorder.ts";

interface Item extends TaskOrderItem {
  readonly title: string;
}

const a = { id: "a", environmentId: "local", title: "A" } satisfies Item;
const b = { id: "b", environmentId: "local", title: "B" } satisfies Item;
const c = { id: "c", environmentId: "local", title: "C" } satisfies Item;
const d = { id: "d", environmentId: "local", title: "D" } satisfies Item;
const tasks = [a, b, c, d] as const;

function plan(task: Item, target: "up" | "down" | Item, visibleTasks: readonly Item[] = tasks) {
  const result = planVisibleTaskMove({ tasks, visibleTasks, task, directionOrTarget: target });
  if (!result.ok) throw new Error(`Unexpected move failure: ${result.reason}`);
  return result.plan;
}

function ids(items: readonly Item[]) {
  return items.map(({ id }) => id);
}

test("pointer moves plan semantic neighbors at the beginning, middle, and end", () => {
  const beginning = plan(c, a);
  NodeAssert.deepEqual(ids(beginning.tasks), ["c", "a", "b", "d"]);
  NodeAssert.deepEqual(beginning.request, { id: "c", beforeTaskId: "a" });

  const middle = plan(a, c);
  NodeAssert.deepEqual(ids(middle.tasks), ["b", "c", "a", "d"]);
  NodeAssert.deepEqual(middle.request, { id: "a", afterTaskId: "c", beforeTaskId: "d" });

  const end = plan(a, d);
  NodeAssert.deepEqual(ids(end.tasks), ["b", "c", "d", "a"]);
  NodeAssert.deepEqual(end.request, { id: "a", afterTaskId: "d" });
});

test("keyboard moves use the same semantic-neighbor behavior and stop at boundaries", () => {
  const upward = plan(c, "up");
  NodeAssert.deepEqual(ids(upward.tasks), ["a", "c", "b", "d"]);
  NodeAssert.deepEqual(upward.request, { id: "c", afterTaskId: "a", beforeTaskId: "b" });

  const downward = plan(b, "down");
  NodeAssert.deepEqual(ids(downward.tasks), ["a", "c", "b", "d"]);
  NodeAssert.deepEqual(downward.request, { id: "b", afterTaskId: "c", beforeTaskId: "d" });

  NodeAssert.deepEqual(
    planVisibleTaskMove({ tasks, visibleTasks: tasks, task: a, directionOrTarget: "up" }),
    { ok: false, reason: "out-of-range" },
  );
});

test("filtered moves retain hidden task identities and use only visible semantic neighbors", () => {
  const hidden = { id: "hidden", environmentId: "local", title: "Hidden" } satisfies Item;
  const all = [a, hidden, b, c];
  const result = planVisibleTaskMove({
    tasks: all,
    visibleTasks: [a, b, c],
    task: c,
    directionOrTarget: b,
  });
  if (!result.ok) throw new Error(`Unexpected move failure: ${result.reason}`);

  NodeAssert.deepEqual(ids(result.plan.tasks), ["a", "hidden", "c", "b"]);
  NodeAssert.equal(result.plan.tasks[1], hidden, "hidden rows retain identity and rank position");
  NodeAssert.deepEqual(result.plan.request, { id: "c", afterTaskId: "a", beforeTaskId: "b" });
});

test("cross-environment pointer drops are rejected before optimistic mutation", () => {
  const remote = { id: "remote", environmentId: "remote", title: "Remote" } satisfies Item;
  NodeAssert.deepEqual(
    planVisibleTaskMove({
      tasks: [...tasks, remote],
      visibleTasks: [...tasks, remote],
      task: a,
      directionOrTarget: remote,
    }),
    { ok: false, reason: "cross-environment" },
  );
});

test("persistence applies immediately, reloads on success, and rolls back on error", async () => {
  const move = plan(c, a);
  const successfulStates: Array<readonly Item[]> = [];
  const requests: unknown[] = [];
  let reloads = 0;
  await persistPlannedTaskMove({
    previousTasks: tasks,
    plan: move,
    setTasks: (next) => successfulStates.push(next),
    reorder: async (request) => {
      requests.push(request);
    },
    onReload: () => {
      reloads += 1;
    },
  });
  NodeAssert.deepEqual(successfulStates.map(ids), [["c", "a", "b", "d"]]);
  NodeAssert.deepEqual(requests, [{ id: "c", beforeTaskId: "a" }]);
  NodeAssert.equal(reloads, 1);

  const failedStates: Array<readonly Item[]> = [];
  await NodeAssert.rejects(
    persistPlannedTaskMove({
      previousTasks: tasks,
      plan: move,
      setTasks: (next) => failedStates.push(next),
      reorder: async () => {
        throw new Error("conflict");
      },
      onReload: () => {
        throw new Error("must not reload");
      },
    }),
    /conflict/,
  );
  NodeAssert.deepEqual(failedStates.map(ids), [
    ["c", "a", "b", "d"],
    ["a", "b", "c", "d"],
  ]);
  NodeAssert.equal(
    failedStates[1]?.[2],
    c,
    "rollback preserves row identity for selection and focus",
  );
});
