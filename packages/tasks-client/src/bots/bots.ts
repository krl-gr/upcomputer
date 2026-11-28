import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import type { Bot, TaskAgent } from "@t3tools/tasks-contracts/v1";

/** A bot's own agent: its one trigger is the tag the bot was saved with. */
export const isBotAgent = (agent: Pick<TaskAgent, "id" | "startTags">) =>
  agent.startTags.length === 1 && agent.startTags[0] === `bot:${agent.id}`;

/** The bots a chat's `@` offers: all of them but the chat's own bot, which is written to as is. */
export const addressableBots = <B extends Pick<Bot, "threadId">>(
  bots: ReadonlyArray<B>,
  threadId: ThreadId | null,
) => bots.filter((bot) => bot.threadId !== threadId);

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
