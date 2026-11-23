import * as NodeAssert from "node:assert/strict";
import { taskStatusesFor } from "@t3tools/tasks-contracts/v1";
import { test } from "vite-plus/test";

import { planVisibleTaskMove } from "./taskReorder.ts";
import {
  defaultStatusGroupOrder,
  keptStatusGroups,
  mergedGroupOrder,
  taskStatusGroups,
  tasksOfGroup,
} from "./taskStatusGroups.ts";

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
      workflowVersion: 2,
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

test("each workflow orders its own standard statuses; another workflow's status is a custom group", () => {
  NodeAssert.deepEqual([...defaultStatusGroupOrder(2)].sort(), [...taskStatusesFor(2)].sort());
  NodeAssert.deepEqual([...defaultStatusGroupOrder(1)].sort(), [...taskStatusesFor(1)].sort());
  const shown = (order: readonly string[], workflowVersion: 1 | 2 = 2) =>
    taskStatusGroups({
      tasks: [],
      counts: new Map([
        ["needs input", 2],
        ["to do", 1],
        ["done", 1],
      ]),
      statuses: ["Needs Input", "To Do", "Done"],
      statusFilter: null,
      order,
      open: {},
      workflowVersion,
    }).groups.map(({ key, title }) => [key, title]);
  NodeAssert.deepEqual(shown([]), [
    ["to do", "To Do"],
    ["done", "Done"],
    ["needs input", "Needs Input"],
  ]);
  NodeAssert.deepEqual(shown(["needs input"])[0], ["needs input", "Needs Input"]);
  NodeAssert.deepEqual(shown([], 1), [
    ["needs input", "Needs Input"],
    ["to do", "To Do"],
    ["done", "Done"],
  ]);
});

test("a reorder of the shown groups keeps every hidden group's place in the stored order", () => {
  const { order, groups } = taskStatusGroups({
    tasks: [],
    counts: new Map([
      ["needs you", 1],
      ["to do", 1],
      ["done", 1],
    ]),
    statuses: [],
    statusFilter: null,
    order: ["done"],
    open: {},
    workflowVersion: 2,
  });
  const shown = groups.map(({ key }) => key);
  NodeAssert.deepEqual(shown, ["done", "needs you", "to do"]);
  NodeAssert.equal(order.length, 11, "the order holds every standard status, shown or not");

  // To Do dragged above Needs You: it lands right before it, the hidden ones stay put.
  const next = mergedGroupOrder(order, ["done", "to do", "needs you"], "to do");
  NodeAssert.deepEqual(next.slice(0, 4), ["done", "to do", "needs you", "failed"]);
  NodeAssert.deepEqual(
    next.filter((key) => !shown.includes(key)),
    order.filter((key) => !shown.includes(key)),
  );
  // Dragged to the end: right after the last shown group, before the hidden ones that followed it.
  const last = mergedGroupOrder(order, ["needs you", "to do", "done"], "done");
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

test("a group closed after it was open stays loaded; one never opened does not", () => {
  const none: ReadonlySet<string> = new Set();
  // Backlog is open by default and Done closed: closing Backlog keeps it, Done was never open.
  const closedBacklog = keptStatusGroups(none, {}, { backlog: false, done: false });
  NodeAssert.deepEqual([...closedBacklog], ["backlog"]);
  const opened = keptStatusGroups(closedBacklog, { backlog: false }, { done: true });
  NodeAssert.equal(opened, closedBacklog, "opening a group changes nothing kept");
  NodeAssert.deepEqual(
    [...keptStatusGroups(opened, { done: true }, { done: false })],
    ["backlog", "done"],
  );
});
