import { StackActions } from "@react-navigation/native";
import { MessageId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { msg } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { uuidv4 } from "../../lib/uuid";
import { readTasksClient } from "../tasks/tasksRpc";
import { botLists } from "./botsData";
import { botMentionMessage } from "./botState";

const sendingThreads = new Set<string>();

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Sends a draft that opens with `@Bot` to that bot instead of this thread, as the desktop's
 * composer does. Null when the draft is for this thread; "sent" clears the draft, and
 * "refused" keeps it after saying why.
 */
export async function sendBotMention(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draft: string;
  readonly hasAttachments: boolean;
  readonly openChat: (bot: Bot) => void;
}): Promise<"sent" | "refused" | null> {
  const message = botMentionMessage({
    draft: input.draft,
    hasAttachments: input.hasAttachments,
    bots: botLists.readShown(input.environmentId) ?? [],
    threadId: input.threadId,
  });
  if (message === null) return null;
  if (message.kind === "several") {
    Dialog.alert(
      m(msg("Mention one bot per message")),
      m(
        msg("This message mentions {names}. Send each its own message.", {
          names: message.bots.map((bot) => `@${bot.agent.name}`).join(", "),
        }),
      ),
    );
    return "refused";
  }
  const mention = `@${message.bot.agent.name}`;
  if (message.kind === "attachments") {
    Dialog.alert(
      m(msg("Messages to {mention} take text only", { mention })),
      m(msg("Remove the attachments, then send it again.")),
    );
    return "refused";
  }
  if (message.kind === "empty") {
    Dialog.alert(m(msg("Write a message after {mention}", { mention })));
    return "refused";
  }
  const key = `${input.environmentId}:${input.threadId}`;
  if (sendingThreads.has(key)) return "refused";
  sendingThreads.add(key);
  let repliesHere: boolean;
  try {
    ({ repliesHere } = await readTasksClient(input.environmentId).bots.mention({
      agentId: message.bot.agent.id,
      threadId: input.threadId,
      messageId: MessageId.make(uuidv4()),
      text: message.text,
    }));
  } catch (cause) {
    Dialog.alert(m(msg("Couldn't send to {mention}", { mention })), errorText(cause));
    return "refused";
  } finally {
    sendingThreads.delete(key);
  }
  // This chat shows the message and, later, the reply.
  if (repliesHere) return "sent";
  Dialog.alert(m(msg("Sent to {mention}", { mention })), m(msg("It answers in its own chat.")), [
    { text: m(msg("OK")), style: "cancel" },
    { text: m(msg("Open chat")), onPress: () => input.openChat(message.bot) },
  ]);
  return "sent";
}

/**
 * The composer's send hook: routes a draft that opens with `@Bot` to that bot. True when the
 * draft was handled here, sent or refused, so the composer does not send it to this thread.
 */
export async function routeBotMention(input: {
  /** Drafts, queued edits and approval answers always go to this thread. */
  readonly blocked: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draft: string;
  readonly hasAttachments: boolean;
  readonly navigation: {
    readonly dispatch: (action: ReturnType<typeof StackActions.push>) => void;
  };
  readonly onSent: () => void;
}): Promise<boolean> {
  if (input.blocked) return false;
  const result = await sendBotMention({
    ...input,
    openChat: (bot) =>
      input.navigation.dispatch(
        StackActions.push("Thread", {
          environmentId: String(input.environmentId),
          threadId: String(bot.threadId),
        }),
      ),
  });
  if (result === "sent") input.onSent();
  return result !== null;
}
