import type { BotCharacterState } from "../../../../apps/web/src/components/bot-character-configurable/catalog.ts";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
} from "../../../../apps/web/src/components/Sidebar.logic.ts";
import { resolveSidebarV2TopStatus } from "../../../../apps/web/src/sidebarThreadRow/topStatus.ts";
import {
  THREAD_STATUS_LABELS,
  type ThreadStatusLabelEntry,
  type ThreadStatusLabelKind,
} from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import {
  botTaskRunRequest,
  botTaskRunRequestStatus as sharedBotTaskRunRequestStatus,
  botTaskStatus as sharedBotTaskStatus,
  topBotStatus,
  type BotStatusCandidate as SharedBotStatusCandidate,
  type BotStatusDetail,
  type BotTaskRunRequest,
} from "@t3tools/tasks-client/bots/botStatus";
import { msg } from "gt-react";

export type { BotCharacterState };

export interface BotStatus {
  readonly state: BotCharacterState;
  /** The thread status label, word for word; null while idle. */
  readonly label: ThreadStatusLabelEntry | null;
  /** What the shared label leaves out, such as a background task being the cause. English, from `msg()`. */
  readonly detail: string | null;
}

type BotStatusCandidate = { readonly kind: ThreadStatusLabelKind; readonly detail: string | null };

export type BotChatInput = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Parameters<typeof hasUnseenCompletion>[0];

const CHARACTER_STATE: { readonly [Kind in ThreadStatusLabelKind]: BotCharacterState } = {
  preparing: "working",
  working: "working",
  waiting: "waiting",
  approval: "attention",
  input: "attention",
  request: "attention",
  done: "done",
  failed: "failed",
  limited: "limited",
};

const DETAILS: { readonly [Detail in BotStatusDetail]: string } = {
  planReview: msg("Plan ready for review"),
  taskApproval: msg("Background task needs approval"),
  taskQuestion: msg("Background task asks a question"),
  taskWaiting: msg("Waiting for its background task"),
  taskBlocked: msg("Background task is blocked"),
  taskInterrupted: msg("Background task was interrupted"),
  taskFailed: msg("Background task failed"),
  taskLimited: msg("Background task hit a provider limit"),
  chatTaskApproval: msg("A task from this chat needs approval"),
  chatTaskQuestion: msg("A task from this chat asks a question"),
};

/**
 * The bot chat's status as its thread row would show it. `lastVisitedAt`
 * resolves like the row's, so a reply reads Completed until the chat is
 * opened. A plan waiting for review asks for the user, as the old bot status did.
 */
export function botChatStatus(chat: BotChatInput | null): BotStatusCandidate | null {
  if (!chat) return null;
  const status = resolveSidebarThreadStatus(chat);
  if (status === "ready" && chat.interactionMode === "plan" && chat.hasActionableProposedPlan)
    return { kind: "input", detail: DETAILS.planReview };
  const kind = resolveSidebarV2TopStatus({
    status,
    isUnread: hasUnseenCompletion(chat),
    isWoke: false,
  });
  return kind === null || kind === "woke" ? null : { kind, detail: null };
}

const worded = (candidate: SharedBotStatusCandidate | null): BotStatusCandidate | null =>
  candidate && {
    kind: candidate.kind,
    detail: candidate.detail === null ? null : DETAILS[candidate.detail],
  };

/** The bot's latest background task run, worded; `@t3tools/tasks-client` decides it. */
export const botTaskStatus = (...input: Parameters<typeof sharedBotTaskStatus>) =>
  worded(sharedBotTaskStatus(...input));

export { botTaskRunRequest, type BotTaskRunRequest };

export const botTaskRunRequestStatus = (request: BotTaskRunRequest) =>
  worded(sharedBotTaskRunRequestStatus(request));

/**
 * One status for the bot: whichever of its chat and its tasks comes first for a thread. On
 * a tie the earlier candidate's detail shows.
 */
export function botStatus(...candidates: ReadonlyArray<BotStatusCandidate | null>): BotStatus {
  const winner = topBotStatus(...candidates);
  if (!winner) return { state: "idle", label: null, detail: null };
  return {
    state: CHARACTER_STATE[winner.kind],
    label: { kind: winner.kind, ...THREAD_STATUS_LABELS[winner.kind] },
    detail: winner.detail,
  };
}
