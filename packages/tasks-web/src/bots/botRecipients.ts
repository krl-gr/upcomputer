import { AuthOrchestrationOperateScope, type ThreadId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { BotIcon } from "lucide-react";
import { newMessageId } from "../../../../apps/web/src/lib/utils.ts";
import { readEnvironmentScope } from "../../../../apps/web/src/state/session.ts";
import type {
  ExperimentalWebComposerRecipient,
  ExperimentalWebComposerRecipientContext,
} from "../../../../apps/web/src/product/WebFeature.ts";
import { readTasksWebAccess, readTasksWebClient } from "../environmentApi.ts";
import { readShownBots } from "./botData.tsx";

/** The bots a chat's `@` offers: all of them but the chat's own bot, which is written to as is. */
export const addressableBots = <B extends Pick<Bot, "threadId">>(
  bots: ReadonlyArray<B>,
  threadId: ThreadId | null,
) => bots.filter((bot) => bot.threadId !== threadId);

/**
 * Uses the list the Bots sidebar section keeps, so typing `@` needs no request. The message
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
