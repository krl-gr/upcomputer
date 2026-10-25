import { useCallback, useSyncExternalStore } from "react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  defaultBotPortrait,
  type Bot,
  type BotAppearance,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { resolveThreadLastVisitedAt } from "../../../../apps/web/src/components/Sidebar.logic.ts";
import { useUiStateStore } from "../../../../apps/web/src/uiStateStore.ts";
import { readTasksWebClient, useTasksWebAccess } from "../environmentApi.ts";
import { botChatStatus, botStatus, botTaskStatus, type BotCharacterState } from "./botStatus.ts";
import { BotPortrait } from "./portraits/BotPortrait.tsx";

interface BotList {
  readonly bots: ReadonlyArray<Bot>;
  readonly loaded: boolean;
  readonly error: string;
}

/**
 * One list per environment, shared by every mounted view, so a change costs one request
 * however many sidebars, headers and pages show bots. The last list stays after the views
 * unmount, so a newly mounted header knows at once whether its thread is a bot chat.
 */
interface BotListStore {
  list: BotList;
  readonly listeners: Set<() => void>;
  fetching: boolean;
  again: boolean;
  stopChanges: (() => void) | undefined;
}

const EMPTY: BotList = { bots: [], loaded: false, error: "" };
const stores = new Map<EnvironmentId, BotListStore>();

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Bot operation failed.";

function storeFor(environmentId: EnvironmentId) {
  let store = stores.get(environmentId);
  if (!store) {
    store = {
      list: EMPTY,
      listeners: new Set(),
      fetching: false,
      again: false,
      stopChanges: undefined,
    };
    stores.set(environmentId, store);
  }
  return store;
}

function publish(store: BotListStore, list: BotList) {
  store.list = list;
  for (const listener of store.listeners) listener();
}

async function refresh(environmentId: EnvironmentId, store: BotListStore) {
  if (store.fetching) {
    store.again = true;
    return;
  }
  store.fetching = true;
  try {
    const bots = await readTasksWebClient(environmentId).bots.list({});
    publish(store, { bots, loaded: true, error: "" });
  } catch (cause) {
    publish(store, { ...store.list, error: errorText(cause) });
  } finally {
    store.fetching = false;
  }
  if (store.again) {
    store.again = false;
    await refresh(environmentId, store);
  }
}

/** Refetches every shown bot list after a write from this client. */
export function botsChanged() {
  for (const [environmentId, store] of stores)
    if (store.listeners.size > 0) void refresh(environmentId, store);
}

/** The environment's bots as last shown; null before a list has loaded. */
export function readShownBots(environmentId: EnvironmentId) {
  const list = stores.get(environmentId)?.list;
  return list?.loaded ? list.bots : null;
}

function subscribeBots(environmentId: EnvironmentId, listener: () => void) {
  const store = storeFor(environmentId);
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    // Bots change through this client's writes, which refresh on their own; other clients
    // and background runs reach the list through run changes. Task edits never do.
    store.stopChanges = readTasksWebClient(environmentId).tasks.subscribe(
      (change) => {
        if (change.kind === "sync" || change.runsChanged) void refresh(environmentId, store);
      },
      (cause) => publish(store, { ...store.list, error: errorText(cause) }),
    );
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      store.stopChanges?.();
      store.stopChanges = undefined;
    }
  };
}

const noBots = () => () => {};

export function useBots(environmentId: EnvironmentId) {
  const access = useTasksWebAccess(environmentId);
  const enabled = access.canReadAgents;
  // A new subscribe function would resubscribe, and the last unsubscribe closes the stream.
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? subscribeBots(environmentId, listener) : noBots()),
    [environmentId, enabled],
  );
  const list = useSyncExternalStore(
    subscribe,
    () => (enabled ? storeFor(environmentId).list : EMPTY),
    () => EMPTY,
  );
  return { ...list, enabled };
}

/** Navigation to a bot's page: an existing bot, a chat to turn into one, or a new bot. */
export function botPage(
  environmentId: EnvironmentId,
  target: { readonly bot: TaskAgentId } | { readonly thread: ThreadId } | null = null,
) {
  return { to: "/bots", search: { environment: environmentId, ...target } } as never;
}

/** The picked portrait, or the one the bot's id derives for bots that never picked one. */
export function BotAvatar({
  id,
  appearance,
  state,
  size,
}: {
  readonly id: string;
  readonly appearance: BotAppearance | null | undefined;
  readonly state: BotCharacterState;
  readonly size: number;
}) {
  return (
    <BotPortrait
      portrait={appearance?.portrait ?? defaultBotPortrait(id)}
      working={state === "working"}
      size={size}
    />
  );
}

export function useBotStatus(environmentId: EnvironmentId, bot: Bot | undefined) {
  const chatRef = bot ? scopeThreadRef(environmentId, bot.threadId) : null;
  const thread = useThreadShell(chatRef);
  const localLastVisitedAt = useUiStateStore((state) =>
    chatRef ? state.threadLastVisitedAtById[scopedThreadKey(chatRef)] : undefined,
  );
  const background = useThreadShell(
    bot?.latestTaskRun ? scopeThreadRef(environmentId, bot.latestTaskRun.threadId) : null,
  );
  const lastVisitedAt = thread
    ? resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt)
    : undefined;
  return botStatus(
    botChatStatus(thread ? { ...thread, lastVisitedAt } : null),
    botTaskStatus(bot?.latestTaskRun?.status, background, {
      completedAt: bot?.latestTaskRun?.completedAt,
      lastVisitedAt,
    }),
  );
}
