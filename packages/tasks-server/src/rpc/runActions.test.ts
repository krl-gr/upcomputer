import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  TASK_AGENTS_RPC_METHODS,
  TaskAgentId,
  TaskAgentRunId,
  TaskAgentsRpcGroup,
  TaskId,
  type TaskAgentRun,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Option from "effect/Option";
import * as RpcTest from "effect/rpc/RpcTest";

import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { BotService } from "../bots/BotService.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TASK_RPC_CONTRIBUTIONS } from "./contributions.ts";

const [, TASK_AGENTS_RPC_CONTRIBUTION] = TASK_RPC_CONTRIBUTIONS;

const run: TaskAgentRun = {
  id: TaskAgentRunId.make("task-agent-run-1"),
  taskId: TaskId.make("task-1"),
  agentId: TaskAgentId.make("task-agent-1"),
  threadId: ThreadId.make("thread-1"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  status: "running",
  startedAt: "2026-11-26T10:00:00.000Z",
  completedAt: null,
  triggerRunId: null,
  continuesRunId: null,
};

const calls: Array<{ readonly method: string; readonly input: unknown }> = [];

const taskAgents = Layer.succeed(TaskAgentService, {
  stopRun: (input: { readonly id: string }) =>
    Effect.sync(() => {
      calls.push({ method: "stopRun", input });
      return input.id === run.id
        ? Option.some({ ...run, status: "stopped", completedAt: "2026-11-26T10:05:00.000Z" })
        : Option.none();
    }),
  messageRun: (input: { readonly id: string; readonly text: string }) =>
    Effect.sync(() => {
      calls.push({ method: "messageRun", input });
      return input.text === "refuse"
        ? { ok: false as const, error: "Task 'task-1' is archived." }
        : { ok: true as const, run: { ...run, id: TaskAgentRunId.make("run-2") }, continued: true };
    }),
} as never);

const handlers = TASK_AGENTS_RPC_CONTRIBUTION.handlers({ currentSessionId: "test" as never });

it.effect("a person stops and messages a worker run over RPC", () =>
  Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(TaskAgentsRpcGroup);

    const stopped = yield* client[TASK_AGENTS_RPC_METHODS.stopRun]({ id: run.id });
    assert.strictEqual(stopped.status, "stopped");
    const missing = yield* Effect.flip(
      client[TASK_AGENTS_RPC_METHODS.stopRun]({ id: TaskAgentRunId.make("gone") }),
    );
    assert.strictEqual(missing.message, "This worker run no longer exists.");

    const continued = yield* client[TASK_AGENTS_RPC_METHODS.messageRun]({
      runId: run.id,
      text: "Use the staging database.",
    });
    assert.deepStrictEqual([continued.run.id, continued.continued], ["run-2", true]);
    const refused = yield* Effect.flip(
      client[TASK_AGENTS_RPC_METHODS.messageRun]({ runId: run.id, text: "refuse" }),
    );
    assert.strictEqual(refused.message, "Task 'task-1' is archived.");

    assert.deepStrictEqual(calls[2], {
      method: "messageRun",
      input: { id: run.id, text: "Use the staging database." },
    });
  }).pipe(
    Effect.provide(handlers),
    // The group's other handlers need these; the run actions reach only TaskAgentService.
    Effect.provide(
      Layer.mergeAll(
        taskAgents,
        Layer.succeed(TaskRepository, {} as never),
        Layer.succeed(BotService, {} as never),
        Layer.succeed(SecureRandom.SecureRandom, {} as never),
      ),
    ),
    Effect.scoped,
  ),
);

it("stopping and messaging need the operate scope, as the other run changes do", () => {
  const scopes = TASK_AGENTS_RPC_CONTRIBUTION.requiredScopes;
  assert.strictEqual(scopes[TASK_AGENTS_RPC_METHODS.stopRun], "orchestration:operate");
  assert.strictEqual(scopes[TASK_AGENTS_RPC_METHODS.messageRun], "orchestration:operate");
});
