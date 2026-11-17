import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const projectId = ProjectId.make("title-protection-project");

const layer = ProviderReplayHarness.layerWithRegistry(
  { name: "thread-title-protection" },
  ProviderAdapterRegistry.layerFromAdapters([
    {
      instanceId,
      driver,
      getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
      openSession: () => Effect.die("Provider execution is not needed for title decisions"),
    },
  ]),
  { runEffectWorker: false },
);

const createThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`${threadId}:create`),
      threadId,
      projectId,
      title: "New thread",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

const rename = (threadId: ThreadId, title: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make(`${threadId}:rename:${title}`),
      threadId,
      title,
    });
  });

// Clients send the composer text as the title seed with every message.
const send = (
  threadId: ThreadId,
  name: string,
  text: string,
  dispatchMode: { readonly type: "start_immediately" } | { readonly type: "queue_after_active" } = {
    type: "start_immediately",
  },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const commandId = CommandId.make(`${threadId}:${name}`);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId,
      threadId,
      messageId: MessageId.make(`${threadId}:${name}`),
      text,
      titleSeed: text,
      attachments: [],
      modelSelection,
      dispatchMode,
      createdBy: "user",
      creationSource: "web",
    });
    return commandId;
  });

const threadOf = (threadId: ThreadId) =>
  Orchestrator.OrchestratorV2.pipe(
    Effect.flatMap((orchestrator) => orchestrator.getThreadProjection(threadId)),
    Effect.map((projection) => projection.thread),
  );

it.effect("keeps a rename when the next message follows only maintenance commands", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("title-rename-after-compact");
    yield* createThread(threadId);
    yield* send(threadId, "compact", "/compact");
    yield* rename(threadId, "Parser work");
    yield* send(threadId, "first", "Fix the parser", { type: "queue_after_active" });
    const thread = yield* threadOf(threadId);
    assert.equal(thread.title, "Parser work");
    assert.isNull(thread.titleRegeneration);
  }).pipe(Effect.provide(layer)),
);

it.effect("lets an explicit regeneration replace a manual title", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("title-regenerate-manual");
    yield* createThread(threadId);
    yield* rename(threadId, "Parser work");
    const requestId = CommandId.make("title-regenerate-manual:regenerate");
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: requestId,
      threadId,
      regenerateTitle: true,
    });
    yield* orchestrator.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: CommandId.make("title-regenerate-manual:complete"),
      threadId,
      requestId,
      title: "Generated title",
    });
    const regenerated = yield* threadOf(threadId);
    assert.equal(regenerated.title, "Generated title");
    assert.isFalse(regenerated.titleManuallySet);
  }).pipe(Effect.provide(layer)),
);

const forkOf = (sourceThreadId: ThreadId, targetThreadId: ThreadId, renameSourceTo?: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const providerThreadId = ProviderThreadId.make(`${sourceThreadId}:provider-thread`);
    const runId = RunId.make(`${sourceThreadId}:run`);
    const messageId = MessageId.make(`${sourceThreadId}:message`);
    yield* createThread(sourceThreadId);
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`${sourceThreadId}:provider-thread`),
          type: "provider-thread.updated",
          threadId: sourceThreadId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: instanceId,
            providerSessionId: null,
            appThreadId: sourceThreadId,
            ownerNodeId: null,
            nativeThreadRef: { driver, nativeId: "native-source", strength: "strong" },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: EventId.make(`${sourceThreadId}:run`),
          type: "run.created",
          threadId: sourceThreadId,
          runId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId: sourceThreadId,
            ordinal: 1,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: messageId,
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed",
            queuePosition: null,
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
        {
          id: EventId.make(`${sourceThreadId}:item`),
          type: "turn-item.updated",
          threadId: sourceThreadId,
          runId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make(`${sourceThreadId}:item`),
            threadId: sourceThreadId,
            runId,
            nodeId: null,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            status: "completed",
            title: null,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            type: "user_message",
            createdBy: "user",
            creationSource: "web",
            inputIntent: "turn_start",
            messageId,
            text: "Explain the parser",
            attachments: [],
          },
        },
      ],
    });
    if (renameSourceTo !== undefined) yield* rename(sourceThreadId, renameSourceTo);
    yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make(`${targetThreadId}:fork`),
      sourceThreadId,
      targetThreadId,
      sourcePoint: { type: "run", runId },
      createdBy: "user",
      creationSource: "web",
    });
  });

it.effect("keeps a fork's rename when its first own message is sent", () =>
  Effect.gen(function* () {
    const targetThreadId = ThreadId.make("title-fork-renamed");
    yield* forkOf(ThreadId.make("title-fork-renamed-source"), targetThreadId);
    yield* rename(targetThreadId, "Parser alternative");
    yield* send(targetThreadId, "first", "Try a different approach");
    const thread = yield* threadOf(targetThreadId);
    assert.equal(thread.title, "Parser alternative");
    assert.isNull(thread.titleRegeneration);
  }).pipe(Effect.provide(layer)),
);

it.effect("titles a fork of a renamed thread from its first own message", () =>
  Effect.gen(function* () {
    const targetThreadId = ThreadId.make("title-fork-of-renamed");
    yield* forkOf(ThreadId.make("title-fork-of-renamed-source"), targetThreadId, "Parser work");
    const requestId = yield* send(targetThreadId, "first", "Try a different approach");
    const thread = yield* threadOf(targetThreadId);
    assert.equal(thread.titleRegeneration?.requestId, requestId);
  }).pipe(Effect.provide(layer)),
);
