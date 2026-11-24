import { useCallback, useMemo, useSyncExternalStore } from "react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { describeError } from "@t3tools/client-runtime/errors";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { gtFallback, msg, type useGT } from "gt-react";
import * as Schema from "effect/Schema";
import {
  defaultBotAppearance,
  type Bot,
  type BotAppearance,
  type TaskAgent,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { environmentThreadShells } from "../../../../apps/web/src/state/threads.ts";
import { appAtomRegistry } from "../../../../apps/web/src/rpc/atomRegistry.ts";
import { resolveThreadLastVisitedAt } from "../../../../apps/web/src/components/Sidebar.logic.ts";
import { useUiStateStore } from "../../../../apps/web/src/uiStateStore.ts";
import { ConfigurableBotCharacter } from "../../../../apps/web/src/components/bot-character-configurable/ConfigurableBotCharacter.tsx";
import { holdClientNotice } from "../../../../apps/web/src/sidebarNotifications/clientNotices.ts";
import { allSidebarThreadsClaimKey } from "../../../../apps/web/src/product/sidebarThreadClaims.ts";
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  subscribeTasksWebAccess,
  useTasksWebAccess,
} from "../environmentApi.ts";
import { isDisconnectError } from "../state/taskPageLoader.ts";
import { useOmittedThreadShell } from "../ui/useOmittedThreadShell.ts";
import {
  botChatStatus,
  botStatus,
  botTaskRunRequest,
  botTaskRunRequestStatus,
  botTaskStatus,
  type BotCharacterState,
} from "./botStatus.ts";

interface BotList {
  readonly bots: ReadonlyArray<Bot>;
  readonly loaded: boolean;
  /** The last load failed; Notifications says so. */
  readonly failed: boolean;
  /** The environment's server predates bots: it has no Bots section and no error. */
  readonly unsupported: boolean;
}

/**
 * One list per environment, shared by every mounted view, so a change costs one request
 * however many sidebars, headers and pages show bots. The last list stays after the views
 * unmount, so a newly mounted header knows at once whether its thread is a bot chat.
 */
interface BotListStore {
  list: BotList;
  readonly listeners: Set<() => void>;
  /** Counts publishes, so a snapshot can tell a changed list by value. */
  version: number;
  fetching: boolean;
  again: boolean;
  stopChanges: (() => void) | undefined;
  /** Holds the Notifications card while the list fails to load. */
  releaseNotice: (() => void) | undefined;
}

const EMPTY: BotList = { bots: [], loaded: false, failed: false, unsupported: false };
const stores = new Map<EnvironmentId, BotListStore>();

/** Each computer's bot chat thread ids as its last loaded list had them. */
export const BOT_CHATS_STORAGE_KEY = "upcomputer:bot-chats";
export const BotChats = Schema.Record(Schema.String, Schema.Array(Schema.String));

function rememberBotChats(environmentId: EnvironmentId, bots: ReadonlyArray<Bot>) {
  const threadIds = bots.map((bot) => bot.threadId);
  const remembered = readLocalStorageValue(BOT_CHATS_STORAGE_KEY, {}, BotChats)[environmentId];
  if (remembered?.join("\n") === threadIds.join("\n")) return;
  writeLocalStorageValue(
    BOT_CHATS_STORAGE_KEY,
    (current) => ({ ...current, [environmentId]: threadIds }),
    {},
    BotChats,
  );
}

/**
 * The computers whose bot list is loading, each with the chat thread ids its last loaded list
 * had (undefined when none is remembered). A computer whose Tasks access is still being checked
 * counts as loading: at startup that check comes first.
 */
function rememberedWhileLoading(
  environmentIds: ReadonlyArray<EnvironmentId>,
): Array<readonly [EnvironmentId, ReadonlyArray<string> | undefined]> {
  const loading = environmentIds.filter((environmentId) => {
    const access = readTasksWebAccess(environmentId);
    if (access.availability !== "loading" && !access.canReadAgents) return false;
    const { list } = storeFor(environmentId);
    return !list.loaded && !list.failed;
  });
  if (loading.length === 0) return [];
  const remembered = readLocalStorageValue(BOT_CHATS_STORAGE_KEY, {}, BotChats);
  return loading.map((environmentId) => [environmentId, remembered[environmentId]] as const);
}

/**
 * The scoped keys of the bot chats each computer had when its list last loaded, for those whose
 * list is loading again, so Threads does not list them until the Bots section does. A computer
 * with no remembered list claims all its threads (`allSidebarThreadsClaimKey`) until it loads.
 */
export function rememberedBotChatKeys(environmentIds: ReadonlyArray<EnvironmentId>): string[] {
  return rememberedWhileLoading(environmentIds).flatMap(([environmentId, threadIds]) =>
    // Nothing remembered, as on the first start after an update: any thread may be a bot chat.
    threadIds === undefined
      ? [allSidebarThreadsClaimKey(environmentId)]
      : threadIds.map((threadId) =>
          scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(threadId))),
        ),
  );
}

