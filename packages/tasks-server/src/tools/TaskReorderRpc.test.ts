/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  TASKS_RPC_METHODS,
  TaskError,
  TasksRpcGroup,
  type Task,
  type TaskReorderInput,
} from "@upcomputer/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import { TaskPersistenceSqlError } from "../persistence/Errors.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
} from "../persistence/TaskPromptSettingsStore.ts";
import { TASKS_RPC_CONTRIBUTION } from "../rpc/contributions.ts";

const persisted = {
  id: "task-2",
  rank: "0000000000000020",
  title: "Second",
} as unknown as Task;

function callReorderRpc(reorder: TaskRepositoryShape["reorder"], input: TaskReorderInput) {
  const repository = new Proxy({ reorder } as unknown as TaskRepositoryShape, {
    get: (target, key) =>
      Reflect.get(target, key) ?? (() => Effect.die("unused repository method")),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskAgentService, {} as TaskAgentServiceShape),
    Layer.succeed(TaskPromptSettingsStore, {} as TaskPromptSettingsStoreShape),
    Layer.succeed(Crypto.Crypto, {} as Crypto.Crypto),
  );
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(TasksRpcGroup);
    return yield* client[TASKS_RPC_METHODS.reorder](input);
  }).pipe(
    Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "session-test" as never })),
    Effect.provide(dependencies),
    Effect.scoped,
  );
}

test("tasks RPC executes semantic-neighbor reorder through its real handler", async () => {
  const requests: TaskReorderInput[] = [];
  const result = await Effect.runPromise(
    callReorderRpc(
      (input) =>
        Effect.sync(() => {
          requests.push(input);
          return persisted;
        }),
      {
        id: "task-2" as never,
        afterTaskId: "task-1" as never,
        beforeTaskId: "task-3" as never,
      },
    ),
  );

  NodeAssert.equal(result.rank, "0000000000000020");
  NodeAssert.deepEqual(requests, [{ id: "task-2", afterTaskId: "task-1", beforeTaskId: "task-3" }]);
});

test("tasks RPC returns a typed error when repository neighbor validation fails", async () => {
  await NodeAssert.rejects(
    Effect.runPromise(
      callReorderRpc(
        () =>
          Effect.fail(
            new TaskPersistenceSqlError({
              operation: "reorder task",
              detail: "Invalid semantic neighbor.",
            }),
          ),
        {
          id: "task-2" as never,
          beforeTaskId: "missing" as never,
        },
      ),
    ),
    (error) => error instanceof TaskError && /Task operation failed/.test(error.message),
  );
});
