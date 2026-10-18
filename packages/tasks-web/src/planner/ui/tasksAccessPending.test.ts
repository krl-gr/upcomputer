import * as NodeAssert from "node:assert/strict";
import type { EnvironmentId } from "@t3tools/contracts";
import { test } from "vite-plus/test";

import type { TasksWebAvailability } from "../../rpc/capabilityGate.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import { tasksAccessPending } from "./PlannerView.tsx";

const target = (availability: TasksWebAvailability, canReadTasks: boolean) =>
  ({
    environmentId: "local" as EnvironmentId,
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
