import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { planVisibleTaskMove } from "./taskReorder.ts";
import { mergedGroupOrder, taskStatusGroups, tasksOfGroup } from "./taskStatusGroups.ts";

const task = (id: string, status: string) => ({ id, environmentId: "local", status });

test("groups follow the server counts: no group without tasks, Done and Cancelled closed", () => {
  const groups = (input: Partial<Parameters<typeof taskStatusGroups>[0]>) =>
    taskStatusGroups({
      tasks: [],
      counts: new Map(),
      statuses: [],
      statusFilter: null,
      order: [],
      open: {},
      ...input,
    }).groups.map(({ key, title, count, open, tasks }) => [key, title, count, open, tasks.length]);

  const counts = new Map([
    ["done", 312],
    ["to do", 3],
    ["waiting", 1],
  ]);
  // Done has none of its tasks loaded: it is closed, and its count comes from the server.
  NodeAssert.deepEqual(
    groups({
      tasks: [task("a", "To Do"), task("b", "To Do")],
      counts,
      statuses: ["Waiting", "To Do", "Done"],
    }),
    [
      ["to do", "To Do", 3, true, 2],
      ["done", "Done", 312, false, 0],
      ["waiting", "Waiting", 1, true, 0],
    ],
  );
  NodeAssert.deepEqual(groups({ counts, open: { done: true, "to do": false } }).slice(0, 2), [
    ["to do", "To Do", 3, false, 0],
    ["done", "Done", 312, true, 0],
  ]);
  NodeAssert.deepEqual(groups({ counts, statusFilter: "Done" }), [["done", "Done", 312, false, 0]]);
  // A task that just moved shows its group before the new counts arrive.
  NodeAssert.deepEqual(groups({ tasks: [task("a", "Backlog")] }), [
    ["backlog", "Backlog", 1, true, 1],
  ]);
  NodeAssert.deepEqual(groups({ counts: new Map() }), []);
});

test("a reorder of the shown groups keeps every hidden group's place in the stored order", () => {
  const { order, groups } = taskStatusGroups({
    tasks: [],
    counts: new Map([
      ["needs input", 1],
      ["to do", 1],
      ["done", 1],
    ]),
    statuses: [],
    statusFilter: null,
    order: ["done"],
    open: {},
  });
  const shown = groups.map(({ key }) => key);
  NodeAssert.deepEqual(shown, ["done", "needs input", "to do"]);
  NodeAssert.equal(order.length, 10, "the order holds every standard status, shown or not");

  // To Do dragged above Needs Input: it lands right before it, the hidden ones stay put.
  const next = mergedGroupOrder(order, ["done", "to do", "needs input"], "to do");
  NodeAssert.deepEqual(next.slice(0, 4), ["done", "to do", "needs input", "needs review"]);
  NodeAssert.deepEqual(
    next.filter((key) => !shown.includes(key)),
    order.filter((key) => !shown.includes(key)),
  );
  // Dragged to the end: right after the last shown group, before the hidden ones that followed it.
  const last = mergedGroupOrder(order, ["needs input", "to do", "done"], "done");
  NodeAssert.deepEqual(last.slice(last.indexOf("to do"), last.indexOf("to do") + 2), [
    "to do",
    "done",
  ]);
});

test("in a grouped list a task moves among its own group's tasks only", () => {
  const tasks = [task("a", "Backlog"), task("b", "To Do"), task("c", "to do"), task("d", "Done")];
  const group = tasksOfGroup(tasks, "To Do");
  NodeAssert.deepEqual(
    group.map(({ id }) => id),
    ["b", "c"],
  );
  // The first task of its group cannot move up into the group above.
  NodeAssert.deepEqual(
    planVisibleTaskMove({ tasks, visibleTasks: group, task: tasks[1]!, directionOrTarget: "up" }),
    { ok: false, reason: "out-of-range" },
  );
  const down = planVisibleTaskMove({
    tasks,
    visibleTasks: group,
    task: tasks[1]!,
    directionOrTarget: "down",
  });
  NodeAssert.ok(down.ok);
  NodeAssert.deepEqual(
    down.plan.request,
    { id: "b", afterTaskId: "c" },
    "neighbors from its group only",
  );
});
