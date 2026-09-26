import {
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
} from "@upcomputer/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { RpcClientError } from "effect/unstable/rpc";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  makeEnvironmentThreadState,
  ThreadSnapshotLoader,
  type EnvironmentThreadState,
} from "./threads.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-1");
const CACHED_SNAPSHOT_SEQUENCE = 7;
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};
const BASE_THREAD: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Cached thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};
const ACTIVE_THREAD: OrchestrationThread = {
  ...BASE_THREAD,
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-04-01T00:01:00.000Z",
    startedAt: "2026-04-01T00:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
  session: {
    threadId: THREAD_ID,
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.make("turn-1"),
    lastError: null,
    updatedAt: "2026-04-01T00:01:00.000Z",
  },
};

type TestThreadInput = OrchestrationThreadStreamItem | Error | Cause.Cause<Error>;

function testSession(
  client: WsRpcProtocolClient,
  options?: { readonly completionMarker?: boolean },
): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.succeed(
      options?.completionMarker === true
        ? ({ threadResumeCompletionMarker: true } as never)
        : ({} as never),
    ),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function awaitThreadState(
  observed: Queue.Queue<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) {
  return Queue.take(observed).pipe(
    Effect.repeat({
      until: predicate,
    }),
  );
}

const makeHarness = Effect.fn("TestEnvironmentThreads.makeHarness")(function* (options?: {
  readonly cached?: OrchestrationThread;
  readonly httpSnapshot?: Option.Option<OrchestrationThreadDetailSnapshot>;
  readonly completionMarker?: boolean;
  readonly snapshotLoad?: Effect.Effect<Option.Option<OrchestrationThreadDetailSnapshot>>;
  readonly stream?: Stream.Stream<OrchestrationThreadStreamItem, Error>;
}) {
  const inputs = yield* Queue.unbounded<TestThreadInput>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const latest = yield* Ref.make<EnvironmentThreadState>(EMPTY_ENVIRONMENT_THREAD_STATE);
  const retryCount = yield* Ref.make(0);
  const subscriptionCount = yield* Ref.make(0);
  const loaderCalls = yield* Ref.make(0);
  const lastSubscribeAfterSequence = yield* Ref.make<number | undefined>(undefined);
  const lastRequestCompletionMarker = yield* Ref.make<boolean | undefined>(undefined);
  const savedThreads = yield* Ref.make<ReadonlyArray<OrchestrationThreadDetailSnapshot>>([]);
  const removedThreads = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>();
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const streamFrom = (queue: Queue.Queue<TestThreadInput>) =>
    Stream.fromQueue(queue).pipe(
      Stream.mapEffect((input) =>
        Cause.isCause(input)
          ? Effect.failCause(input)
          : input instanceof Error
            ? Effect.fail(input)
            : Effect.succeed(input),
      ),
    );
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input: {
      readonly afterSequence?: number;
      readonly requestCompletionMarker?: boolean;
    }) =>
      Stream.unwrap(
        Ref.updateAndGet(subscriptionCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(lastSubscribeAfterSequence, input.afterSequence)),
          Effect.andThen(Ref.set(lastRequestCompletionMarker, input.requestCompletionMarker)),
          Effect.as(options?.stream ?? streamFrom(inputs)),
        ),
      ),
  } as unknown as WsRpcProtocolClient;
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(
      testSession(
        client,
        options?.completionMarker === true ? { completionMarker: true } : undefined,
      ),
    ),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some(PREPARED),
  );
  const snapshotLoader = ThreadSnapshotLoader.of({
    load: (_prepared, threadId) =>
      Ref.update(loaderCalls, (count) => count + 1).pipe(
        Effect.andThen(
          options?.snapshotLoad ??
            Effect.succeed(
              threadId === THREAD_ID
                ? (options?.httpSnapshot ?? Option.none<OrchestrationThreadDetailSnapshot>())
                : Option.none<OrchestrationThreadDetailSnapshot>(),
            ),
        ),
      ),
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Ref.update(retryCount, (count) => count + 1),
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeed(Option.none()),
    saveShell: () => Effect.void,
    loadThread: (_environmentId, threadId) =>
      Effect.succeed(
        threadId === THREAD_ID && options?.cached !== undefined
          ? Option.some({
              snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
              thread: options.cached,
            })
          : Option.none(),
      ),
    saveThread: (_environmentId, thread) =>
      Ref.update(savedThreads, (current) => [...current, thread]),
    removeThread: (_environmentId, threadId) =>
      Ref.update(removedThreads, (current) => [...current, threadId]),
    loadServerConfig: () => Effect.succeed(Option.none()),
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeed(Option.none()),
    saveVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const threadState = yield* makeEnvironmentThreadState(THREAD_ID).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader, snapshotLoader),
    Effect.provideService(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromQueue(wakeups) }),
    ),
  );
  yield* SubscriptionRef.changes(threadState).pipe(
    Stream.runForEach((state) =>
      Ref.set(latest, state).pipe(Effect.andThen(Queue.offer(observed, state))),
    ),
    Effect.forkScoped,
  );

  return {
    inputs,
    observed,
    latest,
    retryCount,
    subscriptionCount,
    loaderCalls,
    lastSubscribeAfterSequence,
    lastRequestCompletionMarker,
    supervisorState,
    supervisorSession,
    savedThreads,
    removedThreads,
    wakeups,
    replaceSession: SubscriptionRef.set(
      supervisorSession,
      Option.some(
        testSession(
          client,
          options?.completionMarker === true ? { completionMarker: true } : undefined,
        ),
      ),
    ),
  };
});

