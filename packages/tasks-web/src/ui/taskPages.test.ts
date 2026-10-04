import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { TaskPageResult } from "@t3tools/tasks-contracts/v1";
import type { TasksStateTarget } from "../state/tasksState.ts";
import { mergeTaskPage, TaskPageRequests, sameTaskTargets } from "../state/taskPages.ts";

const target = { environmentId: "local" } as TasksStateTarget;
const result = (ids: string[]) =>
  ({
    tasks: ids.map((id) => ({
      id,
      projectId: "project",
      runCounts: [{ status: "running", count: 1 }],
    })),
    nextCursor: null,
    statuses: ["Backlog", "in progress"],
  }) as unknown as TaskPageResult;

test("pages merge by identity, preserve full facets, and dedupe rows that move across the page boundary", () => {
  const first = mergeTaskPage(target, result(["a", "b"]));
  const second = mergeTaskPage(target, result(["b", "c"]), first);
  NodeAssert.deepEqual(
    second.tasks.map(({ id }) => id),
    ["a", "b", "c"],
  );
  NodeAssert.equal(second.pages, 2);
  NodeAssert.ok(second.statuses.includes("in progress"));
});

test("late responses cannot overwrite a new filter query or an unmounted view", async () => {
  const requests = new TaskPageRequests();
  const old = requests.begin();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let committed = false;
  const late = pending.then(() => {
    if (old()) committed = true;
  });
  const fresh = requests.begin();
  finish();
  await late;
  NodeAssert.equal(committed, false);
  NodeAssert.equal(fresh(), true);
  requests.invalidate();
  NodeAssert.equal(fresh(), false);
});

test("environment pages have independent cursors and identities", () => {
  const local = mergeTaskPage(target, result(["same"]));
  const remote = mergeTaskPage(
    { ...target, environmentId: "remote" } as TasksStateTarget,
    result(["same"]),
  );
  NodeAssert.notEqual(local.tasks[0]?.environmentId, remote.tasks[0]?.environmentId);
});

test("unrelated environment config snapshots preserve the task query identity", () => {
  const client = {} as TasksStateTarget["client"];
  const first = {
    environmentId: "local",
    client,
    access: { canReadTasks: true, reason: "Enabled" },
    projectNameById: new Map([["project", "Project"]]),
  } as unknown as TasksStateTarget;
  const next = {
    ...first,
    access: { ...first.access },
    projectNameById: new Map(first.projectNameById),
  };
  NodeAssert.equal(sameTaskTargets([first], [next]), true);
  NodeAssert.equal(
    sameTaskTargets([first], [{ ...next, access: { ...next.access, canReadTasks: false } }]),
    false,
  );
  NodeAssert.equal(sameTaskTargets([first], [{ ...next, projectNameById: new Map() }]), false);
});
