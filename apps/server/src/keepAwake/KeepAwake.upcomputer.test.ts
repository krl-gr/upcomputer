import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  type OrchestrationV2RuntimeRequest,
  type ServerSettings,
  ThreadId,
  ProjectId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as KeepAwake from "./KeepAwake.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;

const layerDatabase = SqlitePersistence.layerMemory;
const layerEventSink = EventSink.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.merge(EventStore.layer, ProjectionStore.layer).pipe(Layer.provide(layerDatabase)),
      layerDatabase,
    ),
  ),
);

// The test settings layer streams no changes, so publish each update like the real service.
const layerSettings = Layer.effect(
  ServerSettingsModule.ServerSettingsService,
  Effect.gen(function* () {
    const base = yield* ServerSettingsModule.ServerSettingsService;
    const changes = yield* PubSub.unbounded<ServerSettings>();
    return ServerSettingsModule.ServerSettingsService.of({
      ...base,
      updateSettings: (patch) =>
        base.updateSettings(patch).pipe(Effect.tap((next) => PubSub.publish(changes, next))),
      streamChanges: Stream.fromPubSub(changes),
      subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
    });
  }),
).pipe(Layer.provide(ServerSettingsModule.layerTest()));

const layerTest = Layer.mergeAll(layerEventSink, layerDatabase, layerSettings);

const threadId = ThreadId.make("thread:keep-awake");

const seedThread = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  const thread: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project:keep-awake"),
    title: "Keep awake",
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    branchPullRequest: null,
    activeOrderKey: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  yield* eventSink.write({
    events: [
      {
        id: EventId.make("keep-awake:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: thread,
      },
    ],
  });
});

const writeRun = (ordinal: number, status: OrchestrationV2Run["status"]) =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const run: OrchestrationV2Run = {
      id: RunId.make(`run:keep-awake:${ordinal}`),
      threadId,
      ordinal,
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make(`message:keep-awake:${ordinal}`),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`keep-awake:run:${ordinal}:${status}`),
          type: status === "queued" || status === "preparing" ? "run.created" : "run.updated",
          threadId,
          runId: run.id,
          providerInstanceId: run.providerInstanceId,
          occurredAt: now,
          payload: run,
        },
      ],
    });
  });

const writeRequest = (
  name: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
  status: OrchestrationV2RuntimeRequest["status"],
  responseCapability: OrchestrationV2RuntimeRequest["responseCapability"] = {
    type: "live",
    providerSessionId: ProviderSessionId.make("session:keep-awake"),
  },
) =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`keep-awake:request:${name}:${status}`),
          type: "runtime-request.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: RuntimeRequestId.make(`request:keep-awake:${name}`),
            nodeId: NodeId.make(`node:keep-awake:${name}`),
            providerTurnId: null,
            nativeRequestRef: null,
            kind,
            status,
            responseCapability,
            createdAt: now,
            resolvedAt: status === "pending" ? null : now,
          },
        },
      ],
    });
  });

const startKeepAwake = Effect.gen(function* () {
  const reports = yield* Queue.unbounded<boolean>();
  yield* KeepAwake.make().pipe(
    Effect.provide(
      DesktopTelemetryReceiver.layerTest({
        setKeepAwake: (active) => Queue.offer(reports, active).pipe(Effect.asVoid),
      }),
    ),
  );
  return reports;
});

it.layer(layerTest)("KeepAwake", (it) => {
  it.effect("holds the blocker while any run works and releases on setting off and shutdown", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      yield* seedThread;
      // A queued run never counts: it is waiting its turn, not working.
      yield* writeRun(1, "queued");
      // A run that was already working when the server started counts at once.
      yield* writeRun(2, "preparing");
      yield* writeRun(2, "running");

      const reports = yield* Effect.scoped(
        Effect.gen(function* () {
          const reports = yield* startKeepAwake;
          assert.isTrue(yield* Queue.take(reports));

          // Overlap: a second run waits on background work while the first finishes.
          yield* writeRun(3, "preparing");
          yield* writeRun(3, "waiting");
          yield* writeRun(2, "completed");
          yield* settings.updateSettings({ keepAwakeWhileAgentsWork: false });
          assert.isFalse(yield* Queue.take(reports));
          yield* settings.updateSettings({ keepAwakeWhileAgentsWork: true });
          assert.isTrue(yield* Queue.take(reports));

          yield* writeRun(3, "interrupted");
          assert.isFalse(yield* Queue.take(reports));

          yield* writeRun(4, "preparing");
          assert.isTrue(yield* Queue.take(reports));

          // A run waiting on a person does no work, so the computer may sleep.
          yield* writeRun(4, "running");
          yield* writeRequest("approval", "command", "pending");
          assert.isFalse(yield* Queue.take(reports));
          yield* writeRequest("approval", "command", "resolved");
          assert.isTrue(yield* Queue.take(reports));
          // A request the server answers itself is not a wait.
          yield* writeRequest("tool", "dynamic_tool_call", "pending");
          yield* writeRequest("question", "user_input", "pending");
          assert.isFalse(yield* Queue.take(reports));
          yield* writeRequest("question", "user_input", "cancelled");
          assert.isTrue(yield* Queue.take(reports));
          // An async question does not block the run: the agent keeps working.
          yield* writeRequest("async", "user_input", "pending", { type: "message" });
          yield* settings.updateSettings({ keepAwakeWhileAgentsWork: false });
          assert.isFalse(yield* Queue.take(reports));
          yield* settings.updateSettings({ keepAwakeWhileAgentsWork: true });
          assert.isTrue(yield* Queue.take(reports));
          return reports;
        }),
      );
      // Closing the scope stands in for a server shutdown with a run still working.
      assert.isFalse(yield* Queue.take(reports));
      assert.strictEqual(yield* Queue.size(reports), 0);
    }),
  );
});
