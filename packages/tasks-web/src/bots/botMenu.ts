import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canBecomeBotChat } from "@t3tools/tasks-client/bots/bots";
import { msg } from "gt-react";
import { readThreadShell } from "../../../../apps/web/src/state/entities.ts";
import type {
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadAction,
} from "../../../../apps/web/src/product/WebFeature.ts";
import { readTasksWebAccess } from "../environmentApi.ts";
import { botPage, readShownBots } from "./botData.tsx";

/** Whether the thread is a bot's own chat, by the bot list as last shown. */
export function isBotChat({ environmentId, threadId }: ExperimentalWebThreadAccessoryProps) {
  return readShownBots(environmentId)?.some((bot) => bot.threadId === threadId) ?? false;
}

/** Uses the list the Bots sidebar section keeps, so the menu needs no request. */
export function botThreadActions({
  environmentId,
  threadId,
}: ExperimentalWebThreadAccessoryProps): ReadonlyArray<ExperimentalWebThreadAction> {
  if (!readTasksWebAccess(environmentId).canReadAgents) return [];
  const thread = readThreadShell(scopeThreadRef(environmentId, threadId));
  const bots = readShownBots(environmentId);
  if (!thread || bots === null || !canBecomeBotChat(thread, bots)) return [];
  return [
    {
      id: "turn-into-bot",
      label: msg("Turn into bot"),
      icon: "bot",
      run: ({ navigate }) => void navigate(botPage(environmentId, { thread: threadId })),
    },
  ];
}

export type BotRowMenuEntry = "settings" | "tasks";

/**
 * A bot row's context menu: the tasks menu its counts or tasks button open
 * for a person who may read tasks, then its settings. In the compact sidebar it is the way to
 * its hover actions.
 */
export function botRowMenuEntries(canReadTasks: boolean): ReadonlyArray<BotRowMenuEntry> {
  return canReadTasks ? ["tasks", "settings"] : ["settings"];
}
