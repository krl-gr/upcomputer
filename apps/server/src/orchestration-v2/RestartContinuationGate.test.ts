import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import { continueRestartedRun } from "./RestartContinuation.ts";
import {
  registerRestartContinuationGate,
  type RestartContinuationGateInput,
} from "./RestartContinuationGate.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const threadId = ThreadId.make("thread:gate");
const runId = RunId.make("run:gate");
const instanceId = ProviderInstanceId.make("codex");

/** A run the restart cancelled: a continuation source on its own. */
const projection = {
  thread: {
    id: threadId,
    projectId: ProjectId.make("gate-project"),
    providerInstanceId: instanceId,
    archivedAt: null,
    deletedAt: null,
  },
  runs: [
    {
      id: runId,
      ordinal: 1,
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "gpt-6" },
      providerThreadId: ProviderThreadId.make("provider-thread:gate"),
      activeAttemptId: RunAttemptId.make("attempt:gate"),
      status: "cancelled",
    },
  ],
  providerThreads: [],
  providerSessions: [],
  providerTurns: [],
  runtimeRequests: [],
  attempts: [],
  nodes: [],
  subagents: [],
  messages: [],
  turnItems: [],
} as unknown as OrchestrationV2ThreadProjection;

const continueWithGate = (admit: boolean) =>
  Effect.gen(function* () {
    const dispatched: Array<string> = [];
    const gated: Array<RestartContinuationGateInput> = [];
    let delegatedRecovered = 0;
    yield* registerRestartContinuationGate((input, send) => {
      gated.push(input);
      return admit ? Effect.as(send, true) : Effect.succeed(false);
    });
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(projection),
            recoverDelegatedTask: () =>
              Effect.sync(() => {
                delegatedRecovered += 1;
              }),
            // Lazy like the service, so a refused send never runs it.
            dispatch: (command) =>
              Effect.sync(() => {
                dispatched.push(command.type);
                return {} as never;
              }),
          }),
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        ),
      ),
    );
    return { dispatched, gated, delegatedRecovered };
  }).pipe(Effect.scoped);

it.effect("a refusing gate keeps the continuation turn from being dispatched", () =>
  Effect.gen(function* () {
    const result = yield* continueWithGate(false);
    assert.deepStrictEqual(result.gated, [{ threadId, sourceRunId: runId }]);
    assert.deepStrictEqual(result.dispatched, []);
    // A delegated child the gate declined still reports to its parent.
    assert.strictEqual(result.delegatedRecovered, 1);
  }),
);

it.effect("an admitting gate dispatches the continuation turn", () =>
  Effect.gen(function* () {
    const result = yield* continueWithGate(true);
    assert.deepStrictEqual(result.dispatched, ["message.dispatch"]);
  }),
);
