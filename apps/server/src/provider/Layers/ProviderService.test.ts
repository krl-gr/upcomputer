// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderTurnStartResult,
} from "@upcomputer/contracts";
import {
  ApprovalRequestId,
  EventId,
  type InteractionModeDescriptor,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionStartInput,
  ThreadId,
  TurnId,
} from "@upcomputer/contracts";
import {
  createExperimentalInteractionModeRegistry,
  type ExperimentalInteractionModeRegistry,
} from "@upcomputer/shared/interactionMode";
import { createModelSelection } from "@upcomputer/shared/model";
import { it, assert, vi } from "@effect/vitest";
import { afterAll } from "vite-plus/test";

import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderUnsupportedError,
  ProviderValidationError,
  ProviderWorkspaceMissingError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterSendTurnInput,
  ProviderAdapterShape,
  ProviderAdapterStartSessionInput,
} from "../Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../Services/ProviderAdapterRegistry.ts";
import * as ProviderService from "../Services/ProviderService.ts";
import * as ProviderSessionDirectory from "../Services/ProviderSessionDirectory.ts";
import { makeProviderServiceLive } from "./ProviderService.ts";
import * as ProviderEventLoggers from "./ProviderEventLoggers.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import * as InteractionModeRegistryService from "../../product/InteractionModeRegistryService.ts";
import { CORE_SERVER_PRODUCT_COMPOSITION } from "../../product/ServerProductComposition.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as AnalyticsService from "../../telemetry/AnalyticsService.ts";
import { makeAdapterRegistryMock } from "../testUtils/providerAdapterRegistryMock.ts";

const defaultServerSettingsLayer = ServerSettings.ServerSettingsService.layerTest();
function makeProviderServiceTestLive(
  options?: Parameters<typeof makeProviderServiceLive>[0],
  interactionModeRegistry: ExperimentalInteractionModeRegistry = CORE_SERVER_PRODUCT_COMPOSITION.interactionModeRegistry,
) {
  return makeProviderServiceLive(options).pipe(
    Layer.provide(NodeServices.layer),
    Layer.provide(InteractionModeRegistryService.layer(interactionModeRegistry)),
  );
}

// startSession verifies the workspace folder exists before dispatching to an
// adapter, so session cwd fixtures must be real directories.
const fixtureCwdRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "provider-service-test-"));
afterAll(() => NodeFS.rmSync(fixtureCwdRoot, { recursive: true, force: true }));
function fixtureCwd(name: string): string {
  const dir = NodePath.join(fixtureCwdRoot, name);
  NodeFS.mkdirSync(dir, { recursive: true });
  return dir;
}

const asRequestId = (value: string): ApprovalRequestId => ApprovalRequestId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const codexInstanceId = ProviderInstanceId.make("codex");
const claudeAgentInstanceId = ProviderInstanceId.make("claudeAgent");
const grokInstanceId = ProviderInstanceId.make("grok");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");
const GROK_DRIVER = ProviderDriverKind.make("grok");

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderDriverKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

function makeFakeCodexAdapter(provider: ProviderDriverKind = CODEX_DRIVER) {
  const sessions = new Map<ThreadId, ProviderSession>();
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());

  const startSession = vi.fn(
    (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, ProviderAdapterError> =>
      Effect.sync(() => {
        const now = "2026-01-01T00:00:00.000Z";
        const session: ProviderSession = {
          provider,
          ...(input.providerInstanceId !== undefined
            ? { providerInstanceId: input.providerInstanceId }
            : {}),
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId: input.threadId,
          resumeCursor: input.resumeCursor ?? {
            opaque: `resume-${String(input.threadId)}`,
          },
          cwd: input.cwd ?? process.cwd(),
          createdAt: now,
          updatedAt: now,
        };
        sessions.set(session.threadId, session);
        return session;
      }),
  );

  const sendTurn = vi.fn(
    (
      input: ProviderAdapterSendTurnInput,
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> => {
      if (!sessions.has(input.threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider,
            threadId: input.threadId,
          }),
        );
      }

      return Effect.succeed({
        threadId: input.threadId,
        turnId: TurnId.make(`turn-${String(input.threadId)}`),
      });
    },
  );

  const interruptTurn = vi.fn(
    (_threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.void,
  );

  const respondToRequest = vi.fn(
    (
      _threadId: ThreadId,
      _requestId: string,
      _decision: ProviderApprovalDecision,
    ): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const respondToUserInput = vi.fn(
    (
      _threadId: ThreadId,
      _requestId: string,
      _answers: Record<string, unknown>,
    ): Effect.Effect<void, ProviderAdapterError> => Effect.void,
  );

  const stopSession = vi.fn(
    (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.delete(threadId);
      }),
  );

  const listSessions = vi.fn(
    (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Effect.sync(() => Array.from(sessions.values())),
  );

  const hasSession = vi.fn(
    (threadId: ThreadId): Effect.Effect<boolean> => Effect.succeed(sessions.has(threadId)),
  );

  const readThread = vi.fn(
    (
      threadId: ThreadId,
    ): Effect.Effect<
      {
        threadId: ThreadId;
        turns: ReadonlyArray<{ id: TurnId; items: readonly [] }>;
      },
      ProviderAdapterError
    > =>
      Effect.succeed({
        threadId,
        turns: [{ id: asTurnId("turn-1"), items: [] }],
      }),
  );

  const rollbackThread = vi.fn(
    (
      threadId: ThreadId,
      _numTurns: number,
    ): Effect.Effect<{ threadId: ThreadId; turns: readonly [] }, ProviderAdapterError> =>
      Effect.succeed({ threadId, turns: [] }),
  );

  const stopAll = vi.fn(
    (): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        sessions.clear();
      }),
  );

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent));
  };

  const updateSession = (
    threadId: ThreadId,
    update: (session: ProviderSession) => ProviderSession,
  ): void => {
    const existing = sessions.get(threadId);
    if (!existing) {
      return;
    }
    sessions.set(threadId, update(existing));
  };

  return {
    adapter,
    emit,
    updateSession,
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
  };
}

const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
) =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );

function makeProviderServiceLayer(options?: {
  readonly interactionModeRegistry?: ExperimentalInteractionModeRegistry;
  readonly directory?: ProviderSessionDirectory.ProviderSessionDirectory["Service"];
}) {
  const analyticsEvents: Array<{
    readonly event: string;
    readonly properties?: Readonly<Record<string, unknown>>;
  }> = [];
  const codex = makeFakeCodexAdapter();
  const claude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
  const cursor = makeFakeCodexAdapter(CURSOR_DRIVER);
  const grok = makeFakeCodexAdapter(GROK_DRIVER);
  const registry = makeAdapterRegistryMock({
    [ProviderDriverKind.make("codex")]: codex.adapter,
    [ProviderDriverKind.make("claudeAgent")]: claude.adapter,
    [ProviderDriverKind.make("cursor")]: cursor.adapter,
    [ProviderDriverKind.make("grok")]: grok.adapter,
  });

  const providerAdapterLayer = Layer.succeed(
    ProviderAdapterRegistry.ProviderAdapterRegistry,
    registry,
  );
  const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
  );
  const directoryLayer =
    options?.directory === undefined
      ? ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer))
      : Layer.succeed(ProviderSessionDirectory.ProviderSessionDirectory, options.directory);

  const layer = it.layer(
    Layer.mergeAll(
      makeProviderServiceTestLive(
        undefined,
        options?.interactionModeRegistry ?? CORE_SERVER_PRODUCT_COMPOSITION.interactionModeRegistry,
      ).pipe(
        Layer.provide(providerAdapterLayer),
        Layer.provide(directoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provideMerge(
          Layer.succeed(
            AnalyticsService.AnalyticsService,
            AnalyticsService.AnalyticsService.of({
              record: (event, properties) =>
                Effect.sync(() => {
                  analyticsEvents.push({ event, ...(properties ? { properties } : {}) });
                }),
              recordProductLaunch: Effect.void,
              enabled: true,
              flush: Effect.void,
            }),
          ),
        ),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      ),
      directoryLayer,

      runtimeRepositoryLayer,
      NodeServices.layer,
    ),
  );

  return {
    codex,
    claude,
    cursor,
    grok,
    analyticsEvents,
    layer,
  };
}

