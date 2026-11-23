import type { EnvironmentId } from "@t3tools/contracts";
import {
  instructionUpdateById,
  isPendingInstructionUpdate,
  type InstructionUpdateEntry,
  type InstructionUpdates,
  type InstructionUpdatesMode,
  type InstructionUpdateStatus,
  type InstructionUpdatesUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  readTasksWebAccess,
  readTasksWebClient,
  subscribeTasksWebAccess,
} from "../environmentApi.ts";

/** One update as the UI shows it: what this build ships for it, and the install's decision. */
export interface InstructionUpdateView {
  readonly entry: InstructionUpdateEntry;
  readonly status: InstructionUpdateStatus;
}

export interface InstructionUpdatesView {
  readonly mode: InstructionUpdatesMode;
  /** Every update to list; those the install had from the start are left out. */
  readonly entries: ReadonlyArray<InstructionUpdateView>;
  /** Waiting for a decision, the dismissed ones included. */
  readonly pending: ReadonlyArray<InstructionUpdateView>;
  /** The bell's card: pending and not dismissed. */
  readonly notice: ReadonlyArray<InstructionUpdateView>;
}

const EMPTY_VIEW: InstructionUpdatesView = { mode: "ask", entries: [], pending: [], notice: [] };

/** The server's states joined with this build's entries; an entry this build lacks is skipped. */
export function instructionUpdatesView(data: InstructionUpdates | null): InstructionUpdatesView {
  if (data === null) return EMPTY_VIEW;
  const entries = data.entries.flatMap((status) => {
    const entry = instructionUpdateById(status.id);
    // Applied with no decision: the install was created with it.
    if (entry === undefined || (status.state === "applied" && status.decidedAt === null)) return [];
    return [{ entry, status }];
  });
  const pending = entries.filter(({ status }) => isPendingInstructionUpdate(status.state));
  return {
    mode: data.mode,
    entries,
    pending,
    notice: pending.filter(({ status }) => status.state === "pending"),
  };
}

/** The input's changes applied to the current states, as the server applies them. */
export function withInstructionUpdates(
  data: InstructionUpdates,
  input: InstructionUpdatesUpdateInput,
): InstructionUpdates {
  const changes = new Map((input.entries ?? []).map((change) => [change.id, change.state]));
  return {
    mode: input.mode ?? data.mode,
    entries: data.entries.map((status) => {
      const state = changes.get(status.id);
      return state === undefined || status.state === "applied" ? status : { ...status, state };
    }),
  };
}

interface Store {
  data: InstructionUpdates | null;
  readonly listeners: Set<() => void>;
  stop: (() => void) | null;
  /** Bumped by every read and local change, so an older answer is dropped. */
  generation: number;
}

// One store per environment, shared by the bell and Settings.
const stores = new Map<EnvironmentId, Store>();

function storeFor(environmentId: EnvironmentId): Store {
  let store = stores.get(environmentId);
  if (store === undefined) {
    store = { data: null, listeners: new Set(), stop: null, generation: 0 };
    stores.set(environmentId, store);
  }
  return store;
}

function publish(store: Store, data: InstructionUpdates | null) {
  store.data = data;
  for (const listener of store.listeners) listener();
}

function load(environmentId: EnvironmentId) {
  const store = storeFor(environmentId);
  if (!readTasksWebAccess(environmentId).canReadTasks) return;
  const request = ++store.generation;
  readTasksWebClient(environmentId)
    .tasks.getInstructionUpdates({})
    .then(
      (data) => {
        if (request === store.generation) publish(store, data);
      },
      // A server from before instruction updates has none.
      () => undefined,
    );
}

function start(environmentId: EnvironmentId): () => void {
  let unsubscribeChanges: (() => void) | null = null;
  const follow = () => {
    if (unsubscribeChanges !== null || !readTasksWebAccess(environmentId).canReadTasks) return;
    unsubscribeChanges = readTasksWebClient(environmentId).tasks.subscribe((change) => {
      if (change.kind === "sync" || change.instructionUpdatesChanged) load(environmentId);
    });
    // A stream the Tasks list already opened sends this listener no sync of its own.
    load(environmentId);
  };
  follow();
  const stopAccess = subscribeTasksWebAccess(follow);
  return () => {
    stopAccess();
    unsubscribeChanges?.();
  };
}

function subscribe(environmentId: EnvironmentId, listener: () => void) {
  const store = storeFor(environmentId);
  store.listeners.add(listener);
  store.stop ??= start(environmentId);
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      store.stop?.();
      store.stop = null;
    }
  };
}

const noData = () => null;
const noSubscription = () => () => undefined;

/** An environment's instruction updates, kept current by its change stream. */
export function useInstructionUpdates(environmentId: EnvironmentId | null): InstructionUpdatesView {
  const subscribeTo = useCallback(
    (listener: () => void) =>
      environmentId === null ? noSubscription() : subscribe(environmentId, listener),
    [environmentId],
  );
  const read = useCallback(
    () => (environmentId === null ? null : storeFor(environmentId).data),
    [environmentId],
  );
  const data = useSyncExternalStore(subscribeTo, read, noData);
  return useMemo(() => instructionUpdatesView(data), [data]);
}

/** Saves the mode or entry states; the view follows at once and settles on the server's answer. */
export function updateInstructionUpdates(
  environmentId: EnvironmentId,
  input: InstructionUpdatesUpdateInput,
): Promise<void> {
  const store = storeFor(environmentId);
  const request = ++store.generation;
  if (store.data !== null) publish(store, withInstructionUpdates(store.data, input));
  return readTasksWebClient(environmentId)
    .tasks.updateInstructionUpdates(input)
    .then(
      (data) => {
        if (request === store.generation) publish(store, data);
      },
      (error: unknown) => {
        load(environmentId);
        throw error;
      },
    );
}
