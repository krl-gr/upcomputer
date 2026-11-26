import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import {
  createCommandPermissions,
  createEnvironmentCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { createTasksEnvironmentAccess } from "@t3tools/tasks-client/environmentAccess";
import {
  resolveTasksWebAccess,
  type TasksWebAccess,
  type TasksWebAvailability,
  type TasksWsRpcProtocolClient,
} from "@t3tools/tasks-client/rpc";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { useSyncExternalStore } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";

/** Carries a Tasks RPC failure through the environment command. */
class TasksRpcFailure extends Schema.TaggedError<TasksRpcFailure>()("TasksRpcFailure", {
  error: Schema.Unknown,
}) {}

const isTasksRpcFailure = Schema.is(TasksRpcFailure);

interface TasksRpcRequest {
  readonly execute: (client: TasksWsRpcProtocolClient) => Effect.Effect<unknown, TasksRpcFailure>;
  readonly method?: string;
  readonly input?: unknown;
}

const tasksRpcRequest = createEnvironmentCommand(connectionAtomRuntime, {
  label: "tasks-rpc",
  execute: Effect.fn("TasksRpc.execute")(function* (
    input: TasksRpcRequest,
    registry,
    environmentId: EnvironmentId,
  ) {
    if (input.method !== undefined)
      yield* createCommandPermissions(connectionAtomRuntime, input.method).authorize(
        registry,
        environmentId,
        input.input,
      );
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const session = yield* SubscriptionRef.get(supervisor.session);
    if (Option.isNone(session)) {
      return yield* new EnvironmentRpcUnavailableError({
        environmentId: supervisor.target.environmentId,
        message: `${supervisor.target.label} is not connected.`,
      });
    }
    // The session client is built by makeTasksSessionRpcClient, so it carries the Tasks group.
    return yield* input.execute(session.value.client as unknown as TasksWsRpcProtocolClient);
  }),
});

/** Runs one Tasks call on an environment's current session, as web's feature RPC does. */
async function requestTasksRpc<A, E>(
  environmentId: EnvironmentId,
  execute: (client: TasksWsRpcProtocolClient) => Effect.Effect<A, E>,
  authorization?: { readonly method: string; readonly input: unknown },
): Promise<A> {
  const result = await runAtomCommand(
    appAtomRegistry,
    tasksRpcRequest,
    {
      environmentId,
      input: {
        ...authorization,
        execute: (client) =>
          execute(client).pipe(Effect.mapError((error) => new TasksRpcFailure({ error }))),
      },
    },
    { reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Success") return result.value as A;
  const failure = squashAtomCommandFailure(result);
  throw isTasksRpcFailure(failure) ? failure.error : failure;
}

const tasksAccess = createTasksEnvironmentAccess(
  (environmentId) => (execute, authorization) =>
    requestTasksRpc(environmentId, execute, authorization),
);

export const readTasksClient = tasksAccess.readClient;
export const readTasksAccess = tasksAccess.readAccess;
export const subscribeTasksAccess = tasksAccess.subscribe;

// One object per availability, so effects that depend on access rerun only when it changes.
const ACCESS_BY_AVAILABILITY: Readonly<Record<TasksWebAvailability, TasksWebAccess>> = {
  loading: resolveTasksWebAccess({ availability: "loading" }),
  unavailable: resolveTasksWebAccess({ availability: "unavailable" }),
  enabled: resolveTasksWebAccess({ availability: "enabled" }),
};

/** Whether the environment's server serves Tasks; the first read starts the check. */
export function useTasksAccess(environmentId: EnvironmentId | null): TasksWebAccess | null {
  const read = () => (environmentId ? tasksAccess.readAccess(environmentId).availability : null);
  const availability = useSyncExternalStore(tasksAccess.subscribe, read, read);
  return availability === null ? null : ACCESS_BY_AVAILABILITY[availability];
}
