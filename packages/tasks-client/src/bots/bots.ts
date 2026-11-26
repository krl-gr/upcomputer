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
