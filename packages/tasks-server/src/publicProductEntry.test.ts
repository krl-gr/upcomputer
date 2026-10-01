import { assert, it } from "@effect/vitest";
import { ProjectId } from "@upcomputer/contracts";
import { TASKS_RPC_METHODS, TaskId, TasksRpcGroup } from "@upcomputer/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import { runExperimentalFeatureMigrations } from "../../../apps/server/src/extensionApi.ts";
import * as NodeSqliteClient from "../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { PUBLIC_SERVER_PRODUCT_ENTRY } from "../../../apps/server/src/product/publicProductEntry.ts";
import { TaskAgentService, type TaskAgentServiceShape } from "./agents/TaskAgentService.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
  TaskRepositoryLive,
} from "./persistence/index.ts";
import { TASKS_RPC_CONTRIBUTION } from "./rpc/contributions.ts";

const { composition } = PUBLIC_SERVER_PRODUCT_ENTRY;

const handlerServices = Layer.mergeAll(
  TaskRepositoryLive,
  Layer.succeed(TaskAgentService, {
    scheduleTaskChanged: () => Effect.void,
  } as unknown as TaskAgentServiceShape),
  Layer.succeed(TaskPromptSettingsStore, {} as TaskPromptSettingsStoreShape),
  Layer.succeed(Crypto.Crypto, {} as Crypto.Crypto),
);

const testLayer = TASKS_RPC_CONTRIBUTION.handlers({
  currentSessionId: "session-test" as never,
}).pipe(Layer.provide(handlerServices), Layer.provideMerge(NodeSqliteClient.layerMemory()));

it.effect("the public server entry runs the task migrations and serves the tasks RPC", () =>
  Effect.gen(function* () {
    assert.include(composition.rpc, TASKS_RPC_CONTRIBUTION);
    yield* runExperimentalFeatureMigrations(composition.migrations);

    const client = yield* RpcTest.makeClient(TasksRpcGroup);
    const created = yield* client[TASKS_RPC_METHODS.create]({
      id: TaskId.make("task-public-build"),
      projectId: ProjectId.make("project-public-build"),
      title: "Composed by the public build",
      description: "",
      status: "Backlog",
    });
    const { tasks } = yield* client[TASKS_RPC_METHODS.search]({});

    assert.strictEqual(created.id, "task-public-build");
    assert.deepStrictEqual(
      tasks.map((task) => task.id),
      ["task-public-build"],
    );
  }).pipe(Effect.provide(testLayer)),
);
