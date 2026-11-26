import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react-native";

import { useComposerBots } from "./botsData";
import { botMentionText, matchMentionBots } from "./botState";

/** A bot in the composer's `@` menu; picking it writes the mention that addresses it. */
export interface BotComposerItem {
  readonly id: string;
  readonly type: "bot";
  readonly mention: string;
  readonly label: string;
  readonly description: string;
}

/**
 * The bots an existing thread's `@` menu offers, kept loaded while the composer is open. A
 * message that opens with the mention goes to that bot, as on the desktop.
 */
export function useBotComposerItems(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): (query: string) => ReadonlyArray<BotComposerItem> {
  const messages = useMessages();
  const bots = useComposerBots(threadId === null ? null : environmentId);
  return (query) =>
    threadId === null
      ? []
      : matchMentionBots(bots, threadId, query).map((bot) => ({
          id: `bot:${bot.agent.id}`,
          type: "bot" as const,
          mention: botMentionText(bot),
          label: bot.agent.name,
          description: messages(msg("Ask this bot here")),
        }));
}
