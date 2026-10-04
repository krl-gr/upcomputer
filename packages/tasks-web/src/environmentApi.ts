import { useSyncExternalStore } from "react";
import { TASKS_RPC_METHODS } from "@t3tools/tasks-contracts/v1";
import type { EnvironmentId } from "@t3tools/contracts";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import * as Schema from "effect/Schema";

import { requestExperimentalFeatureRpc } from "../../../apps/web/src/extensionApi.ts";
import {
  createTasksWebRpcClient,
  resolveTasksWebAccess,
  TasksWebRpcGroup,
  type TasksWebAccess,
  type TasksWebAvailability,
  type TasksWebRpcClient,
  type TasksWebRpcRequest,
} from "./rpc/index.ts";

const RETRY_WHILE_DISCONNECTED_MS = 2_000;

interface Probe {
  readonly availability: TasksWebAvailability;
  readonly reason?: string;
}

const probes = new Map<EnvironmentId, Probe>();
const clients = new Map<EnvironmentId, TasksWebRpcClient>();
const listeners = new Set<() => void>();
let revision = 0;

function setProbe(environmentId: EnvironmentId, probe: Probe | undefined) {
  if (probe === undefined) probes.delete(environmentId);
  else probes.set(environmentId, probe);
  revision += 1;
  for (const listener of listeners) listener();
}

const requestFor =
  (environmentId: EnvironmentId): TasksWebRpcRequest =>
  (execute) =>
    requestExperimentalFeatureRpc(environmentId, TasksWebRpcGroup, execute);

/**
 * Asks the server once whether it serves the Tasks RPC group, the v2
 * replacement for V1's product-manifest gate. A server without the tasks
 * feature rejects the method; a disconnected one is asked again later.
 */
function startProbe(environmentId: EnvironmentId) {
  probes.set(environmentId, { availability: "loading" });
  requestFor(environmentId)((client) => client[TASKS_RPC_METHODS.runCounts]({})).then(
    () => setProbe(environmentId, { availability: "enabled" }),
    (error: unknown) => {
      if (Schema.is(EnvironmentRpcUnavailableError)(error)) {
        setTimeout(() => setProbe(environmentId, undefined), RETRY_WHILE_DISCONNECTED_MS);
        return;
      }
      setProbe(environmentId, {
        availability: "unavailable",
        reason: "The connected server does not serve Tasks.",
      });
    },
  );
}

/** What the Tasks UI may do in an environment; starts the check on first read. */
export function readTasksWebAccess(environmentId: EnvironmentId): TasksWebAccess {
  if (!probes.has(environmentId)) startProbe(environmentId);
  return resolveTasksWebAccess(probes.get(environmentId) ?? { availability: "loading" });
}

/** The environment's Tasks client; every call checks the current access first. */
export function readTasksWebClient(environmentId: EnvironmentId): TasksWebRpcClient {
  let client = clients.get(environmentId);
  if (client === undefined) {
    client = createTasksWebRpcClient(requestFor(environmentId), {
      getAccess: () => readTasksWebAccess(environmentId),
    });
    clients.set(environmentId, client);
  }
  return client;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever an environment's Tasks access is decided; use it as a memo dependency. */
export function useTasksWebAccessRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
}