const telemetry = makeProviderServiceLayer();
telemetry.layer("ProviderServiceLive activation telemetry", (it) => {
  it.effect("records readiness and exactly one safe terminal outcome for every tracked turn", () =>
    Effect.gen(function* () {
      telemetry.analyticsEvents.length = 0;
      const provider = yield* ProviderService.ProviderService;

      const start = (threadId: ThreadId) =>
        provider.startSession(threadId, {
          provider: CODEX_DRIVER,
          providerInstanceId: codexInstanceId,
          threadId,
          runtimeMode: "full-access",
        });
      const send = (threadId: ThreadId) =>
        provider.sendTurn({
          threadId,
          input: "private prompt",
          attachments: [],
          interactionMode: "ask",
        });

      const completedThread = asThreadId("thread-telemetry-completed");
      yield* start(completedThread);
      const completedTurn = yield* send(completedThread);
      yield* Effect.yieldNow;
      const completedEvent: LegacyProviderRuntimeEvent = {
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-completed"),
        provider: CODEX_DRIVER,
        threadId: completedThread,
        turnId: completedTurn.turnId,
        createdAt: "2026-01-01T00:00:01.250Z",
        payload: { state: "completed" },
      };
      telemetry.codex.emit(completedEvent);
      telemetry.codex.emit({ ...completedEvent, eventId: asEventId("evt-telemetry-duplicate") });
      yield* Effect.yieldNow;

      const cancelledThread = asThreadId("thread-telemetry-cancelled");
      yield* start(cancelledThread);
      const cancelledTurn = yield* send(cancelledThread);
      telemetry.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-cancelled"),
        provider: CODEX_DRIVER,
        threadId: cancelledThread,
        turnId: cancelledTurn.turnId,
        createdAt: "2026-01-01T00:00:02.000Z",
        payload: { state: "cancelled" },
      });
      yield* Effect.yieldNow;

      const interruptedThread = asThreadId("thread-telemetry-interrupted");
      yield* start(interruptedThread);
      const interruptedTurn = yield* send(interruptedThread);
      yield* provider.interruptTurn({
        threadId: interruptedThread,
        turnId: interruptedTurn.turnId,
      });
      telemetry.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-late-success"),
        provider: CODEX_DRIVER,
        threadId: interruptedThread,
        turnId: interruptedTurn.turnId,
        createdAt: "2026-01-01T00:00:03.000Z",
        payload: { state: "completed" },
      });
      yield* Effect.yieldNow;

      const gracefulExitThread = asThreadId("thread-telemetry-graceful-exit");
      yield* start(gracefulExitThread);
      yield* send(gracefulExitThread);
      telemetry.codex.emit({
        type: "session.exited",
        eventId: asEventId("evt-telemetry-graceful-exit"),
        provider: CODEX_DRIVER,
        threadId: gracefulExitThread,
        createdAt: "2026-01-01T00:00:04.000Z",
        payload: { exitKind: "graceful" },
      });
      yield* Effect.yieldNow;

      const stoppedThread = asThreadId("thread-telemetry-stopped");
      yield* start(stoppedThread);
      const stoppedTurn = yield* send(stoppedThread);
      yield* provider.stopSession({ threadId: stoppedThread });
      telemetry.codex.emit({
        type: "session.exited",
        eventId: asEventId("evt-telemetry-stopped-gracefully"),
        provider: CODEX_DRIVER,
        threadId: stoppedThread,
        createdAt: "2026-01-01T00:00:04.500Z",
        payload: { exitKind: "graceful" },
      });
      telemetry.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-stopped-late-success"),
        provider: CODEX_DRIVER,
        threadId: stoppedThread,
        turnId: stoppedTurn.turnId,
        createdAt: "2026-01-01T00:00:04.600Z",
        payload: { state: "completed" },
      });
      yield* Effect.yieldNow;

      const crashedThread = asThreadId("thread-telemetry-crashed");
      yield* start(crashedThread);
      yield* send(crashedThread);
      telemetry.codex.emit({
        type: "session.exited",
        eventId: asEventId("evt-telemetry-crashed"),
        provider: CODEX_DRIVER,
        threadId: crashedThread,
        createdAt: "2026-01-01T00:00:05.000Z",
        payload: { exitKind: "error" },
      });
      yield* Effect.yieldNow;

      const failedThread = asThreadId("thread-telemetry-provider-failure");
      yield* start(failedThread);
      telemetry.codex.sendTurn.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "sendTurn",
            detail: "private provider failure",
          }),
        ),
      );
      yield* Effect.exit(send(failedThread));

      const completed = telemetry.analyticsEvents.filter(
        ({ event }) => event === "provider.turn.completed",
      );
      const terminated = telemetry.analyticsEvents.filter(
        ({ event }) => event === "provider.turn.terminated",
      );
      assert.equal(completed.length, 1);
      assert.equal(terminated.length, 6);
      assert.deepEqual(terminated.map(({ properties }) => properties?.outcome).toSorted(), [
        "cancelled",
        "cancelled",
        "cancelled",
        "failed",
        "interrupted",
        "provider-crash",
      ]);
      assert.equal(
        [...completed, ...terminated].every(
          ({ properties }) =>
            typeof properties?.durationMs === "number" &&
            typeof properties?.durationBucket === "string" &&
            !("threadId" in (properties ?? {})) &&
            !("turnId" in (properties ?? {})) &&
            !("input" in (properties ?? {})),
        ),
        true,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.readiness.succeeded")
          .length,
        7,
      );
    }),
  );

  it.effect("records completion emitted before sendTurn returns without later cancellation", () =>
    Effect.gen(function* () {
      telemetry.analyticsEvents.length = 0;
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-telemetry-early-completion");
      const turnId = asTurnId("turn-telemetry-early-completion");
      yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      yield* advanceTestClock(50);
      telemetry.codex.sendTurn.mockImplementationOnce((input) =>
        Effect.gen(function* () {
          telemetry.codex.emit({
            type: "turn.started",
            eventId: asEventId("evt-telemetry-early-started"),
            provider: CODEX_DRIVER,
            threadId: input.threadId,
            turnId,
            createdAt: "2026-01-01T00:00:00.000Z",
            payload: {},
          });
          yield* advanceTestClock(1_250);
          telemetry.codex.emit({
            type: "turn.completed",
            eventId: asEventId("evt-telemetry-early-completed"),
            provider: CODEX_DRIVER,
            threadId: input.threadId,
            turnId,
            createdAt: "2026-01-01T00:00:01.250Z",
            payload: { state: "completed" },
          });
          yield* advanceTestClock(50);
          return { threadId: input.threadId, turnId };
        }),
      );

      yield* provider.sendTurn({
        threadId,
        input: "private prompt",
        attachments: [],
        interactionMode: "ask",
      });
      yield* Effect.yieldNow;

      const completed = telemetry.analyticsEvents.filter(
        ({ event }) => event === "provider.turn.completed",
      );
      assert.equal(completed.length, 1);
      assert.equal(completed[0]?.properties?.durationMs, 1_250);
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );

      yield* provider.stopSession({ threadId });
      yield* Effect.yieldNow;
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
        1,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );
    }),
  );

  it.effect("keeps one canonical terminal outcome after successful or failed steering", () =>
    Effect.gen(function* () {
      telemetry.analyticsEvents.length = 0;
      const provider = yield* ProviderService.ProviderService;
      const start = (threadId: ThreadId) =>
        provider.startSession(threadId, {
          provider: CODEX_DRIVER,
          providerInstanceId: codexInstanceId,
          threadId,
          runtimeMode: "full-access",
        });
      const send = (threadId: ThreadId, input: string) =>
        provider.sendTurn({ threadId, input, attachments: [] });
      const emitCompletion = (threadId: ThreadId, turnId: TurnId, eventId: EventId) =>
        telemetry.codex.emit({
          type: "turn.completed",
          eventId,
          provider: CODEX_DRIVER,
          threadId,
          turnId,
          createdAt: "2026-01-01T00:00:02.000Z",
          payload: { state: "completed" },
        });

      const successfulThread = asThreadId("thread-telemetry-successful-steer");
      yield* start(successfulThread);
      yield* Effect.yieldNow;
      const successfulOriginal = yield* send(successfulThread, "private original prompt");
      const successfulSteer = yield* send(successfulThread, "private steering prompt");
      assert.equal(successfulSteer.turnId, successfulOriginal.turnId);
      emitCompletion(
        successfulThread,
        successfulOriginal.turnId,
        asEventId("evt-telemetry-successful-steer-completed"),
      );
      yield* Effect.yieldNow;

      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.submitted").length,
        2,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
        1,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );

      telemetry.analyticsEvents.length = 0;
      const failedThread = asThreadId("thread-telemetry-failed-steer");
      yield* start(failedThread);
      yield* Effect.yieldNow;
      const failedOriginal = yield* send(failedThread, "private original prompt");
      telemetry.codex.sendTurn.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "sendTurn",
            detail: "private steering failure",
          }),
        ),
      );
      const steerExit = yield* Effect.exit(send(failedThread, "private steering prompt"));
      assert.equal(Exit.isFailure(steerExit), true);
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );

      emitCompletion(
        failedThread,
        failedOriginal.turnId,
        asEventId("evt-telemetry-failed-steer-completed"),
      );
      yield* Effect.yieldNow;

      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.submitted").length,
        2,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
        1,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );
    }),
  );

  it.effect("keeps a turn tracked when stopSession fails and accepts one late completion", () =>
    Effect.gen(function* () {
      telemetry.analyticsEvents.length = 0;
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-telemetry-failed-stop");
      yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      const turn = yield* provider.sendTurn({
        threadId,
        input: "private prompt",
        attachments: [],
      });
      telemetry.codex.stopSession.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "stopSession",
            detail: "private stop failure",
          }),
        ),
      );

      const stopExit = yield* Effect.exit(provider.stopSession({ threadId }));
      assert.equal(Exit.isFailure(stopExit), true);
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );

      const completedEvent: LegacyProviderRuntimeEvent = {
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-after-failed-stop"),
        provider: CODEX_DRIVER,
        threadId,
        turnId: turn.turnId,
        createdAt: "2026-01-01T00:00:06.000Z",
        payload: { state: "completed" },
      };
      telemetry.codex.emit(completedEvent);
      telemetry.codex.emit({
        ...completedEvent,
        eventId: asEventId("evt-telemetry-after-failed-stop-2"),
      });
      yield* Effect.yieldNow;

      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
        1,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );
    }),
  );

  it.effect("keeps a stale-provider turn tracked when replacement shutdown fails", () =>
    Effect.gen(function* () {
      telemetry.analyticsEvents.length = 0;
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-telemetry-failed-stale-stop");
      yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      const turn = yield* provider.sendTurn({
        threadId,
        input: "private prompt",
        attachments: [],
      });
      telemetry.codex.stopSession.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "stopSession",
            detail: "private stale stop failure",
          }),
        ),
      );

      yield* provider.startSession(threadId, {
        provider: CLAUDE_AGENT_DRIVER,
        providerInstanceId: claudeAgentInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );

      const completedEvent: LegacyProviderRuntimeEvent = {
        type: "turn.completed",
        eventId: asEventId("evt-telemetry-after-failed-stale-stop"),
        provider: CODEX_DRIVER,
        threadId,
        turnId: turn.turnId,
        createdAt: "2026-01-01T00:00:07.000Z",
        payload: { state: "completed" },
      };
      telemetry.codex.emit(completedEvent);
      telemetry.codex.emit({
        ...completedEvent,
        eventId: asEventId("evt-telemetry-after-failed-stale-stop-2"),
      });
      yield* Effect.yieldNow;

      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
        1,
      );
      assert.equal(
        telemetry.analyticsEvents.filter(({ event }) => event === "provider.turn.terminated")
          .length,
        0,
      );
    }),
  );
});

const STRUCTURED_TEST_INTERACTION_MODE_DESCRIPTOR = {
  id: "orchestrator",
  ownerId: "upcomputer.orchestrator",
  version: 1,
  displayName: "Orchestrator",
  description: "Emit a structured orchestration proposal.",
  intent: "propose",
  safety: {
    mutations: "deny",
    sandbox: "read-only",
    computerUse: "observe-only",
  },
  outputKind: "structured",
  supportedProviders: ["codex"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "plan",
      sandbox: "read-only",
    },
  ],
} satisfies InteractionModeDescriptor;

