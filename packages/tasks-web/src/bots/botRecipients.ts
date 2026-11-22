import { AuthOrchestrationOperateScope, type ThreadId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { BotIcon } from "lucide-react";
import { newMessageId } from "../../../../apps/web/src/lib/utils.ts";
import { readEnvironmentScope } from "../../../../apps/web/src/state/session.ts";
import type {
  ExperimentalWebComposerRecipient,
  ExperimentalWebComposerRecipientContext,
} from "../../../../apps/web/src/product/WebFeature.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  subscribeTasksWebAccess,
} from "../environmentApi.ts";
import { readShownBots, subscribeBots } from "./botData.tsx";

/** The bots a chat's `@` offers: all of them but the chat's own bot, which is written to as is. */
export const addressableBots = <B extends Pick<Bot, "threadId">>(
  bots: ReadonlyArray<B>,
  threadId: ThreadId | null,
) => bots.filter((bot) => bot.threadId !== threadId);

/**
 * Follows the environment's bot list while a composer is open, so `@` offers the bots with the
 * sidebar closed or showing other computers. The list is the one the Bots section shares.
 */
export function subscribeBotRecipients(environmentId: EnvironmentId, onChange: () => void) {
  let stopBots: (() => void) | undefined;
  const sync = () => {
    const canRead = readTasksWebAccess(environmentId).canReadAgents;
    if (canRead && stopBots === undefined) stopBots = subscribeBots(environmentId, onChange);
    if (!canRead && stopBots !== undefined) {
      stopBots();
      stopBots = undefined;
    }
    onChange();
  };
  const stopAccess = subscribeTasksWebAccess(sync);
  sync();
  return () => {
    stopAccess();
    stopBots?.();
  };
}

/**
 * Reads the shared bot list, so typing `@` needs no request. The message
 * goes to the bot's chat, queued behind a busy turn, and the server posts the bot's reply back
 * in the chat it was sent from.
 */
export function botComposerRecipients({
  environmentId,
  threadId,
}: ExperimentalWebComposerRecipientContext): ReadonlyArray<ExperimentalWebComposerRecipient> {
  if (
    !readTasksWebAccess(environmentId).canReadAgents ||
    !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
  ) {
    return [];
  }
  return addressableBots(readShownBots(environmentId) ?? [], threadId).map((bot) => ({
    id: bot.agent.id,
    name: bot.agent.name,
    description: "Ask this bot here",
    icon: BotIcon,
    chatThreadId: bot.threadId,
    send: (text) =>
      readTasksWebClient(environmentId).bots.mention({
        agentId: bot.agent.id,
        threadId: threadId ?? bot.threadId,
        messageId: newMessageId(),
        text,
      }),
    open: ({ navigate }) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: bot.threadId },
      }),
  }));
}
