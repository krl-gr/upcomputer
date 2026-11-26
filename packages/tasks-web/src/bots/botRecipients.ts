import type { EnvironmentId } from "@t3tools/contracts";
import { BOTS_RPC_METHODS } from "@t3tools/tasks-contracts/v1";
import { addressableBots } from "@t3tools/tasks-client/bots/bots";
import { msg } from "gt-react";
import { BotIcon } from "lucide-react";
import { m } from "../../../../apps/web/src/i18n/messages.ts";
import { newMessageId } from "../../../../apps/web/src/lib/utils.ts";
import {
  readExperimentalFeatureRpcPermission,
  subscribeExperimentalFeatureRpcPermission,
} from "../../../../apps/web/src/extensionApi.ts";
import type {
  ExperimentalWebComposerRecipient,
  ExperimentalWebComposerRecipientContext,
} from "../../../../apps/web/src/product/WebFeature.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  subscribeTasksWebAccess,
} from "../environmentApi.ts";
import { readShownBots, subscribeBots } from "./botData.tsx";

export { addressableBots };

/**
 * Follows the environment's bot list and mention permission while a composer is open, so `@`
 * offers the bots with the sidebar closed or showing other computers, and reacts when session
 * scopes settle. The list is the one the Bots section shares.
 */
export function subscribeBotRecipients(environmentId: EnvironmentId, onChange: () => void) {
  let stopBots: (() => void) | undefined;
  const sync = (notify: boolean) => {
    const canRead = readTasksWebAccess(environmentId).canReadAgents;
    if (canRead && stopBots === undefined) stopBots = subscribeBots(environmentId, onChange);
    if (!canRead && stopBots !== undefined) {
      stopBots();
      stopBots = undefined;
    }
    if (notify) onChange();
  };
  const stopAccess = subscribeTasksWebAccess(() => sync(true));
  const stopPermission = subscribeExperimentalFeatureRpcPermission(
    environmentId,
    BOTS_RPC_METHODS.mention,
    onChange,
  );
  sync(false);
  return () => {
    stopAccess();
    stopPermission();
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
    !readExperimentalFeatureRpcPermission(environmentId, BOTS_RPC_METHODS.mention)
  ) {
    return [];
  }
  return addressableBots(readShownBots(environmentId) ?? [], threadId).map((bot) => ({
    id: bot.agent.id,
    name: bot.agent.name,
    description: m(msg("Ask this bot here")),
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
