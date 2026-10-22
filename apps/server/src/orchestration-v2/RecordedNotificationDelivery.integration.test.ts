import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { setUserInstructions } from "@t3tools/provider-core/server/userInstructions";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const NOTE = "Note: these notifications were shown in this thread since your last turn.";

/**
 * A provider that completes every turn it is given and records the prompt text.
 * `beforeThreadReady` runs once while the next turn's provider thread is loaded,
 * after the turn start read its projection.
 */
function makeHarness(name: string) {
  return Effect.gen(function* () {
    const cwd = yield* checkpointWorkspace(name);
    const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    const prompts: string[] = [];
    let beforeThreadReady: Effect.Effect<void> | undefined;
    const threadReady = <A>(value: A) =>
      Effect.suspend(() => {
        const hook = beforeThreadReady;
        beforeThreadReady = undefined;
        return (hook ?? Effect.void).pipe(Effect.as(value));
      });
    const providerTurn = (
      turn: ProviderAdapter.ProviderAdapterV2TurnInput,
      status: "running" | "completed",
      at: DateTime.Utc,
    ): ProviderAdapter.ProviderAdapterV2Event => ({
      type: "provider_turn.updated",
      driver,
      providerTurn: {
        id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
        providerThreadId: turn.providerThread.id,
        nodeId: turn.rootNodeId,
        runAttemptId: turn.attemptId,
        nativeTurnRef: { driver, nativeId: `native:${turn.attemptId}`, strength: "strong" },
        ordinal: turn.providerTurnOrdinal,
        status,
        startedAt: at,
        completedAt: status === "running" ? null : at,
      },
    });
    const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
      instanceId,
      driver,
      getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
      openSession: (input) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          return {
            instanceId,
            driver,
            providerSessionId: input.providerSessionId,
            providerSession: {
              id: input.providerSessionId,
              driver,
              providerInstanceId: instanceId,
              status: "ready",
              cwd,
              model: modelSelection.model,
              capabilities: CodexProviderCapabilitiesV2,
              createdAt: now,
              updatedAt: now,
              lastError: null,
            },
            events: Stream.fromQueue(events),
            ensureThread: ({ threadId }) =>
              threadReady({
                id: ProviderThreadId.make(`provider-thread:${threadId}`),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: input.providerSessionId,
                appThreadId: threadId,
                ownerNodeId: null,
                nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
              } satisfies OrchestrationV2ProviderThread),
            resumeThread: ({ providerThread }) => threadReady(providerThread),
            startTurn: (turn) =>
              Effect.gen(function* () {
                prompts.push(turn.message.text);
                const at = yield* DateTime.now;
                yield* Queue.offer(events, providerTurn(turn, "running", at));
                yield* Queue.offer(events, providerTurn(turn, "completed", at));
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver,
                  providerThreadId: turn.providerThread.id,
                  providerTurnId: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                  runOrdinal: turn.runOrdinal,
                  status: "completed",
                  failure: null,
                  threadDisposition: "reusable",
                });
              }),
            steerTurn: () => Effect.void,
            interruptTurn: () => Effect.void,
            respondToRuntimeRequest: () => Effect.void,
            readThreadSnapshot: () => Effect.die("unused"),
            rollbackThread: () => Effect.die("unused"),
            forkThread: () => Effect.die("unused"),
          };
        }),
    };
    const layer = ProviderReplayHarness.layerWithRegistry(
      { name, runtimePolicyOverride: { cwd } },
      ProviderAdapterRegistry.layerSingle(adapter),
    );
    return {
      cwd,
      prompts,
      layer,
      setBeforeThreadReady: (hook: Effect.Effect<void>) => {
        beforeThreadReady = hook;
      },
    };
  });
}

const threadId = ThreadId.make("thread:recorded-notification");
/** Each step happens later than the previous one, as it would outside the test clock. */
const tick = TestClock.adjust("1 second");

const scenario = Effect.fn("recordedNotificationScenario")(function* (cwd: string) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create"),
    threadId,
    projectId: ProjectId.make("project:recorded-notification"),
    title: "Recorded notifications",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: cwd,
    createdBy: "user",
    creationSource: "web",
  });
  const recordCard = (name: string) =>
    tick.pipe(
      Effect.andThen(
        orchestrator.dispatch({
          type: "thread.notification.record",
          commandId: CommandId.make(`card:${name}`),
          threadId,
          notification: {
            source: { kind: "task_agent_run", tasks: [] },
            outcome: "completed",
            summary: `Task ${name} done`,
          },
        }),
      ),
    );
  /** Sends a message and waits until its run completed and its effects settled. */
  const send = Effect.fn("send")(function* (text: string) {
    const completed = yield* orchestrator.streamDomainEvents.pipe(
      Stream.filter(
        (event: OrchestrationV2DomainEvent) =>
          event.type === "run.updated" &&
          event.payload.userMessageId === MessageId.make(`message:${text}`) &&
          event.payload.status === "completed",
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* tick;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`send:${text}`),
      threadId,
      messageId: MessageId.make(`message:${text}`),
      text,
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* worker.drain();
    yield* Fiber.join(completed);
    yield* worker.drain();
  });
  return { recordCard, send };
});

it.effect("a card recorded while the provider starts reaches the next prompt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness("recorded-notification-startup-race");
      yield* Effect.gen(function* () {
        const { recordCard, send } = yield* scenario(harness.cwd);
        // Recorded after the turn start read its projection, before the run started.
        harness.setBeforeThreadReady(recordCard("A").pipe(Effect.andThen(tick), Effect.orDie));
        yield* send("first");
        assert.strictEqual(harness.prompts[0], "first");
        yield* send("second");
        assert.include(harness.prompts[1], NOTE);
        assert.include(harness.prompts[1], "- Task A done");
        assert.isTrue(harness.prompts[1]!.endsWith("User message:\nsecond"));
        yield* send("third");
        assert.strictEqual(harness.prompts[2], "third");
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("a slash command stays a command, and the next prompt carries the card", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness("recorded-notification-slash-command");
      yield* Effect.gen(function* () {
        const { recordCard, send } = yield* scenario(harness.cwd);
        yield* send("first");
        yield* recordCard("A");
        yield* send("/hello WORLD");
        assert.strictEqual(harness.prompts[1], "/hello WORLD");
        yield* send("next");
        assert.include(harness.prompts[2], "- Task A done");
        assert.isTrue(harness.prompts[2]!.endsWith("User message:\nnext"));
        yield* send("after");
        assert.strictEqual(harness.prompts[3], "after");
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect(
  "only a person's first prompt carries the onboarding note while the block is pending",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness("onboarding-turn-note");
        setUserInstructions(DEFAULT_CUSTOM_INSTRUCTIONS);
        yield* Effect.gen(function* () {
          const { send } = yield* scenario(harness.cwd);
          yield* send("hi");
          assert.isTrue(harness.prompts[0]!.startsWith("[UpComputer: this is the first message"));
          assert.isTrue(harness.prompts[0]!.endsWith("User message:\nhi"));
          yield* send("second");
          assert.strictEqual(harness.prompts[1], "second");
        }).pipe(
          Effect.provide(harness.layer),
          Effect.ensuring(Effect.sync(() => setUserInstructions(""))),
        );
      }),
    ),
);