const structuredTestInteractionModeRegistry = createExperimentalInteractionModeRegistry([
  {
    descriptor: STRUCTURED_TEST_INTERACTION_MODE_DESCRIPTOR,
    parseFinalOutput: (text) => {
      try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
  },
]);

it.effect("ProviderServiceLive retains active turns when stopAll fails", () =>
  Effect.gen(function* () {
    const analyticsEvents: Array<{
      readonly event: string;
      readonly properties?: Readonly<Record<string, unknown>>;
    }> = [];
    const codex = makeFakeCodexAdapter();
    const registry = makeAdapterRegistryMock({
      [CODEX_DRIVER]: codex.adapter,
    });
    const providerAdapterLayer = Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistry,
      registry,
    );
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(SqlitePersistenceMemory),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
    const analyticsLayer = Layer.succeed(
      AnalyticsService.AnalyticsService,
      AnalyticsService.AnalyticsService.of({
        record: (event, properties) =>
          Effect.sync(() => {
            analyticsEvents.push({ event, ...(properties ? { properties } : {}) });
          }),
        recordProductLaunch: Effect.void,
        enabled: true,
        flush: Effect.void,
      }),
    );
    const providerLayer = Layer.mergeAll(
      makeProviderServiceTestLive().pipe(
        Layer.provide(providerAdapterLayer),
        Layer.provide(directoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provideMerge(analyticsLayer),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      ),
      directoryLayer,
      runtimeRepositoryLayer,
      NodeServices.layer,
    );
    const scope = yield* Scope.make();
    const runtimeServices = yield* Layer.build(providerLayer).pipe(Scope.provide(scope));
    const provider = yield* ProviderService.ProviderService.pipe(Effect.provide(runtimeServices));
    const threadId = asThreadId("thread-telemetry-failed-stop-all");
    yield* provider.startSession(threadId, {
      provider: CODEX_DRIVER,
      providerInstanceId: codexInstanceId,
      threadId,
      runtimeMode: "full-access",
    });
    const turn = yield* provider.sendTurn({
      threadId,
      input: "private prompt",
      attachments: [],
    });
    assert.equal(typeof turn.turnId, "string");
    codex.stopAll.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: String(CODEX_DRIVER),
          method: "stopAll",
          detail: "simulated stopAll failure",
        }),
      ),
    );

    const closeExit = yield* Scope.close(scope, Exit.void).pipe(Effect.exit);

    assert.equal(Exit.isSuccess(closeExit), true);
    assert.equal(codex.stopAll.mock.calls.length, 1);
    assert.equal(
      analyticsEvents.filter(({ event }) => event === "provider.turn.completed").length,
      0,
    );
    assert.equal(
      analyticsEvents.filter(({ event }) => event === "provider.turn.terminated").length,
      0,
    );
  }),
);

it.effect("ProviderServiceLive cancels active turns after successful stopAll shutdown", () =>
  Effect.gen(function* () {
    const analyticsEvents: Array<{
      readonly event: string;
      readonly properties?: Readonly<Record<string, unknown>>;
    }> = [];
    const codex = makeFakeCodexAdapter();
    const registry = makeAdapterRegistryMock({
      [CODEX_DRIVER]: codex.adapter,
    });
    const providerAdapterLayer = Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistry,
      registry,
    );
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(SqlitePersistenceMemory),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
    const analyticsLayer = Layer.succeed(
      AnalyticsService.AnalyticsService,
      AnalyticsService.AnalyticsService.of({
        record: (event, properties) =>
          Effect.sync(() => {
            analyticsEvents.push({ event, ...(properties ? { properties } : {}) });
          }),
        recordProductLaunch: Effect.void,
        enabled: true,
        flush: Effect.void,
      }),
    );
    const providerLayer = Layer.mergeAll(
      makeProviderServiceTestLive().pipe(
        Layer.provide(providerAdapterLayer),
        Layer.provide(directoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provideMerge(analyticsLayer),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      ),
      directoryLayer,
      runtimeRepositoryLayer,
      NodeServices.layer,
    );
    const scope = yield* Scope.make();
    const runtimeServices = yield* Layer.build(providerLayer).pipe(Scope.provide(scope));
    const provider = yield* ProviderService.ProviderService.pipe(Effect.provide(runtimeServices));
    const threadId = asThreadId("thread-telemetry-stop-all");

    yield* provider.startSession(threadId, {
      provider: CODEX_DRIVER,
      providerInstanceId: codexInstanceId,
      threadId,
      runtimeMode: "full-access",
    });
    yield* provider.sendTurn({
      threadId,
      input: "private prompt",
      attachments: [],
      interactionMode: "ask",
    });
    yield* Scope.close(scope, Exit.void);

    const terminalEvents = analyticsEvents.filter(
      ({ event }) => event === "provider.turn.terminated",
    );
    assert.equal(codex.stopAll.mock.calls.length, 1);
    assert.equal(terminalEvents.length, 1);
    assert.equal(terminalEvents[0]?.properties?.outcome, "cancelled");
    assert.equal(terminalEvents[0]?.properties?.errorCategory, "cancelled");
  }),
);

