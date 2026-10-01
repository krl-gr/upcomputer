import {
  TASK_AGENTS_RPC_METHODS,
  TASK_AUTOMATIONS_RPC_METHODS,
  TASKS_RPC_METHODS,
} from "@upcomputer/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { createTaskChangeSubscription, type SubscribeTaskChanges } from "./taskChanges.ts";
import type { EnvironmentExtensionRpcRequest } from "../../../../apps/web/src/extensionApi.ts";

import { TasksWebCapabilityUnavailableError, type TasksWebAccess } from "./capabilityGate.ts";
import type { TasksWsRpcProtocolClient } from "./tasksRpcGroup.ts";

type RpcTag = keyof TasksWsRpcProtocolClient & string;
type RpcMethod<Tag extends RpcTag> = TasksWsRpcProtocolClient[Tag];
type RpcInput<Tag extends RpcTag> = Parameters<RpcMethod<Tag>>[0];
type RpcSuccess<Tag extends RpcTag> =
  RpcMethod<Tag> extends (input: any, options?: any) => Effect.Effect<infer Success, any, any>
    ? Success
    : never;
type RpcFailure<Tag extends RpcTag> =
  RpcMethod<Tag> extends (input: any, options?: any) => Effect.Effect<any, infer Failure, any>
    ? Failure
    : never;
type RpcUnaryMethod<Tag extends RpcTag> =
  RpcMethod<Tag> extends (input: any, options?: any) => Effect.Effect<infer Success, any, any>
    ? (input: RpcInput<Tag>) => Promise<Success>
    : never;

export interface TasksWebRpcClient {
  readonly tasks: {
    readonly create: RpcUnaryMethod<typeof TASKS_RPC_METHODS.create>;
    readonly search: RpcUnaryMethod<typeof TASKS_RPC_METHODS.search>;
    readonly page: RpcUnaryMethod<typeof TASKS_RPC_METHODS.page>;
    readonly runCounts: RpcUnaryMethod<typeof TASKS_RPC_METHODS.runCounts>;
    readonly threadRunCounts: RpcUnaryMethod<typeof TASKS_RPC_METHODS.threadRunCounts>;
    readonly threadTasks: RpcUnaryMethod<typeof TASKS_RPC_METHODS.threadTasks>;
    readonly items: RpcUnaryMethod<typeof TASKS_RPC_METHODS.items>;
    readonly subscribe: SubscribeTaskChanges;
    readonly get: RpcUnaryMethod<typeof TASKS_RPC_METHODS.get>;
    readonly update: RpcUnaryMethod<typeof TASKS_RPC_METHODS.update>;
    readonly reorder: RpcUnaryMethod<typeof TASKS_RPC_METHODS.reorder>;
    readonly delete: RpcUnaryMethod<typeof TASKS_RPC_METHODS.delete>;
    readonly addTag: RpcUnaryMethod<typeof TASKS_RPC_METHODS.addTag>;
    readonly removeTag: RpcUnaryMethod<typeof TASKS_RPC_METHODS.removeTag>;
    readonly appendEvent: RpcUnaryMethod<typeof TASKS_RPC_METHODS.appendEvent>;
    readonly getPromptSettings: RpcUnaryMethod<typeof TASKS_RPC_METHODS.getPromptSettings>;
    readonly updatePromptSettings: RpcUnaryMethod<typeof TASKS_RPC_METHODS.updatePromptSettings>;
  };
  readonly agents: {
    readonly upsert: RpcUnaryMethod<typeof TASK_AGENTS_RPC_METHODS.upsert>;
    readonly search: RpcUnaryMethod<typeof TASK_AGENTS_RPC_METHODS.search>;
    readonly delete: RpcUnaryMethod<typeof TASK_AGENTS_RPC_METHODS.delete>;
    readonly searchRuns: RpcUnaryMethod<typeof TASK_AGENTS_RPC_METHODS.searchRuns>;
  };
  readonly automations: {
    readonly upsert: RpcUnaryMethod<typeof TASK_AUTOMATIONS_RPC_METHODS.upsert>;
    readonly search: RpcUnaryMethod<typeof TASK_AUTOMATIONS_RPC_METHODS.search>;
    readonly setStatus: RpcUnaryMethod<typeof TASK_AUTOMATIONS_RPC_METHODS.setStatus>;
    readonly delete: RpcUnaryMethod<typeof TASK_AUTOMATIONS_RPC_METHODS.delete>;
    readonly searchRuns: RpcUnaryMethod<typeof TASK_AUTOMATIONS_RPC_METHODS.searchRuns>;
  };
}

export interface CreateTasksWebRpcClientOptions {
  readonly getAccess: () => TasksWebAccess;
}

type AccessFlag =
  | "canReadTasks"
  | "canMutateTasks"
  | "canReadAgents"
  | "canMutateAgents"
  | "canReadAutomations"
  | "canMutateAutomations";

