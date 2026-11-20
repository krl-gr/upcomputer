import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { StartThreadTurnInput } from "@t3tools/client-runtime/operations";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { BotIcon } from "lucide-react";
import { newMessageId } from "../../../../apps/web/src/lib/utils.ts";
import { appAtomRegistry } from "../../../../apps/web/src/rpc/atomRegistry.ts";
import { readThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { readEnvironmentScope } from "../../../../apps/web/src/state/session.ts";
import { threadEnvironment } from "../../../../apps/web/src/state/threads.ts";
import type {
  ExperimentalWebComposerRecipient,
  ExperimentalWebComposerRecipientContext,
} from "../../../../apps/web/src/product/WebFeature.ts";
import { readTasksWebAccess } from "../environmentApi.ts";
import { readShownBots } from "./botData.tsx";

/** The bots a chat's `@` offers: all of them but the chat's own bot, which is written to as is. */
export const addressableBots = <B extends Pick<Bot, "threadId">>(
  bots: ReadonlyArray<B>,
  threadId: ThreadId | null,
) => bots.filter((bot) => bot.threadId !== threadId);

/**
 * The person's text in the bot's chat, as if typed there: with the chat's own model and modes,
 * starting a turn when the bot is idle and queued behind its turn when it is busy.
 */
export const botMessageTurn = (input: {
  readonly environmentId: EnvironmentId;
  readonly bot: Pick<Bot, "threadId">;
  readonly chat: Pick<EnvironmentThreadShell, "runtimeMode" | "interactionMode">;
  readonly text: string;
  readonly messageId: MessageId;
  readonly createdAt: string;
}): { readonly environmentId: EnvironmentId; readonly input: StartThreadTurnInput } => ({
  environmentId: input.environmentId,
  input: {
    threadId: input.bot.threadId,
    message: { messageId: input.messageId, role: "user", text: input.text, attachments: [] },
    runtimeMode: input.chat.runtimeMode,
    interactionMode: input.chat.interactionMode,
    dispatchMode: "queue",
    createdAt: input.createdAt,
  },
});

async function sendToBot(environmentId: EnvironmentId, bot: Bot, text: string) {
  const chat = readThreadShell(scopeThreadRef(environmentId, bot.threadId));
  if (chat === null) throw new Error(`${bot.agent.name}'s chat has not loaded yet. Try again.`);
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.startTurn,
    botMessageTurn({
      environmentId,
      bot,
      chat,
      text,
      messageId: newMessageId(),
      createdAt: new Date().toISOString(),
    }),
    { reportFailure: false },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
}

/** Uses the list the Bots sidebar section keeps, so typing `@` needs no request. */
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
    description: "Send to this bot's chat",
    icon: BotIcon,
    send: (text) => sendToBot(environmentId, bot, text),
    open: ({ navigate }) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: bot.threadId },
      }),
  }));
}