const snapshot = (thread: OrchestrationThread): OrchestrationThreadStreamItem => ({
  kind: "snapshot",
  snapshot: {
    snapshotSequence: 1,
    thread,
  },
});

const synchronized = (): OrchestrationThreadStreamItem => ({ kind: "synchronized" });

const SYNC_FAILURE_MESSAGE = "Could not synchronize the thread.";

const protocolDefect = (message: string): Cause.Cause<Error> =>
  Cause.fail(
    new RpcClientError.RpcClientError({
      reason: new RpcClientError.RpcClientDefect({ message, cause: new Error(message) }),
    }) as unknown as Error,
  );

const CONNECTING_STATE: SupervisorConnectionState = {
  desired: true,
  network: "online",
  phase: "connecting",
  stage: "synchronizing",
  attempt: 1,
  generation: 0,
  lastFailure: null,
  retryAt: null,
};
const CONNECTED_STATE: SupervisorConnectionState = {
  ...CONNECTING_STATE,
  phase: "connected",
  stage: null,
  generation: 1,
};

const awaitSubscriptionCount = (
  harness: { readonly subscriptionCount: Ref.Ref<number> },
  count: number,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* Ref.get(harness.subscriptionCount)) >= count) return;
      yield* Effect.yieldNow;
    }
  });

const titleUpdated = (title: string, sequence = 2): OrchestrationThreadStreamItem => ({
  kind: "event",
  event: {
    eventId: EventId.make("event-title"),
    sequence,
    occurredAt: "2026-04-01T01:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.meta-updated",
    payload: {
      threadId: THREAD_ID,
      title,
      updatedAt: "2026-04-01T01:00:00.000Z",
    },
  },
});

const deleted = (): OrchestrationThreadStreamItem => ({
  kind: "event",
  event: {
    eventId: EventId.make("event-deleted"),
    sequence: 3,
    occurredAt: "2026-04-01T02:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.deleted",
    payload: {
      threadId: THREAD_ID,
      deletedAt: "2026-04-01T02:00:00.000Z",
    },
  },
});

