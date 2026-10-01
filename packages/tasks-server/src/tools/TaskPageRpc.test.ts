/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  TASKS_RPC_METHODS,
  TasksRpcGroup,
  type TaskPageInput,
  type TaskPageResult,
} from "@upcomputer/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import {
  TaskPromptSettingsStore,
  type TaskPromptSettingsStoreShape,
} from "../persistence/TaskPromptSettingsStore.ts";
import { TASKS_RPC_CONTRIBUTION } from "../rpc/contributions.ts";

function callPage(
  input: TaskPageInput,
  subscribe = false,
  thread?: "threadRunCounts" | "threadTasks",
) {
  const requests: TaskPageInput[] = [];
  const result: TaskPageResult = {
    tasks: [],
    statuses: ["Backlog", "in progress"],
    nextCursor: null,
  };
  const repository = new Proxy(
    {
      page: (query: TaskPageInput) =>
        Effect.sync(() => {
          requests.push(query);
          return result;
        }),
      threadRunCounts: (query: unknown) =>
        Effect.sync(() => {
          requests.push(query as TaskPageInput);
          return { threads: [] };
        }),
      threadTasks: (query: unknown) =>
        Effect.sync(() => {
          requests.push(query as TaskPageInput);
          return { tasks: [] };
        }),
      getById: () => Effect.succeed(Option.none()),
      changes: Stream.succeed({
        kind: "sync" as const,
        sequence: 0,
        taskIds: [],
        listChanged: true,
        runsChanged: true,
        rootThreadIds: [],
      }),
    } as unknown as TaskRepositoryShape,
    {
      get: (target, key) => Reflect.get(target, key) ?? (() => Effect.die("unused method")),
    },
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(TaskRepository, repository),
    Layer.succeed(TaskAgentService, {} as TaskAgentServiceShape),
    Layer.succeed(TaskPromptSettingsStore, {} as TaskPromptSettingsStoreShape),
    Layer.succeed(Crypto.Crypto, {} as Crypto.Crypto),
  );
  const effect = Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(TasksRpcGroup);
    if (thread === "threadRunCounts") {
      yield* client[TASKS_RPC_METHODS.threadRunCounts]({ threadIds: ["root" as never] });
      return { page: result, missing: null };
    }
    if (thread === "threadTasks") {
      yield* client[TASKS_RPC_METHODS.threadTasks]({ threadId: "root" as never, limit: 50 });
      return { page: result, missing: null };
    }
    if (subscribe) {
      const events = yield* client[TASKS_RPC_METHODS.subscribe]({}).pipe(
        Stream.take(1),
        Stream.runCollect,
      );
      NodeAssert.equal(events[0]?.kind, "sync");
      return { page: result, missing: null };
    }
    const page = yield* client[TASKS_RPC_METHODS.page](input);
    const missing = yield* client[TASKS_RPC_METHODS.get]({ id: "missing" as never });
    return { page, missing };
  }).pipe(
    Effect.provide(TASKS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never })),
    Effect.provide(dependencies),
    Effect.scoped,
  );
  return { effect, requests };
}

test("page RPC forwards server filters/cursors and exposes complete facets; get supports missing deep links", async () => {
  const input: TaskPageInput = {
    status: "in progress",
    limit: 100,
    cursor: { rank: "0000000000000001" as never, id: "task-200" as never },
  };
  const { effect, requests } = callPage(input);
  const result = await Effect.runPromise(effect);
  NodeAssert.deepEqual(requests, [input]);
  NodeAssert.deepEqual(result.page.statuses, ["Backlog", "in progress"]);
  NodeAssert.equal(result.missing, null);
});

test("task subscription is a streamed RPC", async () => {
  await Effect.runPromise(callPage({}, true).effect);
});

test("thread summary RPC sends one batch to the repository", async () => {
  const allowed = callPage({}, false, "threadRunCounts");
  await Effect.runPromise(allowed.effect);
  NodeAssert.deepEqual(allowed.requests, [{ threadIds: ["root"] }]);
});

test("thread task list RPC forwards the thread and limit", async () => {
  const allowed = callPage({}, false, "threadTasks");
  await Effect.runPromise(allowed.effect);
  NodeAssert.deepEqual(allowed.requests, [{ threadId: "root", limit: 50 }]);
});
