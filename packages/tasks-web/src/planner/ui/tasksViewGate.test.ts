import * as NodeAssert from "node:assert/strict";
import type { EnvironmentId } from "@t3tools/contracts";
import { test } from "vite-plus/test";

import type { TasksWebAvailability } from "../../rpc/capabilityGate.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import { resolveTasksViewGate, tasksAccessPending } from "./tasksViewGate.ts";

const LOCAL = "local" as EnvironmentId;

const target = (availability: TasksWebAvailability, canReadTasks: boolean) =>
  ({
    environmentId: LOCAL,
    access: { availability, canReadTasks },
  }) as unknown as TasksStateTarget;

test("Tasks waits for its access probe before saying no environment serves it", () => {
  // Opened right after launch, the planner said "No connected environment
  // serves Tasks." while the probe ran, then showed the real page.
  NodeAssert.equal(tasksAccessPending([target("loading", false)]), true);
  NodeAssert.equal(tasksAccessPending([target("unavailable", false)]), false);
  NodeAssert.equal(tasksAccessPending([target("enabled", true), target("loading", false)]), true);
  NodeAssert.equal(tasksAccessPending([]), false);
});

test("a disconnected Tasks environment stops loading after the initial wait", () => {
  // Astra review G: a saved environment that is offline keeps its probe
  // loading as it retries every two seconds, so the planner loaded forever.
  const gate = (
    environmentId: EnvironmentId | null,
    availability: TasksWebAvailability | null,
    initialWaitOver: boolean,
  ) =>
    resolveTasksViewGate({
      environmentId,
      availability,
      accessPending: tasksAccessPending([target("loading", false)]),
      initialWaitOver,
    });
  for (let retry = 0; retry < 4; retry += 1) {
    NodeAssert.equal(gate(null, null, false), "loading");
  }
  NodeAssert.equal(gate(null, null, true), "offline");
  // The chosen environment's planner probe retrying the same way.
  NodeAssert.equal(gate(LOCAL, "loading", false), "loading");
  NodeAssert.equal(gate(LOCAL, "loading", true), "offline");
  NodeAssert.equal(gate(LOCAL, "enabled", true), "answered");
  NodeAssert.equal(gate(LOCAL, "unavailable", false), "answered");
});

test("no environment serving Tasks is said at once", () => {
  NodeAssert.equal(
    resolveTasksViewGate({
      environmentId: null,
      availability: null,
      accessPending: false,
      initialWaitOver: false,
    }),
    "none",
  );
});