describe("EnvironmentThreads", () => {
  it.effect("publishes cached data immediately from a warm cache", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      const state = yield* awaitThreadState(harness.observed, (value) => Option.isSome(value.data));

      expect(Option.getOrThrow(state.data)).toEqual(BASE_THREAD);
      expect(Option.isNone(state.error)).toBe(true);
    }),
  );

  it.effect("resumes a warm cache via afterSequence without an HTTP fetch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });

      // The warm cache reaches live from the cached data, and a live event
      // applies on top of it.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      // The subscription resumed from the cached sequence and never fetched the
      // full snapshot over HTTP.
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
    }),
  );

  it.effect("reduces live events and persists the latest thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title"));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.thread.title).toBe("Live title");
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.snapshotSequence).toBe(2);
    }),
  );

  it.effect("does not persist active thread snapshots during streaming or teardown", () =>
    Effect.gen(function* () {
      const savedThreads = yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness({ cached: ACTIVE_THREAD });
          yield* awaitThreadState(
            harness.observed,
            (value) =>
              value.status === "live" &&
              Option.isSome(value.data) &&
              value.data.value.session?.status === "running",
          );

          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;

          expect(yield* Ref.get(harness.savedThreads)).toEqual([]);
          return harness.savedThreads;
        }),
      );

      expect(yield* Ref.get(savedThreads)).toEqual([]);
    }),
  );

  it.effect("seeds the thread from the HTTP snapshot and resumes live events", () =>
    Effect.gen(function* () {
      const httpThread: OrchestrationThread = { ...BASE_THREAD, title: "HTTP title" };
      const harness = yield* makeHarness({
        httpSnapshot: Option.some({ snapshotSequence: 1, thread: httpThread }),
      });
      // No socket snapshot is pushed; only a live event arrives over the socket.
      // It can only be applied if the HTTP snapshot already seeded the thread.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
      // Cold cache: the full snapshot was loaded over HTTP and the socket
      // resumed from that snapshot's sequence.
      expect(yield* Ref.get(harness.loaderCalls)).toBeGreaterThanOrEqual(1);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(1);
    }),
  );

  it.effect("ignores replayed thread events at or below the snapshot sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, titleUpdated("Replayed title", 1));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).title).toBe("Live title");
    }),
  );

  it.effect("removes cached data when the thread is deleted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, deleted());

      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "deleted",
      );

      expect(Option.isNone(state.data)).toBe(true);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([THREAD_ID]);
    }),
  );

  it.effect("does not resurrect a deleted thread when the app returns to the foreground", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: BASE_THREAD,
        completionMarker: true,
        httpSnapshot: Option.some({
          snapshotSequence: 4,
          thread: { ...BASE_THREAD, title: "Stale HTTP thread" },
        }),
      });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, deleted());
      yield* awaitThreadState(harness.observed, (value) => value.status === "deleted");

      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      yield* Queue.offer(harness.wakeups, "application-active");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      const latest = yield* Ref.get(harness.latest);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      expect(latest.status).toBe("deleted");
      expect(Option.isNone(latest.data)).toBe(true);
    }),
  );

  it.effect("preserves data after a domain failure and resumes on a replacement session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* Queue.offer(harness.inputs, new Error("stream failed"));

      const state = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );

      expect(Option.getOrThrow(state.data)).toEqual(BASE_THREAD);
      expect(Option.getOrThrow(state.error)).toBe("stream failed");
      expect(yield* Ref.get(harness.retryCount)).toBe(0);

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_THREAD,
          title: "Recovered thread",
        }),
      );
      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Recovered thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
    }),
  );

  it.effect("recovers from a transient domain failure without replacing the session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Queue.offer(harness.inputs, new Error("thread not found yet"));

      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );
      expect(Option.getOrThrow(failed.error)).toBe("thread not found yet");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);

      yield* TestClock.adjust("250 millis");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_THREAD,
          title: "Materialized thread",
        }),
      );

      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Materialized thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.retryCount)).toBe(0);
    }),
  );

  it.effect("does not overwrite a live snapshot when the supervisor becomes ready", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD });
      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");

      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 1,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      expect((yield* Ref.get(harness.latest)).status).toBe("live");
    }),
  );

  it.effect("keeps replayed updates synchronizing until the completion marker arrives", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);

      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Caught-up title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      const catchingUp = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "synchronizing" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Caught-up title",
      );
      expect(catchingUp.status).toBe("synchronizing");

      yield* Queue.offer(harness.inputs, synchronized());
      const live = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(live.data).title).toBe("Caught-up title");
    }),
  );

  it.effect("resumes replacement sessions from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Latest title",
      );

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect((yield* Ref.get(harness.latest)).status).toBe("synchronizing");
    }),
  );

  it.effect("resubscribes on app foreground from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_THREAD, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.title === "Latest title",
      );

      yield* Queue.offer(harness.wakeups, "application-active");
      const synchronizing = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(synchronizing.status).toBe("synchronizing");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);

      yield* Queue.offer(harness.inputs, synchronized());
      const live = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(live.data).title).toBe("Latest title");
    }),
  );
  it.effect("exposes snapshot loader defects before the RPC subscription starts", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        snapshotLoad: Effect.die(new Error("SYNTHETIC_RAW_SNAPSHOT_DEFECT")),
      });
      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );

      expect(failed.status).toBe("empty");
      expect(failed.error).toEqual(Option.some(SYNC_FAILURE_MESSAGE));
      expect(failed.data).toEqual(Option.none());
      yield* TestClock.adjust("1 second");
      expect(yield* Ref.get(harness.latest)).toEqual(failed);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(0);
    }),
  );

  it.effect.each([
    { kind: "protocol", cached: false },
    { kind: "protocol", cached: true },
    { kind: "fatal", cached: false },
    { kind: "fatal", cached: true },
  ] as const)(
    "retains a terminated $kind load diagnostic across connection updates (cached: $cached)",
    ({ kind, cached }) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness(cached ? { cached: BASE_THREAD } : undefined);
        const message = "SYNTHETIC_RAW_DEFECT";
        yield* Queue.offer(
          harness.inputs,
          kind === "fatal" ? Cause.die(new Error(message)) : protocolDefect(message),
        );
        const failed = yield* awaitThreadState(harness.observed, (value) =>
          Option.isSome(value.error),
        );
        // A defect must not enter the domain retry loop.
        yield* TestClock.adjust("1 second");
        expect(yield* Ref.get(harness.latest)).toEqual(failed);
        expect(failed.status).toBe(cached ? "cached" : "empty");
        expect(failed.error).toEqual(Option.some(SYNC_FAILURE_MESSAGE));
        expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);

        for (const connection of [AVAILABLE_CONNECTION_STATE, CONNECTING_STATE, CONNECTED_STATE]) {
          yield* SubscriptionRef.set(harness.supervisorState, connection);
          yield* TestClock.adjust("0 millis");
          expect(yield* Ref.get(harness.latest)).toEqual(failed);
        }

        yield* harness.replaceSession;
        yield* awaitSubscriptionCount(harness, 2);
        if (kind === "fatal") {
          // A fatal child cannot restart just because its supervisor reconnects.
          expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);
          expect(yield* Ref.get(harness.latest)).toEqual(failed);
          return;
        }
        expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
        yield* Queue.offer(harness.inputs, snapshot(BASE_THREAD));
        const recovered = yield* awaitThreadState(
          harness.observed,
          (value) => value.status === "live",
        );
        expect(recovered.error).toEqual(Option.none());
      }),
  );

  it.effect.each(["protocol", "fatal", "domain"] as const)(
    "keeps buffered outcomes after a %s failure",
    (kind) =>
      Effect.gen(function* () {
        const error = new Error(
          kind === "domain" ? "buffered thread failure" : "SYNTHETIC_BUFFERED_DEFECT",
        );
        const drained = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          stream: Stream.fromIterable([
            snapshot(BASE_THREAD),
            synchronized(),
            titleUpdated("Buffer drained"),
          ]).pipe(
            Stream.concat(
              Stream.failCause(
                kind === "fatal"
                  ? Cause.die(error)
                  : kind === "domain"
                    ? Cause.fail(error)
                    : protocolDefect(error.message),
              ),
            ),
          ),
        });
        yield* Stream.fromQueue(harness.observed).pipe(
          Stream.runForEach((value) =>
            Option.getOrNull(value.data)?.title === "Buffer drained" && Option.isSome(value.error)
              ? Deferred.succeed(drained, undefined)
              : Effect.void,
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(drained);
        yield* TestClock.adjust("0 millis");

        const final = yield* Ref.get(harness.latest);
        expect(Option.getOrThrow(final.data).title).toBe("Buffer drained");
        expect(final.error).toEqual(
          Option.some(kind === "domain" ? error.message : SYNC_FAILURE_MESSAGE),
        );
        expect(final.status).toBe("cached");
      }),
  );
  it.effect.each([1, 16, 500])("publishes each replay batch once (batch size: %i)", (batchSize) =>
    Effect.gen(function* () {
      const stream = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
      const harness = yield* makeHarness({
        cached: BASE_THREAD,
        completionMarker: true,
        stream: Stream.fromQueue(stream),
      });
      yield* awaitSubscriptionCount(harness, 1);
      const published = new Set<unknown>();
      const awaitRecorded = (predicate: (state: EnvironmentThreadState) => boolean) =>
        Queue.take(harness.observed).pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              const messages = Option.getOrNull(state.data)?.messages;
              if (messages !== undefined && messages !== BASE_THREAD.messages) {
                published.add(messages);
              }
            }),
          ),
          Effect.repeat({ until: predicate }),
        );
      const events: OrchestrationThreadStreamItem[] = Array.from({ length: 500 }, (_, index) => ({
        kind: "event",
        event: {
          type: "thread.message-sent",
          sequence: CACHED_SNAPSHOT_SEQUENCE + 1 + index,
          eventId: EventId.make(`replay-${index}`),
          aggregateKind: "thread",
          aggregateId: THREAD_ID,
          occurredAt: BASE_THREAD.createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            threadId: THREAD_ID,
            messageId: MessageId.make("replayed-message"),
            role: "assistant",
            text: `${index},`,
            turnId: null,
            streaming: true,
            createdAt: BASE_THREAD.createdAt,
            updatedAt: BASE_THREAD.createdAt,
          },
        },
      }));
      for (let offset = 0; offset < events.length; offset += batchSize) {
        yield* Queue.offerAll(stream, events.slice(offset, offset + batchSize));
        const last = Math.min(offset + batchSize, events.length) - 1;
        yield* awaitRecorded(
          (state) => Option.getOrNull(state.data)?.messages[0]?.text.endsWith(`${last},`) === true,
        );
      }
      yield* Queue.offerAll(stream, [events[499]!, events[0]!]);
      yield* Queue.offer(stream, synchronized());
      const live = yield* awaitRecorded((state) => state.status === "live");
      expect(Option.getOrThrow(live.data).messages[0]?.text).toBe(
        Array.from({ length: 500 }, (_, index) => `${index},`).join(""),
      );
      expect(published.size).toBe(Math.ceil(500 / batchSize));

      yield* harness.replaceSession;
      yield* awaitSubscriptionCount(harness, 2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(
        CACHED_SNAPSHOT_SEQUENCE + 500,
      );
    }),
  );
});
