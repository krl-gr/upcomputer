import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { readThreadShell } from "../../../../apps/web/src/state/entities.ts";
import type {
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadAction,
} from "../../../../apps/web/src/product/WebFeature.ts";
import { readTasksWebAccess } from "../environmentApi.ts";
import { botPage, readShownBots } from "./botData.tsx";

/**
 * Whether a thread may be offered as a bot's chat. This leaves out what the server always
 * refuses: hidden threads such as task runs, subagents, archived chats and chats a bot
 * already owns. A busy chat is offered, and the bot page explains why it must wait.
 */
export function canBecomeBotChat(
  thread: Pick<
    EnvironmentThreadShell,
    "id" | "sidebarHidden" | "archivedAt" | "deletedAt" | "lineage"
  >,
  bots: ReadonlyArray<Pick<Bot, "threadId" | "latestTaskRun">>,
) {
  return (
    thread.sidebarHidden !== true &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    thread.lineage.relationshipToParent !== "subagent" &&
    !bots.some((bot) => bot.threadId === thread.id || bot.latestTaskRun?.threadId === thread.id)
  );
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
      label: "Turn into bot",
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
