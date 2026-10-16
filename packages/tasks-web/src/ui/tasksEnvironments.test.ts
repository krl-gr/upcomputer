import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";

import { resolveTasksWebAccess } from "../rpc/capabilityGate.ts";
import type { TasksWebRpcClient } from "../rpc/tasksRpcClient.ts";
import type { TasksStateTarget } from "../state/tasksState.ts";
import { pickEnvironment } from "../planner/ui/PlannerView.tsx";
import { tasksEnvironmentIds } from "./shared.ts";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

function targets(ids: readonly EnvironmentId[]): TasksStateTarget[] {
  return ids.map((environmentId) => ({
    environmentId,
    client: {} as TasksWebRpcClient,
    access: resolveTasksWebAccess({ availability: "enabled" }),
  }));
}

test("a fresh install without projects still plans in the primary environment", () => {
  const ids = tasksEnvironmentIds([], local);
  NodeAssert.deepEqual(ids, [local]);
  NodeAssert.equal(pickEnvironment(targets(ids), null, local), local);
});

test("without a primary environment and projects nothing serves Tasks", () => {
  const ids = tasksEnvironmentIds([], null);
  NodeAssert.deepEqual(ids, []);
  NodeAssert.equal(pickEnvironment(targets(ids), null, null), null);
});

test("environments with projects keep their order and the primary one is listed once", () => {
  const projects = [{ environmentId: remote }, { environmentId: local }, { environmentId: remote }];
  NodeAssert.deepEqual(tasksEnvironmentIds(projects, local), [remote, local]);
  NodeAssert.deepEqual(tasksEnvironmentIds(projects, null), [remote, local]);
});

test("a primary environment without projects joins remote ones and the stored choice wins", () => {
  const ids = tasksEnvironmentIds([{ environmentId: remote }], local);
  NodeAssert.deepEqual(ids, [remote, local]);
  NodeAssert.equal(pickEnvironment(targets(ids), null, local), local);
  NodeAssert.equal(pickEnvironment(targets(ids), remote, local), remote);
});
