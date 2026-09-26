import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
  type ThreadId as ThreadIdType,
} from "@upcomputer/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import { THREAD_STATE_IDLE_TTL_MS } from "./threadRetention.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  type EnvironmentThreadStatus,
} from "./threadState.ts";

function statusWithoutLiveData(data: Option.Option<OrchestrationThread>): EnvironmentThreadStatus {
  return Option.isSome(data) ? "cached" : "empty";
}

function formatThreadError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize the thread.";
}

function shouldPersistThread(thread: OrchestrationThread): boolean {
  const status = thread.session?.status;
  return status !== "starting" && status !== "running";
}

export const makeEnvironmentThreadState = Effect.fn("EnvironmentThreadState.make")(function* (
  threadId: ThreadIdType,
  options?: { readonly reloadSnapshot?: boolean },
) {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ThreadSnapshotLoader;
  const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
  const environmentId = supervisor.target.environmentId;
  const cached = yield* cache.loadThread(environmentId, threadId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached thread.").pipe(
        Effect.annotateLogs({
          environmentId,
          threadId,
          error: error.message,
        }),
        Effect.as(Option.none<OrchestrationThreadDetailSnapshot>()),
      ),
    ),
  );
  const cachedThread = Option.map(cached, (snapshot) => snapshot.thread);
  const state = yield* SubscriptionRef.make<EnvironmentThreadState>({
    data: cachedThread,
    status: statusWithoutLiveData(cachedThread),
    error: Option.none(),
  });
  // Seed the resume cursor from the cached snapshot so a warm cache can catch up
  // via `afterSequence` instead of re-downloading the full thread body.
  const lastSequence = yield* SubscriptionRef.make(
    Option.match(cached, { onNone: () => 0, onSome: (snapshot) => snapshot.snapshotSequence }),
  );
  const awaitingCompletion = yield* Ref.make(false);
  // Replaces cached data with a fresh HTTP snapshot on the first subscription.
  let reloadSnapshot = options?.reloadSnapshot === true;
  const persistence = yield* Queue.sliding<OrchestrationThreadDetailSnapshot>(1);

  const persist = Effect.fn("EnvironmentThreadState.persist")(function* (
    snapshot: OrchestrationThreadDetailSnapshot,
  ) {
    yield* cache.saveThread(environmentId, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist the thread cache.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce("500 millis"),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  const setConnecting = SubscriptionRef.update(state, (current) =>
    current.status === "deleted" || Option.isSome(current.error)
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live" || current.status === "deleted" || Option.isSome(current.error)
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setDisconnected = Effect.gen(function* () {
    yield* Ref.set(awaitingCompletion, false);
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
    }));
  });
  const setStreamError = (message: string) =>
    Ref.set(awaitingCompletion, false).pipe(
      Effect.andThen(
        SubscriptionRef.update(state, (current) => ({
          ...current,
          status:
            current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
          error: Option.some(message),
        })),
      ),
    );

  const setThread = Effect.fn("EnvironmentThreadState.setThread")(function* (
    thread: OrchestrationThread,
  ) {
    const waiting = yield* Ref.get(awaitingCompletion);
    yield* SubscriptionRef.update(state, (current) => ({
      data: Option.some(thread),
      // Buffered values from the failed attempt can still arrive after its error.
      status: Option.isSome(current.error)
        ? ("cached" as const)
        : waiting
          ? ("synchronizing" as const)
          : ("live" as const),
      error: current.error,
    }));
    // Active threads can update many times per second and retain large tool
    // payloads. The server remains the source of truth while a turn is active;
    // persist once it settles so cache encoding stays off the streaming path.
    if (shouldPersistThread(thread)) {
      const snapshotSequence = yield* SubscriptionRef.get(lastSequence);
      yield* Queue.offer(persistence, { snapshotSequence, thread });
    }
  });

  const setDeleted = Effect.fn("EnvironmentThreadState.setDeleted")(function* () {
    yield* Ref.set(awaitingCompletion, false);
    yield* SubscriptionRef.set(state, {
      data: Option.none(),
      status: "deleted",
      error: Option.none(),
    });
    yield* cache.removeThread(environmentId, threadId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove the cached thread.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  const applyItem = Effect.fn("EnvironmentThreadState.applyItem")(function* (
    item: OrchestrationThreadStreamItem,
  ) {
    if (item.kind === "synchronized") {
      yield* Ref.set(awaitingCompletion, false);
      yield* SubscriptionRef.update(state, (current) =>
        Option.isSome(current.data) && current.status !== "deleted" && Option.isNone(current.error)
          ? { ...current, status: "live" as const, error: Option.none() }
          : current,
      );
      return;
    }

    if (item.kind === "snapshot") {
      yield* SubscriptionRef.set(lastSequence, item.snapshot.snapshotSequence);
      yield* setThread(item.snapshot.thread);
      return;
    }

    const sequence = yield* SubscriptionRef.get(lastSequence);
    if (item.event.sequence <= sequence) {
      return;
    }
    yield* SubscriptionRef.set(lastSequence, item.event.sequence);

    const current = yield* SubscriptionRef.get(state);
    if (Option.isNone(current.data)) {
      if (item.event.type === "thread.deleted") {
        yield* setDeleted();
      }
      return;
    }
    const result = applyThreadDetailEvent(current.data.value, item.event);
    if (result.kind === "updated") {
      yield* setThread(result.thread);
    } else if (result.kind === "deleted") {
      yield* setDeleted();
    }
  });

  // Replays and streaming bursts arrive in chunks. Reduce a chunk of plain
  // events into one thread update so subscribers render once per chunk.
  const applyItems = Effect.fn("EnvironmentThreadState.applyItems")(function* (
    items: ReadonlyArray<OrchestrationThreadStreamItem>,
  ) {
    const current = yield* SubscriptionRef.get(state);
    if (
      Option.isNone(current.data) ||
      items.some(
        (item) =>
          item.kind === "snapshot" ||
          (item.kind === "event" &&
            (item.event.type === "thread.reverted" || item.event.type === "thread.deleted")),
      )
    ) {
      for (const item of items) {
        yield* applyItem(item);
      }
      return;
    }

    let thread = current.data.value;
    let sequence = yield* SubscriptionRef.get(lastSequence);
    let synchronized = false;
    for (const item of items) {
      if (item.kind === "synchronized") {
        synchronized = true;
      } else if (item.kind === "event" && item.event.sequence > sequence) {
        sequence = item.event.sequence;
        const result = applyThreadDetailEvent(thread, item.event);
        if (result.kind === "updated") thread = result.thread;
      }
    }
    yield* SubscriptionRef.set(lastSequence, sequence);
    if (thread !== current.data.value) yield* setThread(thread);
    if (synchronized) yield* applyItem({ kind: "synchronized" });
  });

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setConnecting;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  const foregroundResubscriptions = Option.match(wakeups, {
    onNone: () => Stream.never,
    onSome: (service) =>
      service.changes.pipe(Stream.filter((reason) => reason === "application-active")),
  });

  yield* setConnecting;
  yield* Effect.forkScoped(
    subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeThread,
      Effect.fn("EnvironmentThreadState.makeSubscribeInput")(function* (session) {
        const supportsCompletionMarker = yield* session.initialConfig.pipe(
          Effect.map((config) => config.threadResumeCompletionMarker === true),
          Effect.orElseSucceed(() => false),
        );
        yield* Ref.set(awaitingCompletion, supportsCompletionMarker);
        // Connection notifications do not establish that a terminated load restarted.
        // Clear its diagnostic only when this subscription actually tries again.
        yield* SubscriptionRef.update(state, (current) =>
          current.status === "deleted"
            ? current
            : { ...current, status: "synchronizing" as const, error: Option.none() },
        );

        let current = yield* SubscriptionRef.get(state);
        if ((Option.isNone(current.data) || reloadSnapshot) && current.status !== "deleted") {
          reloadSnapshot = false;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
            Effect.flatMap(
              Option.match({
                onSome: Effect.succeed,
                onNone: () =>
                  SubscriptionRef.changes(supervisor.prepared).pipe(
                    Stream.filter(Option.isSome),
                    Stream.map((value) => value.value),
                    Stream.runHead,
                    Effect.map(Option.getOrThrow),
                  ),
              }),
            ),
          );
          const httpSnapshot = yield* snapshotLoader.load(prepared, threadId);
          if (Option.isSome(httpSnapshot)) {
            yield* applyItem({ kind: "snapshot", snapshot: httpSnapshot.value });
            current = yield* SubscriptionRef.get(state);
          }
        }

        const sequence = yield* SubscriptionRef.get(lastSequence);
        const canResume = Option.isSome(current.data);
        if (!supportsCompletionMarker && canResume) {
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            status: value.status === "deleted" ? value.status : ("live" as const),
            error: Option.none(),
          }));
        }

        return {
          threadId,
          ...(canResume ? { afterSequence: sequence } : {}),
          ...(supportsCompletionMarker ? { requestCompletionMarker: true as const } : {}),
        };
      }),
      {
        onDefect: () => setStreamError("Could not synchronize the thread."),
        onExpectedFailure: (cause) => setStreamError(formatThreadError(cause)),
        retryExpectedFailureAfter: "250 millis",
        resubscribe: foregroundResubscriptions,
      },
    ).pipe(
      Stream.runForEachArray((items) =>
        items.length === 1 ? applyItem(items[0]!) : applyItems(items),
      ),
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.all([SubscriptionRef.get(state), SubscriptionRef.get(lastSequence)]).pipe(
      Effect.flatMap(([current, snapshotSequence]) =>
        Option.match(current.data, {
          onNone: () => Effect.void,
          onSome: (thread) =>
            shouldPersistThread(thread) ? persist({ snapshotSequence, thread }) : Effect.void,
        }),
      ),
    ),
  );

  return state;
});

export function threadStateChanges(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  consumeSnapshotReload: () => boolean = () => false,
) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(
      Effect.suspend(() =>
        makeEnvironmentThreadState(threadId, { reloadSnapshot: consumeSnapshotReload() }),
      ).pipe(Effect.map(SubscriptionRef.changes)),
    ),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ThreadSnapshotLoader | R,
    E
  >,
) {
  const snapshotReloads = new Set<string>();
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return runtime
      .atom(
        threadStateChanges(environmentId, threadId, () => snapshotReloads.delete(key)),
        {
          initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
        },
      )
      .pipe(
        Atom.setIdleTTL(THREAD_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-thread-state:${key}`),
      );
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
    /** Rebuilds the thread state from a fresh server snapshot instead of the local cache. */
    reloadSnapshot: (
      registry: AtomRegistry.AtomRegistry,
      environmentId: EnvironmentIdType,
      threadId: ThreadIdType,
    ) => {
      const key = threadKey({ environmentId, threadId });
      snapshotReloads.add(key);
      registry.refresh(family(key));
    },
  };
}

export * from "./archivedThreads.ts";
export * from "./checkpointDiff.ts";
export * from "./threadSnapshotHttp.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";
