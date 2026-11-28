import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { withoutComposerRecipientChats } from "@t3tools/tasks-client/composerRecipients";
import { msg, useMessages } from "gt-react-native";
import { useMemo } from "react";

import { useProjects } from "../../state/entities";
import { useComposerBots } from "./botsData";
import { botMentionText, botsSharingName, matchMentionBots } from "./botState";

/** A bot in the composer's `@` menu; picking it writes the mention that addresses it. */
export interface BotComposerItem {
  readonly id: string;
  readonly type: "bot";
  readonly mention: string;
  readonly label: string;
  readonly description: string;
}

/**
 * The bots an existing thread's `@` menu offers, kept loaded while the composer is open, and the
 * thread rows to offer beside them: without the bots' own chats, which the bots stand for. A
 * message that opens with the mention goes to that bot, as on the desktop.
 */
export function useBotComposerItems(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  threadShells: ReadonlyArray<EnvironmentThreadShell>,
): {
  readonly items: (query: string) => ReadonlyArray<BotComposerItem>;
  readonly threadShells: ReadonlyArray<EnvironmentThreadShell>;
} {
  const messages = useMessages();
  const projects = useProjects();
  const bots = useComposerBots(environmentId);
  const shells = useMemo(
    () =>
      withoutComposerRecipientChats(
        threadShells,
        environmentId,
        bots.map((bot) => ({ chatThreadId: bot.threadId })),
      ),
    [threadShells, environmentId, bots],
  );
  // Bots that share a name show their project, which is often what tells them apart.
  const projectTitle = (projectId: string) =>
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.title;
  const items = (query: string) =>
    threadId === null
      ? []
      : matchMentionBots(bots, threadId, query).map((bot) => ({
          id: `bot:${bot.agent.id}`,
          type: "bot" as const,
          mention: botMentionText(bot, bots, threadId),
          label: bot.agent.name,
          description:
            (botsSharingName(bot, bots, threadId).length > 0
              ? projectTitle(bot.projectId)
              : undefined) ?? messages(msg("Ask this bot here")),
        }));
  return { items, threadShells: shells };
}
