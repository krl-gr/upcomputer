import { useSyncExternalStore } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { createTasksEnvironmentAccess } from "@t3tools/tasks-client/environmentAccess";

import { requestExperimentalFeatureRpc } from "../../../apps/web/src/extensionApi.ts";
import {
  resolveTasksWebAccess,
  TasksWebRpcGroup,
  type TasksWebAccess,
  type TasksWebAvailability,
  type TasksWebRpcClient,
} from "@t3tools/tasks-client/rpc";

const access = createTasksEnvironmentAccess(
  (environmentId) => (execute, authorization) =>
    requestExperimentalFeatureRpc(environmentId, TasksWebRpcGroup, execute, authorization),
);

/**
 * Whether the server has the planner's schedule methods (tasks RPC version
 * 13), asked once like the group probe. Older servers get the table only.
 */
export function readPlannerAvailability(environmentId: EnvironmentId): TasksWebAvailability {
  return access.readPlannerAvailability(environmentId);
}

/** What the Tasks UI may do in an environment; starts the check on first read. */
export function readTasksWebAccess(environmentId: EnvironmentId): TasksWebAccess {
  return access.readAccess(environmentId);
}

/** The environment's Tasks client; every call checks the current access first. */
export function readTasksWebClient(environmentId: EnvironmentId): TasksWebRpcClient {
  return access.readClient(environmentId);
}

/** Calls the listener whenever an environment's Tasks access, or the planner's, is decided. */
export function subscribeTasksWebAccess(listener: () => void) {
  return access.subscribe(listener);
}

/**
 * The planner availability as a store snapshot. A plain render-time call to
 * `readPlannerAvailability` is cached by the React Compiler on its argument,
 * so a probe that settles later would never reach the view.
 */
export function usePlannerAvailability(
  environmentId: EnvironmentId | null,
): TasksWebAvailability | null {
  const read = () => (environmentId ? readPlannerAvailability(environmentId) : null);
  return useSyncExternalStore(subscribeTasksWebAccess, read, read);
}

/** Changes whenever an environment's Tasks access is decided; use it as a memo dependency. */
export function useTasksWebAccessRevision(): number {
  return useSyncExternalStore(subscribeTasksWebAccess, access.revision, access.revision);
}

/** Subscribe to availability itself so render-time access reads cannot stay cached. */
export function useTasksWebAccess(environmentId: EnvironmentId): TasksWebAccess {
  const read = () => readTasksWebAccess(environmentId).availability;
  const availability = useSyncExternalStore(subscribeTasksWebAccess, read, read);
  return resolveTasksWebAccess({ availability });
}
