import { describeError } from "@t3tools/client-runtime/errors";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import { isDisconnectError } from "../state/taskPageLoader.ts";

export interface BotList {
  readonly bots: ReadonlyArray<Bot>;
  readonly loaded: boolean;
  /** The last load failed; the list keeps what it had. */
  readonly failed: boolean;
  /** The environment's server predates bots: it has no Bots section and no error. */
  readonly unsupported: boolean;
}

export const EMPTY_BOT_LIST: BotList = {
  bots: [],
  loaded: false,
  failed: false,
  unsupported: false,
};

/**
 * A server without the bots methods, such as another computer on an older version, rejects
 * the list as a defect naming the request tag it does not know.
 */
export const isUnknownMethodError = (error: unknown) =>
  describeError(error).detail?.includes("Unknown request tag") === true;

export interface BotListsOptions {
  readonly client: (environmentId: EnvironmentId) => {
    readonly bots: Pick<TasksWebRpcClient["bots"], "list">;
    readonly tasks: Pick<TasksWebRpcClient["tasks"], "subscribe">;
  };
  readonly onLoad?: (environmentId: EnvironmentId, bots: ReadonlyArray<Bot>) => void;
  /** A load failed while the list is shown, and not because the computer went away. */
  readonly onFailure?: (environmentId: EnvironmentId, cause: unknown, retry: () => void) => void;
  /** The list loaded, turned out unsupported, or is no longer shown: a failure no longer stands. */
  readonly onSettle?: (environmentId: EnvironmentId) => void;
}

interface BotListStore {
  list: BotList;
  readonly listeners: Set<() => void>;
  /** Counts publishes, so a snapshot can tell a changed list by value. */
  version: number;
  fetching: boolean;
  again: boolean;
  stopChanges: (() => void) | undefined;
}

/**
 * One bot list per environment, shared by every view that shows bots, so a change costs one
 * request however many show them. The last list stays after the views go away, so a view
 * that opens later knows at once whether a thread is a bot chat.
 */
export function createBotLists(options: BotListsOptions) {
  const stores = new Map<EnvironmentId, BotListStore>();

  const storeFor = (environmentId: EnvironmentId) => {
    let store = stores.get(environmentId);
    if (!store) {
      store = {
        list: EMPTY_BOT_LIST,
        version: 0,
        listeners: new Set(),
        fetching: false,
        again: false,
        stopChanges: undefined,
      };
      stores.set(environmentId, store);
    }
    return store;
  };

  const publish = (store: BotListStore, list: BotList) => {
    store.list = list;
    store.version += 1;
    for (const listener of store.listeners) listener();
  };

  const refresh = async (environmentId: EnvironmentId, store: BotListStore): Promise<void> => {
    if (store.fetching) {
      store.again = true;
      return;
    }
    store.fetching = true;
    try {
      const bots = await options.client(environmentId).bots.list({});
      options.onLoad?.(environmentId, bots);
      options.onSettle?.(environmentId);
      publish(store, { bots, loaded: true, failed: false, unsupported: false });
    } catch (cause) {
      if (isUnknownMethodError(cause)) {
        options.onSettle?.(environmentId);
        publish(store, { ...EMPTY_BOT_LIST, loaded: true, unsupported: true });
      } else {
        // A view that went away no longer shows the list, and a computer that went away
        // reports its own outage; its reconnect loads the list again.
        if (store.listeners.size > 0 && !isDisconnectError(cause))
          options.onFailure?.(environmentId, cause, () => void refresh(environmentId, store));
        publish(store, { ...store.list, failed: true });
      }
    } finally {
      store.fetching = false;
    }
    if (store.again) {
      store.again = false;
      await refresh(environmentId, store);
    }
  };

  return {
    /** The environment's list as last loaded. */
    read: (environmentId: EnvironmentId): BotList =>
      stores.get(environmentId)?.list ?? EMPTY_BOT_LIST,
    /** Changes whenever the environment's list is published again. */
    version: (environmentId: EnvironmentId) => stores.get(environmentId)?.version ?? 0,
    /** The environment's bots as last shown; null before a list has loaded. */
    readShown: (environmentId: EnvironmentId) => {
      const list = stores.get(environmentId)?.list;
      return list?.loaded ? list.bots : null;
    },
    /** Refetches every shown list, after a write from this client. */
    refreshShown: () => {
      for (const [environmentId, store] of stores)
        if (store.listeners.size > 0) void refresh(environmentId, store);
    },
    subscribe: (environmentId: EnvironmentId, listener: () => void) => {
      const store = storeFor(environmentId);
      store.listeners.add(listener);
      if (store.listeners.size === 1) {
        // Bots change through this client's writes, which refresh on their own, or through agent
        // and run changes; task edits never do. A dropped stream keeps the last list without an
        // error: its reconnect resyncs, which also asks a server without bots again (it may have
        // updated). A stream that never connected still asks, so the list loads or says it failed.
        store.stopChanges = options.client(environmentId).tasks.subscribe(
          (change) => {
            if (
              change.kind === "sync" ||
              (!store.list.unsupported && (change.runsChanged || change.agentsChanged))
            )
              void refresh(environmentId, store);
          },
          () => {
            if (!store.list.loaded) void refresh(environmentId, store);
          },
        );
      }
      return () => {
        store.listeners.delete(listener);
        if (store.listeners.size === 0) {
          store.stopChanges?.();
          store.stopChanges = undefined;
          options.onSettle?.(environmentId);
        }
      };
    },
  };
}

export type BotLists = ReturnType<typeof createBotLists>;