/**
 * How many bots the loading computers had when their lists last loaded, so the Bots section
 * keeps their room meanwhile. Null when none is loading or one has nothing remembered.
 */
export function rememberedBotCount(environmentIds: ReadonlyArray<EnvironmentId>): number | null {
  const loading = rememberedWhileLoading(environmentIds);
  if (loading.length === 0) return null;
  let count = 0;
  for (const [, threadIds] of loading) {
    if (threadIds === undefined) return null;
    count += threadIds.length;
  }
  return count;
}

type GT = ReturnType<typeof useGT>;

/** A failed bot action in plain words; the raw text goes behind Details. */
export const errorText = (error: unknown, gt: GT = gtFallback) => {
  const { reason } = describeError(error);
  return reason === undefined
    ? gt("Something went wrong. Try again.")
    : `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
};

/** The reason inside a sentence, such as "Couldn't save Nova's settings: <reason>." */
export const errorReason = (error: unknown, gt: GT = gtFallback) =>
  describeError(error).reason ?? gt("something went wrong");

/**
 * A server without the bots methods, such as another computer on an older version, rejects
 * the list as a defect naming the request tag it does not know.
 */
const isUnknownMethodError = (error: unknown) =>
  describeError(error).detail?.includes("Unknown request tag") === true;

/** The server's code for a failed bot action, which picks its title and action. */
export const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

function storeFor(environmentId: EnvironmentId) {
  let store = stores.get(environmentId);
  if (!store) {
    store = {
      list: EMPTY,
      version: 0,
      listeners: new Set(),
      fetching: false,
      again: false,
      stopChanges: undefined,
      releaseNotice: undefined,
    };
    stores.set(environmentId, store);
  }
  return store;
}

function releaseNotice(store: BotListStore) {
  store.releaseNotice?.();
  store.releaseNotice = undefined;
}

function publish(store: BotListStore, list: BotList) {
  store.list = list;
  store.version += 1;
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
    rememberBotChats(environmentId, bots);
    releaseNotice(store);
    publish(store, { bots, loaded: true, failed: false, unsupported: false });
  } catch (cause) {
    if (isUnknownMethodError(cause)) {
      releaseNotice(store);
      publish(store, { ...EMPTY, loaded: true, unsupported: true });
    } else {
      // A view that went away since the request no longer shows the list, and a computer that
      // went away is its outage card; its reconnect loads the list again.
      if (store.listeners.size > 0 && !isDisconnectError(cause)) {
        const previous = store.releaseNotice;
        store.releaseNotice = holdClientNotice(
          {
            id: "bots:list",
            environmentId,
            severity: "error",
            title: msg("Bots didn't load on {computer}"),
            message: msg("The list shows what it had before."),
            detail: describeError(cause).detail ?? String(cause),
          },
          () => void refresh(environmentId, store),
        );
        previous?.();
      }
      publish(store, { ...store.list, failed: true });
    }
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

/** Whether the environment's server answered that it predates bots. */
export function readBotsUnsupported(environmentId: EnvironmentId) {
  return stores.get(environmentId)?.list.unsupported === true;
}

/** The environment's bots as last shown; null before a list has loaded. */
export function readShownBots(environmentId: EnvironmentId) {
  const list = stores.get(environmentId)?.list;
  return list?.loaded ? list.bots : null;
}

export function subscribeBots(environmentId: EnvironmentId, listener: () => void) {
  const store = storeFor(environmentId);
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    // Bots change through this client's writes, which refresh on their own, or through agent and
    // run changes; task edits never do. A dropped stream keeps the last list without an error:
    // its reconnect resyncs, which also asks a server without bots again (it may have updated).
    // A stream that never connected still asks for the list, which loads or says it couldn't.
    store.stopChanges = readTasksWebClient(environmentId).tasks.subscribe(
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
      releaseNotice(store);
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
  return { ...list, enabled: enabled && !list.unsupported };
}

/** One computer's part of the Bots section. */
export interface BotSectionList {
  readonly environmentId: EnvironmentId;
  readonly bots: ReadonlyArray<Bot>;
  /** False while its first load failed: `bots` is then empty, not the computer's bots. */
  readonly loaded: boolean;
}

/** Follows the given computers' Tasks access and, where it allows, their bot lists. */
function useSubscribeBotSectionLists(environmentIds: ReadonlyArray<EnvironmentId>) {
  const key = environmentIds.join("\n");
  return useCallback(
    (listener: () => void) => {
      const ids = key ? (key.split("\n") as Array<EnvironmentId>) : [];
      // Lists are read only where Tasks access allows it, which can change while subscribed.
      const stops = new Map<EnvironmentId, () => void>();
      const follow = () => {
        for (const environmentId of ids) {
          const readable = readTasksWebAccess(environmentId).canReadAgents;
          const stop = stops.get(environmentId);
          if (readable && !stop) stops.set(environmentId, subscribeBots(environmentId, listener));
          if (!readable && stop) {
            stop();
            stops.delete(environmentId);
          }
        }
      };
      follow();
      const stopAccess = subscribeTasksWebAccess(() => {
        follow();
        listener();
      });
      return () => {
        stopAccess();
        for (const stop of stops.values()) stop();
      };
    },
    [key],
  );
}

/**
 * `rememberedBotChatKeys` as a store snapshot, one key per line, so it is read again when a
 * computer's access is decided or its list loads.
 */
export function useRememberedBotChatKeys(environmentIds: ReadonlyArray<EnvironmentId>): string {
  const subscribe = useSubscribeBotSectionLists(environmentIds);
  const read = () => rememberedBotChatKeys(environmentIds).join("\n");
  return useSyncExternalStore(subscribe, read, read);
}

export function useRememberedBotCount(environmentIds: ReadonlyArray<EnvironmentId>): number | null {
  const subscribe = useSubscribeBotSectionLists(environmentIds);
  const read = () => rememberedBotCount(environmentIds);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The lists, in the given environments' order, that the one Bots section merges: those that
 * answered, or failed in a way worth showing. One still loading or whose server predates bots
 * adds nothing.
 */
export function useBotSectionLists(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<BotSectionList> {
  const subscribe = useSubscribeBotSectionLists(environmentIds);
  const read = () =>
    environmentIds
      .flatMap((environmentId) => {
        if (!readTasksWebAccess(environmentId).canReadAgents) return [];
        const store = storeFor(environmentId);
        const { list } = store;
        return !list.unsupported && (list.loaded || list.failed)
          ? [`${environmentId}\t${store.version}`]
          : [];
      })
      .join("\n");
  const shown = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () =>
      shown
        ? shown.split("\n").map((entry) => {
            const environmentId = entry.slice(0, entry.lastIndexOf("\t")) as EnvironmentId;
            const { bots, loaded } = storeFor(environmentId).list;
            return { environmentId, bots, loaded };
          })
        : [],
    [shown],
  );
}

/** Navigation to a bot's page: an existing bot, a chat to turn into one, or a new bot. */
export function botPage(
  environmentId: EnvironmentId,
  target: { readonly bot: TaskAgentId } | { readonly thread: ThreadId } | null = null,
) {
  return { to: "/bots", search: { environment: environmentId, ...target } } as never;
}

/** A bot's own agent: its one trigger is the tag the bot was saved with. */
export const isBotAgent = (agent: Pick<TaskAgent, "id" | "startTags">) =>
  agent.startTags.length === 1 && agent.startTags[0] === `bot:${agent.id}`;

/**
 * The bot's shape character. Portraits are hidden for now, so every bot draws its character,
 * and a bot that never chose a look draws the one its id derives.
 */
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
    <ConfigurableBotCharacter
      appearance={appearance ?? defaultBotAppearance(id)}
      state={state}
      // The character leaves more room around its body than a portrait does, so it is
      // drawn a fifth larger to look the same size.
      size={Math.round(size * 1.2)}
      decorative
    />
  );
}

const noRequest = () => null;

/**
 * Whether a run of a task from the bot's chat waits for an approval or an answer. Reads only
 * the shells of the runs the bot list names, and re-renders only when the answer changes.
 */
function useBotTaskRunRequest(environmentId: EnvironmentId, bot: Bot | undefined) {
  const key = (bot?.activeTaskRunThreadIds ?? []).join("\n");
  const atoms = useMemo(
    () =>
      (key ? key.split("\n") : []).map((threadId) =>
        environmentThreadShells.threadShellAtom(
          scopeThreadRef(environmentId, ThreadId.make(threadId)),
        ),
      ),
    [environmentId, key],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = atoms.map((atom) => appAtomRegistry.subscribe(atom, listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [atoms],
  );
  const read = useCallback(
    () => botTaskRunRequest(atoms.map((atom) => appAtomRegistry.get(atom))),
    [atoms],
  );
  return botTaskRunRequestStatus(useSyncExternalStore(subscribe, read, noRequest));
}

export function useBotStatus(environmentId: EnvironmentId, bot: Bot | undefined) {
  const chatRef = bot ? scopeThreadRef(environmentId, bot.threadId) : null;
  const thread = useThreadShell(chatRef);
  const localLastVisitedAt = useUiStateStore((state) =>
    chatRef ? state.threadLastVisitedAtById[scopedThreadKey(chatRef)] : undefined,
  );
  // A finished run's thread is not in the shell; only a failure reads it, for its error class.
  const background = useOmittedThreadShell(
    bot?.latestTaskRun ? scopeThreadRef(environmentId, bot.latestTaskRun.threadId) : null,
    bot?.latestTaskRun?.status === "failed",
  );
  const taskRunRequest = useBotTaskRunRequest(environmentId, bot);
  const lastVisitedAt = thread
    ? resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt)
    : undefined;
  return botStatus(
    botChatStatus(thread ? { ...thread, lastVisitedAt } : null),
    botTaskStatus(bot?.latestTaskRun?.status, background, {
      completedAt: bot?.latestTaskRun?.completedAt,
      lastVisitedAt,
    }),
    taskRunRequest,
  );
}
