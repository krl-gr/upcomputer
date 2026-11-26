import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import type { BotList } from "@t3tools/tasks-client/bots/botList";
import { addressableBots } from "@t3tools/tasks-client/bots/bots";
import {
  botTaskRunRequest,
  botTaskRunRequestStatus,
  botTaskStatus,
  topBotStatus,
  type BotStatusCandidate,
} from "@t3tools/tasks-client/bots/botStatus";
import {
  composerRecipientMention,
  matchComposerRecipients,
  parseComposerRecipientMessage,
} from "@t3tools/tasks-client/composerRecipients";
import { botMemoryContext, type Bot, type BotMemory } from "@t3tools/tasks-contracts/v1";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { resolveThreadListV2RowStatus, threadHasUnseenCompletion } from "../threads/threadListV2";

/** One computer's bots, or where its list stands. */
export type BotSection =
  | { readonly environmentId: EnvironmentId; readonly state: "loading" }
  | { readonly environmentId: EnvironmentId; readonly state: "failed" }
  | {
      readonly environmentId: EnvironmentId;
      readonly state: "ready";
      readonly bots: ReadonlyArray<Bot>;
    };

/**
 * A computer's part of the Bots section. A computer without Tasks, or whose server predates
 * bots, has none; a list that loaded once keeps showing through a later failure.
 */
export function botSectionOf(
  environmentId: EnvironmentId,
  availability: "loading" | "unavailable" | "enabled",
  list: BotList,
): BotSection | null {
  if (availability === "unavailable" || list.unsupported) return null;
  if (list.loaded) return { environmentId, state: "ready", bots: list.bots };
  if (availability === "enabled" && list.failed) return { environmentId, state: "failed" };
  return { environmentId, state: "loading" };
}

export interface ShownBot {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
}

/**
 * The bots the Chats list shows: those in the chosen project, when one is chosen, whose name
 * matches the search.
 */
export function shownBots(
  sections: ReadonlyArray<BotSection>,
  filter: {
    readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null;
    readonly query: string;
  },
): ReadonlyArray<ShownBot> {
  const query = filter.query.trim().toLocaleLowerCase();
  return sections.flatMap((section) =>
    section.state !== "ready"
      ? []
      : section.bots
          .filter(
            (bot) =>
              (filter.projectRefs === null ||
                filter.projectRefs.some(
                  (ref) =>
                    ref.environmentId === section.environmentId && ref.projectId === bot.projectId,
                )) &&
              (query === "" || bot.agent.name.toLocaleLowerCase().includes(query)),
          )
          .map((bot) => ({ environmentId: section.environmentId, bot })),
  );
}

/** The bot chats of the loaded lists, which Chats leaves to the Bots section as the desktop does. */
export function botChatKeys(sections: ReadonlyArray<BotSection>): ReadonlySet<string> {
  return new Set(
    sections.flatMap((section) =>
      section.state === "ready"
        ? section.bots.map((bot) => scopedThreadKey(section.environmentId, bot.threadId))
        : [],
    ),
  );
}

type BotChatShell = Parameters<typeof resolveThreadListV2RowStatus>[0] &
  Pick<EnvironmentThreadShell, "interactionMode" | "hasActionableProposedPlan">;

/** The bot chat's status as its thread row shows it; a reply reads Completed until it is opened. */
export function botChatStatus(chat: BotChatShell | null): BotStatusCandidate | null {
  if (!chat) return null;
  const status = resolveThreadListV2RowStatus(chat);
  if (status !== "ready") return { kind: status, detail: null };
  if (chat.interactionMode === "plan" && chat.hasActionableProposedPlan)
    return { kind: "input", detail: "planReview" };
  return threadHasUnseenCompletion(chat) ? { kind: "done", detail: null } : null;
}

/**
 * The bot's one status, as the desktop's Bots section decides it: its chat, its latest
 * background task, and any task from its chat that waits for the user.
 */
export function botStatusOf(
  bot: Bot,
  shell: (threadId: ThreadId) => EnvironmentThreadShell | null,
): BotStatusCandidate | null {
  const chat = shell(bot.threadId);
  const run = bot.latestTaskRun;
  return topBotStatus(
    botChatStatus(chat),
    botTaskStatus(run?.status, run ? shell(run.threadId) : null, {
      completedAt: run?.completedAt,
      lastVisitedAt: chat?.lastVisitedAt,
    }),
    botTaskRunRequestStatus(botTaskRunRequest((bot.activeTaskRunThreadIds ?? []).map(shell))),
  );
}

interface MentionableBot {
  readonly id: string;
  readonly name: string;
  readonly bot: Bot;
}

const mentionable = (bots: ReadonlyArray<Bot>, threadId: ThreadId): MentionableBot[] =>
  addressableBots(bots, threadId).map((bot) => ({ id: bot.agent.id, name: bot.agent.name, bot }));

/** The bots an `@` query in this thread's composer offers, best match first. */
export function matchMentionBots(
  bots: ReadonlyArray<Bot>,
  threadId: ThreadId,
  query: string,
): ReadonlyArray<Bot> {
  return matchComposerRecipients(mentionable(bots, threadId), query).map(({ bot }) => bot);
}

/** What the composer writes for a bot picked from the `@` menu. */
export const botMentionText = (bot: Bot) => composerRecipientMention(bot.agent.name);

export type BotMentionMessage =
  | { readonly kind: "send"; readonly bot: Bot; readonly text: string }
  | { readonly kind: "empty"; readonly bot: Bot }
  | { readonly kind: "attachments"; readonly bot: Bot }
  | { readonly kind: "several"; readonly bots: ReadonlyArray<Bot> };

/**
 * Where a draft goes: to the bot whose `@Name` opens it, as on the desktop, or to this thread
 * (null). A message to a bot is text only and names one bot.
 */
export function botMentionMessage(input: {
  readonly draft: string;
  readonly hasAttachments: boolean;
  readonly bots: ReadonlyArray<Bot>;
  readonly threadId: ThreadId;
}): BotMentionMessage | null {
  const message = parseComposerRecipientMessage(
    input.draft,
    mentionable(input.bots, input.threadId),
  );
  if (message === null) return null;
  if ("recipients" in message)
    return { kind: "several", bots: message.recipients.map(({ bot }) => bot) };
  const { bot } = message.recipient;
  if (input.hasAttachments) return { kind: "attachments", bot };
  if (message.text === "") return { kind: "empty", bot };
  return { kind: "send", bot, text: message.text };
}

/** A bot's memory as its turns see it: your entries, then the bot's, each newest first. */
export const orderedBotMemory = (memories: ReadonlyArray<BotMemory>) =>
  botMemoryContext(memories).entries;