it.effect("ProviderServiceLive rejects new sessions for disabled providers", () =>
  Effect.gen(function* () {
    const codex = makeFakeCodexAdapter();
    const claude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
    const registryBase = makeAdapterRegistryMock({
      [CODEX_DRIVER]: codex.adapter,
      [CLAUDE_AGENT_DRIVER]: claude.adapter,
    });
    const registry: ProviderAdapterRegistry.ProviderAdapterRegistry["Service"] = {
      ...registryBase,
      getInstanceInfo: (instanceId) =>
        instanceId === claudeAgentInstanceId
          ? Effect.succeed({
              instanceId,
              driverKind: CLAUDE_AGENT_DRIVER,
              displayName: undefined,
              enabled: false,
              continuationIdentity: {
                driverKind: CLAUDE_AGENT_DRIVER,
                continuationKey: "claudeAgent:instance:claudeAgent",
              },
            })
          : registryBase.getInstanceInfo(instanceId),
    };
    const providerAdapterLayer = Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistry,
      registry,
    );
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(SqlitePersistenceMemory),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
    const providerLayer = makeProviderServiceTestLive().pipe(
      Layer.provide(providerAdapterLayer),
      Layer.provide(directoryLayer),
      Layer.provide(defaultServerSettingsLayer),
      Layer.provide(AnalyticsService.layerTest),
      Layer.provide(
        Layer.succeed(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      ),
    );

    const failure = yield* Effect.flip(
      Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        return yield* provider.startSession(asThreadId("thread-disabled"), {
          provider: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: claudeAgentInstanceId,
          threadId: asThreadId("thread-disabled"),
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(providerLayer)),
    );

    assert.instanceOf(failure, ProviderValidationError);
    assert.include(failure.issue, "Provider instance 'claudeAgent' is disabled");
    assert.equal(claude.startSession.mock.calls.length, 0);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "ProviderServiceLive allows enabled custom instances when legacy driver is disabled",
  () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_personal");
      const driverKind = CODEX_DRIVER;
      const codex = makeFakeCodexAdapter();
      const unsupported = () =>
        new ProviderUnsupportedError({
          provider: driverKind,
        });
      const registry: ProviderAdapterRegistry.ProviderAdapterRegistry["Service"] = {
        getByInstance: (requestedInstanceId) =>
          requestedInstanceId === instanceId
            ? Effect.succeed(codex.adapter)
            : Effect.fail(unsupported()),
        getInstanceInfo: (requestedInstanceId) =>
          requestedInstanceId === instanceId
            ? Effect.succeed({
                instanceId,
                driverKind,
                displayName: "Codex Personal",
                enabled: true,
                continuationIdentity: {
                  driverKind,
                  continuationKey: "codex:/Users/example/.codex",
                },
              })
            : Effect.fail(unsupported()),
        listInstances: () => Effect.succeed([instanceId]),
        listProviders: () => Effect.succeed([driverKind] as const),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
          PubSub.subscribe(pubsub),
        ),
      };
      const providerAdapterLayer = Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistry,
        registry,
      );
      const serverSettingsLayer = ServerSettings.ServerSettingsService.layerTest({
        providers: {
          codex: {
            enabled: false,
          },
        },
      });
      const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
        Layer.provide(SqlitePersistenceMemory),
      );
      const directoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const providerLayer = makeProviderServiceTestLive().pipe(
        Layer.provide(providerAdapterLayer),
        Layer.provide(directoryLayer),
        Layer.provide(serverSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );

      const session = yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        return yield* provider.startSession(asThreadId("thread-enabled-custom"), {
          provider: driverKind,
          providerInstanceId: instanceId,
          threadId: asThreadId("thread-enabled-custom"),
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(providerLayer));

      assert.equal(session.providerInstanceId, instanceId);
      assert.equal(codex.startSession.mock.calls.length, 1);
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("ProviderServiceLive rejects new sessions for disabled custom instances", () =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("codex_personal");
    const driverKind = ProviderDriverKind.make("codex");
    const codex = makeFakeCodexAdapter();
    const unsupported = () =>
      new ProviderUnsupportedError({
        provider: ProviderDriverKind.make("codex"),
      });
    const registry: ProviderAdapterRegistry.ProviderAdapterRegistry["Service"] = {
      getByInstance: (requestedInstanceId) =>
        requestedInstanceId === instanceId
          ? Effect.succeed(codex.adapter)
          : Effect.fail(unsupported()),
      getInstanceInfo: (requestedInstanceId) =>
        requestedInstanceId === instanceId
          ? Effect.succeed({
              instanceId,
              driverKind,
              displayName: "Codex Personal",
              enabled: false,
              continuationIdentity: {
                driverKind,
                continuationKey: "codex:/Users/example/.codex",
              },
            })
          : Effect.fail(unsupported()),
      listInstances: () => Effect.succeed([instanceId]),
      listProviders: () => Effect.succeed([CODEX_DRIVER] as const),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
        PubSub.subscribe(pubsub),
      ),
    };
    const providerAdapterLayer = Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistry,
      registry,
    );
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(SqlitePersistenceMemory),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
    const providerLayer = makeProviderServiceTestLive().pipe(
      Layer.provide(providerAdapterLayer),
      Layer.provide(directoryLayer),
      Layer.provide(defaultServerSettingsLayer),
      Layer.provide(AnalyticsService.layerTest),
      Layer.provide(
        Layer.succeed(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      ),
    );

    const failure = yield* Effect.flip(
      Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        return yield* provider.startSession(asThreadId("thread-disabled-instance"), {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId: asThreadId("thread-disabled-instance"),
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(providerLayer)),
    );

    assert.instanceOf(failure, ProviderValidationError);
    assert.include(failure.issue, "Provider instance 'codex_personal' is disabled");
    assert.equal(codex.startSession.mock.calls.length, 0);
  }).pipe(Effect.provide(NodeServices.layer)),
);

const routing = makeProviderServiceLayer();

it.effect("ProviderServiceLive writes canonical events to the emitting thread segment", () =>
  Effect.gen(function* () {
    const codex = makeFakeCodexAdapter();
    const canonicalEvents: ProviderRuntimeEvent[] = [];
    const canonicalThreadIds: Array<string | null> = [];
    const registry = makeAdapterRegistryMock({
      [ProviderDriverKind.make("codex")]: codex.adapter,
    });
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(SqlitePersistenceMemory),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
    const providerLayer = makeProviderServiceTestLive({
      canonicalEventLogger: {
        filePath: "memory://provider-canonical-events",
        write: (event, threadId) => {
          canonicalEvents.push(event as ProviderRuntimeEvent);
          canonicalThreadIds.push(threadId ?? null);
          return Effect.void;
        },
        close: () => Effect.void,
      },
    }).pipe(
      Layer.provide(Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, registry)),
      Layer.provide(directoryLayer),
      Layer.provide(defaultServerSettingsLayer),
      Layer.provide(AnalyticsService.layerTest),
      Layer.provide(
        Layer.succeed(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      ),
    );

    yield* Effect.gen(function* () {
      yield* ProviderService.ProviderService;
      yield* advanceTestClock(10);
      codex.emit({
        eventId: asEventId("evt-canonical-thread-segment"),
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-canonical-thread-segment"),
        createdAt: "2026-01-01T00:00:00.000Z",
        type: "turn.completed",
        payload: {
          state: "completed",
        },
      });
      yield* advanceTestClock(20);
    }).pipe(Effect.provide(providerLayer));

    assert.equal(canonicalEvents.length, 1);
    assert.equal(canonicalEvents[0]?.threadId, "thread-canonical-thread-segment");
    assert.deepEqual(canonicalThreadIds, ["thread-canonical-thread-segment"]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("ProviderServiceLive keeps persisted resumable sessions on startup", () =>
  Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-provider-service-"));
    const dbPath = NodePath.join(tempDir, "orchestration.sqlite");

    const codex = makeFakeCodexAdapter();
    const registry = makeAdapterRegistryMock({
      [ProviderDriverKind.make("codex")]: codex.adapter,
    });

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(persistenceLayer),
    );
    const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));

    yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      yield* directory.upsert({
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: ThreadId.make("thread-stale"),
      });
    }).pipe(Effect.provide(directoryLayer));

    const providerLayer = makeProviderServiceTestLive().pipe(
      Layer.provide(Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, registry)),
      Layer.provide(directoryLayer),
      Layer.provide(defaultServerSettingsLayer),
      Layer.provide(AnalyticsService.layerTest),
      Layer.provide(
        Layer.succeed(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      ),
    );

    yield* ProviderService.ProviderService.pipe(Effect.provide(providerLayer));

    const persistedProvider = yield* Effect.gen(function* () {
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      return yield* directory.getProvider(asThreadId("thread-stale"));
    }).pipe(Effect.provide(directoryLayer));
    assert.equal(persistedProvider, "codex");

    const runtime = yield* Effect.gen(function* () {
      const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      return yield* repository.getByThreadId({
        threadId: asThreadId("thread-stale"),
      });
    }).pipe(Effect.provide(runtimeRepositoryLayer));
    assert.equal(Option.isSome(runtime), true);

    const legacyTableRows = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'provider_sessions'
      `;
    }).pipe(Effect.provide(persistenceLayer));
    assert.equal(legacyTableRows.length, 0);

    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "ProviderServiceLive restores rollback routing after restart using persisted thread mapping",
  () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-provider-service-restart-"),
      );
      const dbPath = NodePath.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
        Layer.provide(persistenceLayer),
      );

      const firstCodex = makeFakeCodexAdapter();
      const firstRegistry = makeAdapterRegistryMock({
        [ProviderDriverKind.make("codex")]: firstCodex.adapter,
      });

      const firstDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const firstProviderLayer = makeProviderServiceTestLive().pipe(
        Layer.provide(
          Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, firstRegistry),
        ),
        Layer.provide(firstDirectoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );
      const updatedResumeCursor = {
        threadId: asThreadId("thread-1"),
        resume: "resume-session-1",
        resumeSessionAt: "assistant-message-1",
        turnCount: 1,
      };

      const startedSession = yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        const threadId = asThreadId("thread-1");
        const session = yield* provider.startSession(threadId, {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: fixtureCwd("project"),
          runtimeMode: "full-access",
          threadId,
        });
        firstCodex.updateSession(threadId, (existing) => ({
          ...existing,
          status: "ready",
          resumeCursor: updatedResumeCursor,
          updatedAt: "2026-01-01T00:00:01.000Z",
        }));
        return session;
      }).pipe(Effect.provide(firstProviderLayer));

      const persistedAfterStopAll = yield* Effect.gen(function* () {
        const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
        return yield* repository.getByThreadId({
          threadId: startedSession.threadId,
        });
      }).pipe(Effect.provide(runtimeRepositoryLayer));
      assert.equal(Option.isSome(persistedAfterStopAll), true);
      if (Option.isSome(persistedAfterStopAll)) {
        assert.equal(persistedAfterStopAll.value.status, "stopped");
        assert.deepEqual(persistedAfterStopAll.value.resumeCursor, updatedResumeCursor);
      }

      const secondCodex = makeFakeCodexAdapter();
      const secondRegistry = makeAdapterRegistryMock({
        [ProviderDriverKind.make("codex")]: secondCodex.adapter,
      });
      const secondDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const secondProviderLayer = makeProviderServiceTestLive().pipe(
        Layer.provide(
          Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, secondRegistry),
        ),
        Layer.provide(secondDirectoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );

      secondCodex.startSession.mockClear();
      secondCodex.rollbackThread.mockClear();

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        yield* provider.rollbackConversation({
          threadId: startedSession.threadId,
          numTurns: 1,
        });
      }).pipe(Effect.provide(secondProviderLayer));

      assert.equal(secondCodex.startSession.mock.calls.length, 1);
      const resumedStartInput = secondCodex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, fixtureCwd("project"));
        assert.deepEqual(startPayload.resumeCursor, updatedResumeCursor);
        assert.equal(startPayload.threadId, startedSession.threadId);
      }
      assert.equal(secondCodex.rollbackThread.mock.calls.length, 1);
      const rollbackCall = secondCodex.rollbackThread.mock.calls[0];
      assert.equal(typeof rollbackCall?.[0], "string");
      assert.equal(rollbackCall?.[1], 1);

      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("ProviderServiceLive passes custom instructions to session starts and recovery", () =>
  Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-provider-service-custom-instructions-"),
    );
    const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
      Layer.provide(makeSqlitePersistenceLive(NodePath.join(tempDir, "orchestration.sqlite"))),
    );
    const makeLayer = (
      codex: ReturnType<typeof makeFakeCodexAdapter>,
      serverSettingsLayer: typeof defaultServerSettingsLayer,
    ) =>
      makeProviderServiceTestLive().pipe(
        Layer.provide(
          Layer.succeed(
            ProviderAdapterRegistry.ProviderAdapterRegistry,
            makeAdapterRegistryMock({ [CODEX_DRIVER]: codex.adapter }),
          ),
        ),
        Layer.provide(ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer))),
        Layer.provide(serverSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );
    const startInputAt = (codex: ReturnType<typeof makeFakeCodexAdapter>, index: number) =>
      codex.startSession.mock.calls[index]?.[0] as ProviderAdapterStartSessionInput | undefined;
    const threadId = asThreadId("thread-custom-instructions");

    const firstCodex = makeFakeCodexAdapter();
    yield* Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        cwd: fixtureCwd("custom-instructions"),
        runtimeMode: "full-access",
        threadId,
      });
      firstCodex.updateSession(threadId, (existing) => ({
        ...existing,
        resumeCursor: { resume: "resume-custom-instructions" },
      }));
    }).pipe(Effect.provide(makeLayer(firstCodex, defaultServerSettingsLayer)));
    // Empty settings leave the adapter input exactly as before.
    assert.equal(Object.hasOwn(startInputAt(firstCodex, 0) ?? {}, "customInstructions"), false);

    const secondCodex = makeFakeCodexAdapter();
    yield* Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      yield* provider.rollbackConversation({ threadId, numTurns: 1 });
    }).pipe(
      Effect.provide(
        makeLayer(
          secondCodex,
          ServerSettings.ServerSettingsService.layerTest({
            customInstructions: "Answer in Russian.",
          }),
        ),
      ),
    );
    assert.equal(startInputAt(secondCodex, 0)?.customInstructions, "Answer in Russian.");
    assert.deepEqual(startInputAt(secondCodex, 0)?.resumeCursor, {
      resume: "resume-custom-instructions",
    });

    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }).pipe(Effect.provide(NodeServices.layer)),
);

routing.layer("ProviderServiceLive routing", (it) => {
  it.effect.each([CODEX_DRIVER, CLAUDE_AGENT_DRIVER, CURSOR_DRIVER])(
    "rejects missing, file, and saved workspace paths before starting %s",
    (driver) =>
      Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        const adapter =
          driver === CODEX_DRIVER
            ? routing.codex
            : driver === CLAUDE_AGENT_DRIVER
              ? routing.claude
              : routing.cursor;
        const cwd = fixtureCwd(`missing-workspace-${driver}`);
        const movedCwd = `${cwd}-moved`;
        const threadId = asThreadId(`missing-workspace-${driver}`);
        const input = {
          provider: driver,
          providerInstanceId: ProviderInstanceId.make(driver),
          threadId,
          runtimeMode: "full-access" as const,
          cwd,
        };

        yield* provider.startSession(threadId, input);
        yield* provider.stopSession({ threadId });
        adapter.startSession.mockClear();
        NodeFS.renameSync(cwd, movedCwd);

        const failure = yield* provider.startSession(threadId, input).pipe(Effect.flip);
        assert.instanceOf(failure, ProviderWorkspaceMissingError);
        assert.include(failure.message, cwd);
        assert.equal(adapter.startSession.mock.calls.length, 0);

        const { cwd: _cwd, ...savedInput } = input;
        const savedFailure = yield* provider.startSession(threadId, savedInput).pipe(Effect.flip);
        assert.instanceOf(savedFailure, ProviderWorkspaceMissingError);
        assert.include(savedFailure.message, cwd);
        assert.equal(adapter.startSession.mock.calls.length, 0);

        NodeFS.writeFileSync(cwd, "not a directory");
        const fileFailure = yield* provider.startSession(threadId, input).pipe(Effect.flip);
        assert.instanceOf(fileFailure, ProviderWorkspaceMissingError);
        assert.include(fileFailure.message, cwd);
        assert.equal(adapter.startSession.mock.calls.length, 0);

        NodeFS.unlinkSync(cwd);
        NodeFS.renameSync(movedCwd, cwd);
        const restored = yield* provider.startSession(threadId, savedInput);
        assert.equal(restored.cwd, cwd);
        assert.equal(adapter.startSession.mock.calls.length, 1);
        yield* provider.stopSession({ threadId });
        adapter.startSession.mockClear();
        adapter.stopSession.mockClear();
      }),
  );

  it.effect("routes provider operations and rollback conversation", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const modelSelection = createModelSelection(codexInstanceId, "gpt-5.6-sol", [
        { id: "reasoningEffort", value: "high" },
      ]);

      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        cwd: fixtureCwd("project"),
        runtimeMode: "full-access",
      });
      assert.equal(session.provider, "codex");

      const sessions = yield* provider.listSessions();
      assert.equal(sessions.length, 1);

      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
        modelSelection,
      });
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);

      yield* provider.interruptTurn({ threadId: session.threadId });
      assert.deepEqual(routing.codex.interruptTurn.mock.calls, [[session.threadId, undefined]]);

      yield* provider.respondToRequest({
        threadId: session.threadId,
        requestId: asRequestId("req-1"),
        decision: "accept",
      });
      assert.deepEqual(routing.codex.respondToRequest.mock.calls, [
        [session.threadId, asRequestId("req-1"), "accept"],
      ]);

      yield* provider.respondToUserInput({
        threadId: session.threadId,
        requestId: asRequestId("req-user-input-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
      });
      assert.deepEqual(routing.codex.respondToUserInput.mock.calls, [
        [
          session.threadId,
          asRequestId("req-user-input-1"),
          {
            sandbox_mode: "workspace-write",
          },
        ],
      ]);

      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 0,
      });

      const rewindCursor = { threadId: "rewound-provider-thread" };
      routing.codex.updateSession(session.threadId, (session) => ({
        ...session,
        resumeCursor: rewindCursor,
      }));
      yield* provider.rollbackConversation({ threadId: session.threadId, numTurns: 1 });
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      const rewoundBinding = yield* directory.getBinding(session.threadId);
      assert(Option.isSome(rewoundBinding));
      assert.deepEqual(rewoundBinding.value.resumeCursor, rewindCursor);
      assert.deepEqual(
        (rewoundBinding.value.runtimePayload as { modelSelection?: unknown }).modelSelection,
        modelSelection,
      );

      yield* provider.stopSession({ threadId: session.threadId });
      routing.codex.startSession.mockClear();
      routing.codex.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "after-stop",
        attachments: [],
      });

      assert.equal(routing.codex.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.codex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
          modelSelection?: unknown;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, fixtureCwd("project"));
        assert.deepEqual(startPayload.resumeCursor, rewindCursor);
        assert.deepEqual(startPayload.modelSelection, modelSelection);
        assert.equal(startPayload.threadId, session.threadId);
      }
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);
    }),
  );

  it.effect("preserves background turn boundaries when stopping before rollback recovery", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-background-rewind");
      const initial = yield* provider.startSession(threadId, {
        provider: CLAUDE_AGENT_DRIVER,
        providerInstanceId: claudeAgentInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      const cursor = {
        resume: "550e8400-e29b-41d4-a716-446655440010",
        turnCount: 2,
        turnStartMessageIds: ["user-prompt", "background-assistant"],
      };
      routing.claude.updateSession(threadId, (session) => ({ ...session, resumeCursor: cursor }));
      const completed = yield* provider.streamEvents.pipe(
        Stream.filter((event) => event.eventId === "evt-background-rewind"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      routing.claude.emit({
        type: "turn.completed",
        eventId: asEventId("evt-background-rewind"),
        provider: CLAUDE_AGENT_DRIVER,
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId,
        turnId: asTurnId("background-turn"),
        payload: { state: "completed" },
      });
      yield* Fiber.join(completed);
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      const binding = yield* directory.getBinding(threadId);
      assert(Option.isSome(binding));
      assert.deepEqual(binding.value.resumeCursor, cursor);
      yield* provider.stopSession({ threadId });
      routing.claude.startSession.mockClear();
      yield* provider.rollbackConversation({ threadId, numTurns: 1 });
      assert.deepEqual(routing.claude.startSession.mock.calls[0]?.[0].resumeCursor, cursor);

      const replacement = yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      routing.claude.listSessions.mockReturnValueOnce(
        Effect.succeed([{ ...initial, resumeCursor: cursor }]),
      );
      const staleCompleted = yield* provider.streamEvents.pipe(
        Stream.filter((event) => event.eventId === "evt-stale-background-rewind"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      routing.claude.emit({
        type: "turn.completed",
        eventId: asEventId("evt-stale-background-rewind"),
        provider: CLAUDE_AGENT_DRIVER,
        createdAt: "2026-01-01T00:00:01.000Z",
        threadId,
        turnId: asTurnId("old-background-turn"),
        payload: { state: "completed" },
      });
      yield* Fiber.join(staleCompleted);
      const replacementBinding = yield* directory.getBinding(threadId);
      assert(Option.isSome(replacementBinding));
      assert.equal(replacementBinding.value.providerInstanceId, codexInstanceId);
      assert.deepEqual(replacementBinding.value.resumeCursor, replacement.resumeCursor);
      yield* provider.stopSession({ threadId });
      routing.codex.startSession.mockClear();
      routing.codex.stopSession.mockClear();
      routing.claude.startSession.mockClear();
      routing.claude.stopSession.mockClear();
    }),
  );

  it.effect("recovers stale persisted sessions for rollback by resuming thread identity", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const initial = yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        cwd: fixtureCwd("project"),
        runtimeMode: "full-access",
      });
      yield* routing.codex.stopSession(initial.threadId);
      routing.codex.startSession.mockClear();
      routing.codex.rollbackThread.mockClear();

      yield* provider.rollbackConversation({
        threadId: initial.threadId,
        numTurns: 1,
      });

      assert.equal(routing.codex.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.codex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, fixtureCwd("project"));
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.codex.rollbackThread.mock.calls.length, 1);
      const rollbackCall = routing.codex.rollbackThread.mock.calls[0];
      assert.equal(rollbackCall?.[1], 1);
    }),
  );

  it.effect("preserves the persisted binding when stopping a session", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;

      const initial = yield* provider.startSession(asThreadId("thread-reap-preserve"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-reap-preserve"),
        cwd: fixtureCwd("project-reap-preserve"),
        runtimeMode: "full-access",
      });

      yield* provider.stopSession({ threadId: initial.threadId });

      const persistedAfterStop = yield* runtimeRepository.getByThreadId({
        threadId: initial.threadId,
      });
      assert.equal(Option.isSome(persistedAfterStop), true);
      if (Option.isSome(persistedAfterStop)) {
        assert.equal(persistedAfterStop.value.status, "stopped");
        assert.deepEqual(persistedAfterStop.value.resumeCursor, initial.resumeCursor);
      }

      routing.codex.startSession.mockClear();
      routing.codex.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume after reap",
        attachments: [],
      });

      assert.equal(routing.codex.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.codex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, fixtureCwd("project-reap-preserve"));
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);
    }),
  );

  it.effect("routes explicit claudeAgent provider session starts to the claude adapter", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const session = yield* provider.startSession(asThreadId("thread-claude"), {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: claudeAgentInstanceId,
        threadId: asThreadId("thread-claude"),
        cwd: fixtureCwd("project-claude"),
        runtimeMode: "full-access",
      });

      assert.equal(session.provider, "claudeAgent");
      assert.equal(routing.claude.startSession.mock.calls.length, 1);
      const startInput = routing.claude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof startInput === "object" && startInput !== null, true);
      if (startInput && typeof startInput === "object") {
        const startPayload = startInput as {
          provider?: string;
          providerInstanceId?: ProviderInstanceId;
          cwd?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.providerInstanceId, claudeAgentInstanceId);
        assert.equal(startPayload.cwd, fixtureCwd("project-claude"));
      }
    }),
  );

  it.effect("dies when an active session conflicts with its persisted binding", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      const threadId = asThreadId("thread-binding-mismatch");

      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        cwd: fixtureCwd("project-binding-mismatch"),
        runtimeMode: "full-access",
      });
      yield* directory.upsert({
        threadId,
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: claudeAgentInstanceId,
        runtimeMode: "full-access",
      });

      const exit = yield* Effect.exit(provider.listSessions());
      assert.equal(Exit.hasDies(exit), true);
      yield* directory.upsert({
        threadId,
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        runtimeMode: "full-access",
      });
    }),
  );

  it.effect("stops stale sessions in other providers after a successful replacement start", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-provider-replacement");

      const codexSession = yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        cwd: fixtureCwd("project-provider-replacement"),
        runtimeMode: "full-access",
      });

      routing.codex.stopSession.mockClear();
      routing.claude.stopSession.mockClear();

      const claudeSession = yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: claudeAgentInstanceId,
        threadId,
        cwd: fixtureCwd("project-provider-replacement"),
        runtimeMode: "full-access",
      });

      assert.equal(codexSession.provider, "codex");
      assert.equal(claudeSession.provider, "claudeAgent");
      assert.deepEqual(routing.codex.stopSession.mock.calls, [[threadId]]);
      assert.equal(routing.claude.stopSession.mock.calls.length, 0);

      const sessions = yield* provider.listSessions();
      assert.deepEqual(
        sessions
          .filter((session) => session.threadId === threadId)
          .map((session) => session.provider),
        ["claudeAgent"],
      );
    }),
  );

  it.effect("recovers stale sessions for sendTurn using persisted cwd", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const initial = yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        cwd: fixtureCwd("project-send-turn"),
        runtimeMode: "full-access",
      });

      yield* routing.codex.stopAll();
      routing.codex.startSession.mockClear();
      routing.codex.sendTurn.mockClear();
      routing.analyticsEvents.length = 0;

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume",
        attachments: [],
      });

      assert.equal(routing.codex.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.codex.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "codex");
        assert.equal(startPayload.cwd, fixtureCwd("project-send-turn"));
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.codex.sendTurn.mock.calls.length, 1);
      assert.equal(
        routing.analyticsEvents.filter(
          ({ event, properties }) =>
            event === "provider.readiness.succeeded" &&
            properties?.readinessBoundary === "session-recovery",
        ).length,
        1,
      );
    }),
  );

  it.effect("recovers stale sessions with the persisted additional directories", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const additionalDirectories = [fixtureCwd("linked-docs"), fixtureCwd("linked-api")];

      const initial = yield* provider.startSession(asThreadId("thread-linked-dirs"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-linked-dirs"),
        cwd: fixtureCwd("project-linked-dirs"),
        additionalDirectories,
        runtimeMode: "auto-accept-edits",
      });
      assert.deepEqual(
        routing.codex.startSession.mock.calls.at(-1)?.[0]?.additionalDirectories,
        additionalDirectories,
      );

      yield* routing.codex.stopAll();
      routing.codex.startSession.mockClear();

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume",
        attachments: [],
      });

      assert.equal(routing.codex.startSession.mock.calls.length, 1);
      assert.deepEqual(
        routing.codex.startSession.mock.calls[0]?.[0]?.additionalDirectories,
        additionalDirectories,
      );
    }),
  );

  it.effect("records readiness failure when a stale session cannot be recovered", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-recovery-readiness-failure");
      yield* provider.startSession(threadId, {
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId,
        cwd: fixtureCwd("project-recovery-readiness-failure"),
        runtimeMode: "full-access",
      });
      yield* routing.codex.stopAll();
      routing.analyticsEvents.length = 0;
      routing.codex.startSession.mockImplementationOnce(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "startSession",
            detail: "private recovery failure",
          }),
        ),
      );

      const sendExit = yield* Effect.exit(
        provider.sendTurn({
          threadId,
          input: "resume",
          attachments: [],
        }),
      );

      assert.equal(Exit.isFailure(sendExit), true);
      assert.equal(
        routing.analyticsEvents.filter(
          ({ event, properties }) =>
            event === "provider.readiness.failed" &&
            properties?.readinessBoundary === "session-recovery",
        ).length,
        1,
      );
      assert.equal(
        routing.analyticsEvents.filter(({ event }) => event === "provider.readiness.succeeded")
          .length,
        0,
      );
    }),
  );

  it.effect("recovers stale claudeAgent sessions for sendTurn using persisted cwd", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const initial = yield* provider.startSession(asThreadId("thread-claude-send-turn"), {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: claudeAgentInstanceId,
        threadId: asThreadId("thread-claude-send-turn"),
        cwd: fixtureCwd("project-claude-send-turn"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-opus-4-6",
          [{ id: "effort", value: "max" }],
        ),
        runtimeMode: "full-access",
      });

      yield* routing.claude.stopAll();
      routing.claude.startSession.mockClear();
      routing.claude.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId: initial.threadId,
        input: "resume with claude",
        attachments: [],
      });

      assert.equal(routing.claude.startSession.mock.calls.length, 1);
      const resumedStartInput = routing.claude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          modelSelection?: unknown;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.cwd, fixtureCwd("project-claude-send-turn"));
        assert.deepEqual(
          startPayload.modelSelection,
          createModelSelection(ProviderInstanceId.make("claudeAgent"), "claude-opus-4-6", [
            { id: "effort", value: "max" },
          ]),
        );
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }
      assert.equal(routing.claude.sendTurn.mock.calls.length, 1);
    }),
  );

  it.effect("lists no sessions after adapter runtime clears", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });
      yield* provider.startSession(asThreadId("thread-2"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-2"),
        runtimeMode: "full-access",
      });

      yield* routing.codex.stopAll();
      yield* routing.claude.stopAll();

      const remaining = yield* provider.listSessions();
      assert.equal(remaining.length, 0);
    }),
  );

  it.effect("persists runtime status transitions in provider_session_runtime", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;

      const threadId = asThreadId("thread-runtime-status");
      const session = yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      const runningRuntime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      });
      assert.equal(Option.isSome(runningRuntime), true);
      if (Option.isSome(runningRuntime)) {
        assert.equal(runningRuntime.value.status, "running");
        assert.deepEqual(runningRuntime.value.resumeCursor, session.resumeCursor);
        const payload = runningRuntime.value.runtimePayload;
        assert.equal(payload !== null && typeof payload === "object", true);
        if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
          const runtimePayload = payload as {
            cwd: string;
            model: string | null;
            activeTurnId: string | null;
            lastError: string | null;
            lastRuntimeEvent: string | null;
          };
          assert.equal(runtimePayload.cwd, session.cwd);
          assert.equal(runtimePayload.model, null);
          assert.equal(runtimePayload.activeTurnId, `turn-${String(session.threadId)}`);
          assert.equal(runtimePayload.lastError, null);
          assert.equal(runtimePayload.lastRuntimeEvent, "provider.sendTurn");
        }
      }
    }),
  );

  it.effect("does not persist running after a concurrent send is interrupted", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      const sendStarted = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      routing.codex.sendTurn.mockImplementationOnce(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(sendStarted, undefined);
          yield* Deferred.await(interrupted);
          return yield* Effect.interrupt;
        }),
      );
      routing.codex.interruptTurn.mockImplementationOnce(() =>
        Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
      );

      const threadId = asThreadId("thread-interrupted-send-directory");
      const session = yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      const sendExitFiber = yield* provider
        .sendTurn({
          threadId: session.threadId,
          input: "hold this prompt",
          attachments: [],
        })
        .pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(sendStarted);
      yield* provider.interruptTurn({ threadId: session.threadId });
      const sendExit = yield* Fiber.join(sendExitFiber);

      assert.equal(Exit.isFailure(sendExit), true);
      if (Exit.isFailure(sendExit)) {
        assert.equal(Cause.hasInterruptsOnly(sendExit.cause), true);
      }
      const persisted = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      });
      assert.equal(Option.isSome(persisted), true);
      if (Option.isSome(persisted)) {
        // The directory folds both adapter "ready" and "running" into its
        // runtime "running" state. The payload proves sendTurn did not upsert.
        assert.equal(persisted.value.status, "running");
        const payload = persisted.value.runtimePayload;
        assert.equal(payload !== null && typeof payload === "object", true);
        if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
          const runtimePayload = payload as {
            activeTurnId?: string | null;
            lastRuntimeEvent?: string | null;
          };
          assert.equal(runtimePayload.activeTurnId ?? null, null);
          assert.notEqual(runtimePayload.lastRuntimeEvent, "provider.sendTurn");
        }
      }
    }),
  );

  it.effect("reuses persisted resume cursor when startSession is called after a restart", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-provider-service-start-"),
      );
      const dbPath = NodePath.join(tempDir, "orchestration.sqlite");
      const persistenceLayer = makeSqlitePersistenceLive(dbPath);
      const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
        Layer.provide(persistenceLayer),
      );

      const firstClaude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
      const firstRegistry = makeAdapterRegistryMock({
        [ProviderDriverKind.make("claudeAgent")]: firstClaude.adapter,
      });
      const firstDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const firstProviderLayer = makeProviderServiceTestLive().pipe(
        Layer.provide(
          Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, firstRegistry),
        ),
        Layer.provide(firstDirectoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );

      const initial = yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        return yield* provider.startSession(asThreadId("thread-claude-start"), {
          provider: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: claudeAgentInstanceId,
          threadId: asThreadId("thread-claude-start"),
          cwd: fixtureCwd("project-claude-start"),
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(firstProviderLayer));

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        yield* provider.listSessions();
      }).pipe(Effect.provide(firstProviderLayer));

      const secondClaude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
      const secondRegistry = makeAdapterRegistryMock({
        [ProviderDriverKind.make("claudeAgent")]: secondClaude.adapter,
      });
      const secondDirectoryLayer = ProviderSessionDirectoryLive.pipe(
        Layer.provide(runtimeRepositoryLayer),
      );
      const secondProviderLayer = makeProviderServiceTestLive().pipe(
        Layer.provide(
          Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, secondRegistry),
        ),
        Layer.provide(secondDirectoryLayer),
        Layer.provide(defaultServerSettingsLayer),
        Layer.provide(AnalyticsService.layerTest),
        Layer.provide(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
      );

      secondClaude.startSession.mockClear();

      yield* Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;
        yield* provider.startSession(initial.threadId, {
          provider: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: claudeAgentInstanceId,
          threadId: initial.threadId,
          cwd: fixtureCwd("project-claude-start"),
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(secondProviderLayer));

      assert.equal(secondClaude.startSession.mock.calls.length, 1);
      const resumedStartInput = secondClaude.startSession.mock.calls[0]?.[0];
      assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
      if (resumedStartInput && typeof resumedStartInput === "object") {
        const startPayload = resumedStartInput as {
          provider?: string;
          cwd?: string;
          resumeCursor?: unknown;
          threadId?: string;
        };
        assert.equal(startPayload.provider, "claudeAgent");
        assert.equal(startPayload.cwd, fixtureCwd("project-claude-start"));
        assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
        assert.equal(startPayload.threadId, initial.threadId);
      }

      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reuses persisted cwd when startSession resumes a claude session without cwd input",
    () =>
      Effect.gen(function* () {
        const tempDir = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "t3-provider-service-cwd-"),
        );
        const dbPath = NodePath.join(tempDir, "orchestration.sqlite");
        const persistenceLayer = makeSqlitePersistenceLive(dbPath);
        const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
          Layer.provide(persistenceLayer),
        );

        const firstClaude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
        const firstRegistry = makeAdapterRegistryMock({
          [ProviderDriverKind.make("claudeAgent")]: firstClaude.adapter,
        });
        const firstDirectoryLayer = ProviderSessionDirectoryLive.pipe(
          Layer.provide(runtimeRepositoryLayer),
        );
        const firstProviderLayer = makeProviderServiceTestLive().pipe(
          Layer.provide(
            Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, firstRegistry),
          ),
          Layer.provide(firstDirectoryLayer),
          Layer.provide(defaultServerSettingsLayer),
          Layer.provide(AnalyticsService.layerTest),
          Layer.provide(
            Layer.succeed(
              ProviderEventLoggers.ProviderEventLoggers,
              ProviderEventLoggers.NoOpProviderEventLoggers,
            ),
          ),
        );

        const initial = yield* Effect.gen(function* () {
          const provider = yield* ProviderService.ProviderService;
          return yield* provider.startSession(asThreadId("thread-claude-cwd"), {
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: claudeAgentInstanceId,
            threadId: asThreadId("thread-claude-cwd"),
            cwd: fixtureCwd("project-claude-cwd"),
            runtimeMode: "full-access",
          });
        }).pipe(Effect.provide(firstProviderLayer));

        const secondClaude = makeFakeCodexAdapter(CLAUDE_AGENT_DRIVER);
        const secondRegistry = makeAdapterRegistryMock({
          [ProviderDriverKind.make("claudeAgent")]: secondClaude.adapter,
        });
        const secondDirectoryLayer = ProviderSessionDirectoryLive.pipe(
          Layer.provide(runtimeRepositoryLayer),
        );
        const secondProviderLayer = makeProviderServiceTestLive().pipe(
          Layer.provide(
            Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistry, secondRegistry),
          ),
          Layer.provide(secondDirectoryLayer),
          Layer.provide(defaultServerSettingsLayer),
          Layer.provide(AnalyticsService.layerTest),
          Layer.provide(
            Layer.succeed(
              ProviderEventLoggers.ProviderEventLoggers,
              ProviderEventLoggers.NoOpProviderEventLoggers,
            ),
          ),
        );

        secondClaude.startSession.mockClear();

        yield* Effect.gen(function* () {
          const provider = yield* ProviderService.ProviderService;
          yield* provider.startSession(initial.threadId, {
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: claudeAgentInstanceId,
            threadId: initial.threadId,
            runtimeMode: "full-access",
          });
        }).pipe(Effect.provide(secondProviderLayer));

        assert.equal(secondClaude.startSession.mock.calls.length, 1);
        const resumedStartInput = secondClaude.startSession.mock.calls[0]?.[0];
        assert.equal(typeof resumedStartInput === "object" && resumedStartInput !== null, true);
        if (resumedStartInput && typeof resumedStartInput === "object") {
          const startPayload = resumedStartInput as {
            provider?: string;
            cwd?: string;
            resumeCursor?: unknown;
            threadId?: string;
          };
          assert.equal(startPayload.provider, "claudeAgent");
          assert.equal(startPayload.cwd, fixtureCwd("project-claude-cwd"));
          assert.deepEqual(startPayload.resumeCursor, initial.resumeCursor);
          assert.equal(startPayload.threadId, initial.threadId);
        }

        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const fanout = makeProviderServiceLayer();
fanout.layer("ProviderServiceLive fanout", (it) => {
  it.effect("fans out adapter turn completion events", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });

      const eventsRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const consumer = yield* Stream.runForEach(provider.streamEvents, (event) =>
        Ref.update(eventsRef, (current) => [...current, event]),
      ).pipe(Effect.forkChild);
      yield* advanceTestClock(50);

      const completedEvent: LegacyProviderRuntimeEvent = {
        type: "turn.completed",
        eventId: asEventId("evt-1"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId: session.threadId,
        turnId: asTurnId("turn-1"),
        status: "completed",
      };

      fanout.codex.emit(completedEvent);
      yield* advanceTestClock(50);

      const events = yield* Ref.get(eventsRef);
      yield* Fiber.interrupt(consumer);

      assert.equal(
        events.some((entry) => entry.type === "turn.completed"),
        true,
      );
      assert.equal(
        events.some(
          (entry) =>
            entry.type === "turn.completed" && entry.providerInstanceId === codexInstanceId,
        ),
        true,
      );
    }),
  );

  it.effect("fans out canonical runtime events in emission order", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const session = yield* provider.startSession(asThreadId("thread-seq"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-seq"),
        runtimeMode: "full-access",
      });

      const receivedRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const consumer = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach((event) => Ref.update(receivedRef, (current) => [...current, event])),
        Effect.forkChild,
      );
      yield* advanceTestClock(50);

      fanout.codex.emit({
        type: "tool.started",
        eventId: asEventId("evt-seq-1"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId: session.threadId,
        turnId: asTurnId("turn-1"),
        toolKind: "command",
        title: "Ran command",
      });
      fanout.codex.emit({
        type: "tool.completed",
        eventId: asEventId("evt-seq-2"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId: session.threadId,
        turnId: asTurnId("turn-1"),
        toolKind: "command",
        title: "Ran command",
      });
      fanout.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-seq-3"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId: session.threadId,
        turnId: asTurnId("turn-1"),
        status: "completed",
      });

      yield* Fiber.join(consumer);
      const received = yield* Ref.get(receivedRef);
      assert.deepEqual(
        received.map((event) => event.eventId),
        [asEventId("evt-seq-1"), asEventId("evt-seq-2"), asEventId("evt-seq-3")],
      );
    }),
  );

  it.effect("emits interaction-mode output and proposed-plan events from plan final text", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-plan-output");
      const turnId = asTurnId("turn-thread-plan-output");
      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });

      const receivedRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const consumer = yield* Stream.take(provider.streamEvents, 4).pipe(
        Stream.runForEach((event) => Ref.update(receivedRef, (current) => [...current, event])),
        Effect.forkChild,
      );
      yield* advanceTestClock(50);

      yield* provider.sendTurn({
        threadId,
        input: "make a plan",
        attachments: [],
        interactionMode: "plan",
      });
      fanout.codex.emit({
        type: "content.delta",
        eventId: asEventId("evt-plan-output-delta"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId,
        turnId,
        payload: {
          streamKind: "assistant_text",
          delta: "Notes\n\n<proposed_plan>\n# Ship it\n\n- wire event\n</proposed_plan>",
        },
      });
      fanout.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-plan-output-completed"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:01.000Z",
        threadId,
        turnId,
        payload: {
          state: "completed",
        },
      });

      yield* Fiber.join(consumer);
      const received = yield* Ref.get(receivedRef);
      const outputEvent = received.find(
        (event) => event.type === "turn.interaction-mode-output.completed",
      );
      assert.equal(outputEvent?.type, "turn.interaction-mode-output.completed");
      if (outputEvent?.type === "turn.interaction-mode-output.completed") {
        assert.equal(outputEvent.payload.ownerId, "upcomputer.core");
        assert.equal(outputEvent.payload.modeId, "plan");
        assert.equal(outputEvent.payload.outputKind, "proposed-plan");
        assert.equal(outputEvent.payload.output, "# Ship it\n\n- wire event");
      }
      const proposedEvent = received.find((event) => event.type === "turn.proposed.completed");
      assert.equal(proposedEvent?.type, "turn.proposed.completed");
      if (proposedEvent?.type === "turn.proposed.completed") {
        assert.equal(proposedEvent.payload.planMarkdown, "# Ship it\n\n- wire event");
      }
      assert.deepEqual(
        received.map((event) => String(event.eventId)),
        [
          "evt-plan-output-delta",
          "evt-plan-output-completed",
          "evt-plan-output-completed:interaction-mode-output",
          "evt-plan-output-completed:proposed-plan-output",
        ],
      );
    }),
  );

  it.effect("emits interaction-mode output for provider-native proposed-plan events", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-native-plan-output");
      const turnId = asTurnId("turn-thread-native-plan-output");
      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });

      const receivedRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const consumer = yield* Stream.take(provider.streamEvents, 2).pipe(
        Stream.runForEach((event) => Ref.update(receivedRef, (current) => [...current, event])),
        Effect.forkChild,
      );
      yield* advanceTestClock(50);

      yield* provider.sendTurn({
        threadId,
        input: "make a plan",
        attachments: [],
        interactionMode: "plan",
      });
      fanout.codex.emit({
        type: "turn.proposed.completed",
        eventId: asEventId("evt-native-plan-output"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId,
        turnId,
        payload: {
          planMarkdown: "# Direct provider plan",
        },
      });

      yield* Fiber.join(consumer);
      const received = yield* Ref.get(receivedRef);
      assert.deepEqual(
        received.map((event) => String(event.eventId)),
        ["evt-native-plan-output", "evt-native-plan-output:interaction-mode-output"],
      );
      const outputEvent = received.find(
        (event) => event.type === "turn.interaction-mode-output.completed",
      );
      assert.equal(outputEvent?.type, "turn.interaction-mode-output.completed");
      if (outputEvent?.type === "turn.interaction-mode-output.completed") {
        assert.equal(outputEvent.payload.outputKind, "proposed-plan");
        assert.equal(outputEvent.payload.output, "# Direct provider plan");
      }
    }),
  );

  it.effect("keeps subscriber delivery ordered and isolates failing subscribers", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const session = yield* provider.startSession(asThreadId("thread-1"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });

      const receivedByHealthy: string[] = [];
      const expectedEventIds = new Set<string>(["evt-ordered-1", "evt-ordered-2", "evt-ordered-3"]);
      const healthyFiber = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            receivedByHealthy.push(event.eventId);
          }),
        ),
        Effect.forkChild,
      );
      const failingFiber = yield* Stream.take(provider.streamEvents, 1).pipe(
        Stream.runForEach(() => Effect.fail("listener crash")),
        Effect.forkChild,
      );
      yield* advanceTestClock(50);

      const events: ReadonlyArray<LegacyProviderRuntimeEvent> = [
        {
          type: "tool.completed",
          eventId: asEventId("evt-ordered-1"),
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:00.000Z",
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          toolKind: "command",
          title: "Ran command",
          detail: "echo one",
        },
        {
          type: "message.delta",
          eventId: asEventId("evt-ordered-2"),
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:00.000Z",
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          delta: "hello",
        },
        {
          type: "turn.completed",
          eventId: asEventId("evt-ordered-3"),
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:00.000Z",
          threadId: session.threadId,
          turnId: asTurnId("turn-1"),
          status: "completed",
        },
      ];

      for (const event of events) {
        fanout.codex.emit(event);
      }
      const failingResult = yield* Effect.result(Fiber.join(failingFiber));
      assert.equal(failingResult._tag, "Failure");
      yield* Fiber.join(healthyFiber);

      assert.deepEqual(
        receivedByHealthy.filter((eventId) => expectedEventIds.has(eventId)).slice(0, 3),
        ["evt-ordered-1", "evt-ordered-2", "evt-ordered-3"],
      );
    }),
  );

  it.effect("records provider metrics with the routed provider label", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const session = yield* provider.startSession(asThreadId("thread-metrics"), {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: claudeAgentInstanceId,
        threadId: asThreadId("thread-metrics"),
        cwd: fixtureCwd("project"),
        runtimeMode: "full-access",
      });

      yield* provider.interruptTurn({ threadId: session.threadId });
      yield* provider.respondToRequest({
        threadId: session.threadId,
        requestId: asRequestId("req-metrics-1"),
        decision: "accept",
      });
      yield* provider.respondToUserInput({
        threadId: session.threadId,
        requestId: asRequestId("req-metrics-2"),
        answers: {
          sandbox_mode: "workspace-write",
        },
      });
      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 1,
      });
      yield* provider.stopSession({ threadId: session.threadId });

      const snapshots = yield* Metric.snapshot;

      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_turns_total", {
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "interrupt",
          outcome: "success",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_turns_total", {
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "approval-response",
          outcome: "success",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_turns_total", {
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "user-input-response",
          outcome: "success",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_turns_total", {
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "rollback",
          outcome: "success",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_sessions_total", {
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "stop",
          outcome: "success",
        }),
        true,
      );
    }),
  );

  it.effect(
    "records sendTurn metrics with the resolved provider when modelSelection is omitted",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService.ProviderService;

        const session = yield* provider.startSession(asThreadId("thread-send-metrics"), {
          provider: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: claudeAgentInstanceId,
          threadId: asThreadId("thread-send-metrics"),
          cwd: fixtureCwd("project-send-metrics"),
          runtimeMode: "full-access",
        });

        yield* provider.sendTurn({
          threadId: session.threadId,
          input: "hello",
          attachments: [],
        });

        const snapshots = yield* Metric.snapshot;

        assert.equal(
          hasMetricSnapshot(snapshots, "t3_provider_turns_total", {
            provider: ProviderDriverKind.make("claudeAgent"),
            operation: "send",
            outcome: "success",
          }),
          true,
        );
        assert.equal(
          hasMetricSnapshot(snapshots, "t3_provider_turn_duration", {
            provider: ProviderDriverKind.make("claudeAgent"),
            operation: "send",
          }),
          true,
        );
      }),
  );
});

const structuredOutputFanout = makeProviderServiceLayer({
  interactionModeRegistry: structuredTestInteractionModeRegistry,
});
structuredOutputFanout.layer("ProviderServiceLive interaction-mode output", (it) => {
  it.effect("emits structured interaction-mode output through registered parsers", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-structured-output");
      const turnId = asTurnId("turn-thread-structured-output");
      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });

      const receivedRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([]);
      const consumer = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach((event) => Ref.update(receivedRef, (current) => [...current, event])),
        Effect.forkChild,
      );
      yield* advanceTestClock(50);

      yield* provider.sendTurn({
        threadId,
        input: "draft a structured proposal",
        attachments: [],
        interactionMode: "orchestrator",
      });
      structuredOutputFanout.codex.emit({
        type: "content.delta",
        eventId: asEventId("evt-structured-output-delta"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId,
        turnId,
        payload: {
          streamKind: "assistant_text",
          delta: '{"tasks":[{"title":"Ship it"}]}',
        },
      });
      structuredOutputFanout.codex.emit({
        type: "turn.completed",
        eventId: asEventId("evt-structured-output-completed"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:01.000Z",
        threadId,
        turnId,
        payload: {
          state: "completed",
        },
      });

      yield* Fiber.join(consumer);
      const received = yield* Ref.get(receivedRef);
      assert.deepEqual(
        received.map((event) => String(event.eventId)),
        [
          "evt-structured-output-delta",
          "evt-structured-output-completed",
          "evt-structured-output-completed:interaction-mode-output",
        ],
      );
      const outputEvent = received.find(
        (event) => event.type === "turn.interaction-mode-output.completed",
      );
      assert.equal(outputEvent?.type, "turn.interaction-mode-output.completed");
      if (outputEvent?.type === "turn.interaction-mode-output.completed") {
        assert.equal(outputEvent.payload.ownerId, "upcomputer.orchestrator");
        assert.equal(outputEvent.payload.modeId, "orchestrator");
        assert.equal(outputEvent.payload.outputKind, "structured");
        assert.deepEqual(outputEvent.payload.output, {
          tasks: [{ title: "Ship it" }],
        });
      }
    }),
  );
});

const validation = makeProviderServiceLayer();
validation.layer("ProviderServiceLive validation", (it) => {
  it.effect("rejects session starts without an explicit provider instance id", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      validation.codex.startSession.mockClear();
      const failure = yield* Effect.flip(
        provider.startSession(asThreadId("thread-missing-instance-id"), {
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-missing-instance-id"),
          runtimeMode: "full-access",
        }),
      );

      assert.instanceOf(failure, ProviderValidationError);
      assert.include(failure.issue, "Provider instance id is required for provider 'codex'.");
      assert.equal(validation.codex.startSession.mock.calls.length, 0);
    }),
  );

  it.effect("rejects mismatched provider kind and provider instance id", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      validation.codex.startSession.mockClear();
      validation.claude.startSession.mockClear();
      const failure = yield* Effect.flip(
        provider.startSession(asThreadId("thread-instance-mismatch"), {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: claudeAgentInstanceId,
          threadId: asThreadId("thread-instance-mismatch"),
          runtimeMode: "full-access",
        }),
      );

      assert.instanceOf(failure, ProviderValidationError);
      assert.include(
        failure.issue,
        "Provider instance 'claudeAgent' belongs to driver 'claudeAgent', not 'codex'.",
      );
      assert.equal(validation.codex.startSession.mock.calls.length, 0);
      assert.equal(validation.claude.startSession.mock.calls.length, 0);
    }),
  );

  it.effect("returns ProviderValidationError for invalid input payloads", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;

      const failure = yield* Effect.result(
        provider.startSession(asThreadId("thread-validation"), {
          threadId: asThreadId("thread-validation"),
          provider: "invalid-provider",
          runtimeMode: "full-access",
        } as never),
      );

      assert.equal(failure._tag, "Failure");
      if (failure._tag !== "Failure") {
        return;
      }
      assert.equal(failure.failure._tag, "ProviderValidationError");
      if (failure.failure._tag !== "ProviderValidationError") {
        return;
      }
      assert.equal(failure.failure.operation, "ProviderService.startSession");
      assert.equal(failure.failure.issue.includes("invalid-provider"), true);
    }),
  );

  it.effect("resolves registered interaction modes before provider dispatch", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-interaction-mode-plan");

      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      validation.codex.sendTurn.mockClear();

      yield* provider.sendTurn({
        threadId,
        input: "make a plan",
        attachments: [],
        interactionMode: "plan",
      });

      assert.equal(validation.codex.sendTurn.mock.calls.length, 1);
      const sendInput = validation.codex.sendTurn.mock.calls[0]?.[0];
      assert.equal(sendInput?.interactionMode, "plan");
      assert.equal(sendInput?.resolvedInteractionMode?.id, "plan");
      assert.equal(sendInput?.resolvedInteractionMode?.provider.providerId, "codex");
      assert.equal(sendInput?.resolvedInteractionMode?.provider.collaborationMode, "plan");
    }),
  );

  it.effect("rejects unregistered interaction modes before provider dispatch", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-interaction-mode-unknown");

      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      validation.codex.sendTurn.mockClear();

      const failure = yield* Effect.flip(
        provider.sendTurn({
          threadId,
          input: "review this",
          attachments: [],
          interactionMode: "task-review",
        }),
      );

      assert.instanceOf(failure, ProviderValidationError);
      assert.include(failure.issue, "Interaction mode 'task-review' is not registered.");
      assert.equal(validation.codex.sendTurn.mock.calls.length, 0);
    }),
  );

  it.effect("rejects interaction modes unsupported by the routed provider", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const threadId = asThreadId("thread-interaction-mode-unsupported-provider");

      yield* provider.startSession(threadId, {
        provider: ProviderDriverKind.make("grok"),
        providerInstanceId: grokInstanceId,
        threadId,
        runtimeMode: "full-access",
      });
      validation.grok.sendTurn.mockClear();

      const failure = yield* Effect.flip(
        provider.sendTurn({
          threadId,
          input: "make a plan",
          attachments: [],
          interactionMode: "plan",
        }),
      );

      assert.instanceOf(failure, ProviderValidationError);
      assert.include(failure.issue, "Interaction mode 'plan' does not support provider 'grok'.");
      assert.equal(validation.grok.sendTurn.mock.calls.length, 0);
    }),
  );

  it.effect("accepts startSession when adapter has not emitted provider thread id yet", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;

      validation.codex.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        Effect.sync(() => {
          const now = "2026-01-01T00:00:00.000Z";
          return {
            provider: ProviderDriverKind.make("codex"),
            status: "ready",
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            cwd: input.cwd ?? process.cwd(),
            createdAt: now,
            updatedAt: now,
          } satisfies ProviderSession;
        }),
      );

      const session = yield* provider.startSession(asThreadId("thread-missing"), {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        threadId: asThreadId("thread-missing"),
        cwd: fixtureCwd("project"),
        runtimeMode: "full-access",
      });

      assert.equal(session.threadId, asThreadId("thread-missing"));

      const runtime = yield* runtimeRepository.getByThreadId({
        threadId: session.threadId,
      });
      assert.equal(Option.isSome(runtime), true);
      if (Option.isSome(runtime)) {
        assert.equal(runtime.value.threadId, session.threadId);
      }
    }),
  );
});

const activeSessionThreadId = asThreadId("thread-active-session");
const historicalSessionThreadId = asThreadId("thread-historical-session");
const listThreadIds = vi.fn(() =>
  Effect.succeed([activeSessionThreadId, historicalSessionThreadId]),
);
const getBinding = vi.fn((threadId: ThreadId) =>
  Effect.succeed(
    Option.some({
      threadId,
      provider: CODEX_DRIVER,
      providerInstanceId: codexInstanceId,
    }),
  ),
);
const boundedListing = makeProviderServiceLayer({
  directory: {
    upsert: () => Effect.void,
    getProvider: () => Effect.die("ProviderService.listSessions does not use getProvider"),
    getBinding,
    listThreadIds,
    listBindings: () => Effect.die("ProviderService.listSessions does not use listBindings"),
  },
});

boundedListing.layer("ProviderServiceLive session listing", (it) => {
  it.effect("looks up bindings for active sessions without scanning historical threads", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      yield* boundedListing.codex.startSession({
        provider: CODEX_DRIVER,
        providerInstanceId: codexInstanceId,
        threadId: activeSessionThreadId,
        cwd: fixtureCwd("project-active-session"),
        runtimeMode: "full-access",
      });
      listThreadIds.mockClear();
      getBinding.mockClear();

      const sessions = yield* provider.listSessions();

      assert.equal(sessions.length, 1);
      assert.equal(listThreadIds.mock.calls.length, 0);
      assert.deepEqual(getBinding.mock.calls, [[activeSessionThreadId]]);
    }),
  );
});
