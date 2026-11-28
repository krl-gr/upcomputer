import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createBotLists } from "@t3tools/tasks-client/bots/botList";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { readTasksAccess, readTasksClient, subscribeTasksAccess } from "../tasks/tasksRpc";
import { botChatKeys, botSectionOf, type BotSection } from "./botState";

/** Bots ship on iOS first; Android keeps upstream's screens until it is tested. */
export const BOTS_ON_THIS_PLATFORM = Platform.OS === "ios";

const NO_ENVIRONMENTS: ReadonlyArray<EnvironmentId> = [];

/** Each computer's bot list, shared by the Bots section and the composer's `@` menu. */
export const botLists = createBotLists({ client: readTasksClient });

const ids = (key: string) => (key ? (key.split("\n") as Array<EnvironmentId>) : []);

/** Follows the computers' Tasks access and, where it allows, their bot lists. */
function useSubscribeBotLists(key: string) {
  return useCallback(
    (listener: () => void) => {
      const stops = new Map<EnvironmentId, () => void>();
      const follow = () => {
        for (const environmentId of ids(key)) {
          const readable = readTasksAccess(environmentId).canReadAgents;
          const stop = stops.get(environmentId);
          if (readable && !stop)
            stops.set(environmentId, botLists.subscribe(environmentId, listener));
          if (!readable && stop) {
            stop();
            stops.delete(environmentId);
          }
        }
      };
      follow();
      const stopAccess = subscribeTasksAccess(() => {
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

/** The given computers' parts of the Bots section, in their order. */
export function useBotSections(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<BotSection> {
  const key = (BOTS_ON_THIS_PLATFORM ? environmentIds : NO_ENVIRONMENTS).join("\n");
  const subscribe = useSubscribeBotLists(key);
  const read = () =>
    ids(key)
      .map(
        (environmentId) =>
          `${readTasksAccess(environmentId).availability}\t${botLists.version(environmentId)}`,
      )
      .join("\n");
  const snapshot = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () =>
      ids(key).flatMap((environmentId, index) => {
        const availability = snapshot.split("\n")[index]?.split("\t")[0] as
          | "loading"
          | "unavailable"
          | "enabled";
        const section = botSectionOf(environmentId, availability, botLists.read(environmentId));
        return section === null ? [] : [section];
      }),
    [key, snapshot],
  );
}

/** Chats without the bot chats, which the Bots section lists, as on the desktop. */
export function useWithoutBotChats(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentThreadShell> {
  const sections = useBotSections(environmentIds);
  const chats = useMemo(() => botChatKeys(sections), [sections]);
  return useMemo(
    () =>
      chats.size === 0
        ? threads
        : threads.filter((thread) => !chats.has(scopedThreadKey(thread.environmentId, thread.id))),
    [chats, threads],
  );
}

const NO_BOTS: ReadonlyArray<Bot> = [];

/** One computer's bots for the composer, kept loaded while it is open. */
export function useComposerBots(environmentId: EnvironmentId | null): ReadonlyArray<Bot> {
  const sections = useBotSections(environmentId === null ? [] : [environmentId]);
  const section = sections[0];
  return section?.state === "ready" ? section.bots : NO_BOTS;
}

/** The bot whose chat this thread is, once its computer's bot list has loaded. */
export function useThreadBot(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): Bot | null {
  const bots = useComposerBots(threadId === null ? null : environmentId);
  return threadId === null ? null : (bots.find((bot) => bot.threadId === threadId) ?? null);
}