export function createTasksWebRpcClient(
  requestRpc: EnvironmentExtensionRpcRequest<TasksWsRpcProtocolClient>,
  options: CreateTasksWebRpcClientOptions,
): TasksWebRpcClient {
  const request = <Tag extends RpcTag>(
    operation: string,
    required: AccessFlag,
    tag: Tag,
    input: RpcInput<Tag>,
  ): Promise<RpcSuccess<Tag>> => {
    const access = options.getAccess();
    if (!access[required]) {
      return Promise.reject(new TasksWebCapabilityUnavailableError(operation, access.reason));
    }
    return requestRpc((client) => {
      const method = client[tag] as unknown as (
        payload: RpcInput<Tag>,
      ) => Effect.Effect<RpcSuccess<Tag>, RpcFailure<Tag>, never>;
      return method(input);
    });
  };

  const subscribe = createTaskChangeSubscription((signal, listener) => {
    if (!options.getAccess().canReadTasks)
      return Promise.reject(
        new TasksWebCapabilityUnavailableError("tasks.subscribe", options.getAccess().reason),
      );
    return requestRpc((client) => {
      const aborted = Effect.callback<void>((resume) => {
        const stop = () => resume(Effect.void);
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", stop));
      });
      return client[TASKS_RPC_METHODS.subscribe]({}).pipe(
        Stream.runForEach((event) => Effect.sync(() => listener(event))),
        Effect.raceFirst(aborted),
      );
    });
  });

  return {
    tasks: {
      create: (input) => request("tasks.create", "canMutateTasks", TASKS_RPC_METHODS.create, input),
      search: (input) => request("tasks.search", "canReadTasks", TASKS_RPC_METHODS.search, input),
      page: (input) => request("tasks.page", "canReadTasks", TASKS_RPC_METHODS.page, input),
      items: (input) => request("tasks.items", "canReadTasks", TASKS_RPC_METHODS.items, input),
      runCounts: (input) =>
        request("tasks.runCounts", "canReadTasks", TASKS_RPC_METHODS.runCounts, input),
      threadRunCounts: (input) =>
        request("tasks.threadRunCounts", "canReadTasks", TASKS_RPC_METHODS.threadRunCounts, input),
      threadTasks: (input) =>
        request("tasks.threadTasks", "canReadTasks", TASKS_RPC_METHODS.threadTasks, input),
      subscribe,
      get: (input) => request("tasks.get", "canReadTasks", TASKS_RPC_METHODS.get, input),
      update: (input) => request("tasks.update", "canMutateTasks", TASKS_RPC_METHODS.update, input),
      reorder: (input) =>
        request("tasks.reorder", "canMutateTasks", TASKS_RPC_METHODS.reorder, input),
      delete: (input) => request("tasks.delete", "canMutateTasks", TASKS_RPC_METHODS.delete, input),
      addTag: (input) => request("tasks.addTag", "canMutateTasks", TASKS_RPC_METHODS.addTag, input),
      removeTag: (input) =>
        request("tasks.removeTag", "canMutateTasks", TASKS_RPC_METHODS.removeTag, input),
      appendEvent: (input) =>
        request("tasks.appendEvent", "canMutateTasks", TASKS_RPC_METHODS.appendEvent, input),
      getPromptSettings: (input) =>
        request(
          "tasks.getPromptSettings",
          "canReadTasks",
          TASKS_RPC_METHODS.getPromptSettings,
          input,
        ),
      updatePromptSettings: (input) =>
        request(
          "tasks.updatePromptSettings",
          "canMutateTasks",
          TASKS_RPC_METHODS.updatePromptSettings,
          input,
        ),
    },
    agents: {
      upsert: (input) =>
        request("agents.upsert", "canMutateAgents", TASK_AGENTS_RPC_METHODS.upsert, input),
      search: (input) =>
        request("agents.search", "canReadAgents", TASK_AGENTS_RPC_METHODS.search, input),
      delete: (input) =>
        request("agents.delete", "canMutateAgents", TASK_AGENTS_RPC_METHODS.delete, input),
      searchRuns: (input) =>
        request("agents.searchRuns", "canReadAgents", TASK_AGENTS_RPC_METHODS.searchRuns, input),
    },
    automations: {
      upsert: (input) =>
        request(
          "automations.upsert",
          "canMutateAutomations",
          TASK_AUTOMATIONS_RPC_METHODS.upsert,
          input,
        ),
      search: (input) =>
        request(
          "automations.search",
          "canReadAutomations",
          TASK_AUTOMATIONS_RPC_METHODS.search,
          input,
        ),
      setStatus: (input) =>
        request(
          "automations.setStatus",
          "canMutateAutomations",
          TASK_AUTOMATIONS_RPC_METHODS.setStatus,
          input,
        ),
      delete: (input) =>
        request(
          "automations.delete",
          "canMutateAutomations",
          TASK_AUTOMATIONS_RPC_METHODS.delete,
          input,
        ),
      searchRuns: (input) =>
        request(
          "automations.searchRuns",
          "canReadAutomations",
          TASK_AUTOMATIONS_RPC_METHODS.searchRuns,
          input,
        ),
    },
  };
}
