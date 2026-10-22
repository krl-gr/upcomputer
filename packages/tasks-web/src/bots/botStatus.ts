import type { BotCharacterState } from "../../../../apps/web/src/components/bot-character-configurable/catalog.ts";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveSidebarV2TopStatus,
} from "../../../../apps/web/src/components/Sidebar.logic.ts";
import {
  THREAD_STATUS_LABELS,
  type ThreadStatusLabelEntry,
  type ThreadStatusLabelKind,
} from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import type { SidebarThreadSummary } from "../../../../apps/web/src/types.ts";

export type { BotCharacterState };

export interface BotStatus {
  readonly state: BotCharacterState;
  /** The thread status label, word for word; null while idle. */
  readonly label: ThreadStatusLabelEntry | null;
  /** What the shared label leaves out, such as a background task being the cause. */
  readonly detail: string | null;
}

type BotStatusCandidate = { readonly kind: ThreadStatusLabelKind; readonly detail: string | null };

export type BotChatInput = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Parameters<typeof hasUnseenCompletion>[0];

const CHARACTER_STATE: { readonly [Kind in ThreadStatusLabelKind]: BotCharacterState } = {
  working: "working",
  waiting: "waiting",
  approval: "attention",
  input: "attention",
  done: "done",
  failed: "failed",
  limited: "limited",
};

// The order `resolveSidebarThreadStatus` checks a thread in: a request for the
// user, then work in flight, then how the last turn ended.
const PRIORITY: ReadonlyArray<ThreadStatusLabelKind> = [
  "approval",
  "input",
  "working",
  "waiting",
  "failed",
  "limited",
  "done",
];

/**
 * The bot chat's status as its thread row would show it. `lastVisitedAt`
 * resolves like the row's, so a reply reads Completed until the chat is
 * opened. A plan waiting for review asks for the user, as the old bot status did.
 */
export function botChatStatus(chat: BotChatInput | null): BotStatusCandidate | null {
  if (!chat) return null;
  const status = resolveSidebarThreadStatus(chat);
  if (status === "ready" && chat.interactionMode === "plan" && chat.hasActionableProposedPlan)
    return { kind: "input", detail: "Plan ready for review" };
  const kind = resolveSidebarV2TopStatus({
    status,
    isUnread: hasUnseenCompletion(chat),
    isWoke: false,
  });
  return kind === null || kind === "woke" ? null : { kind, detail: null };
}

/** The bot's latest background task run, whose result returns to the bot chat. */
export function botTaskStatus(
  runStatus: string | undefined,
  taskThread: Pick<SidebarThreadSummary, "runtime"> | null,
): BotStatusCandidate | null {
  if (runStatus === "running" || runStatus?.startsWith("finalizing:"))
    return { kind: "waiting", detail: "Waiting for its background task" };
  if (runStatus === "blocked") return { kind: "input", detail: "Background task is blocked" };
  if (runStatus === "interrupted")
    return { kind: "failed", detail: "Background task was interrupted" };
  if (runStatus === "failed")
    return taskThread?.runtime?.status === "failed" &&
      taskThread.runtime.lastErrorClass === "usage_limit"
      ? { kind: "limited", detail: "Background task hit a provider limit" }
      : { kind: "failed", detail: "Background task failed" };
  return null;
}

/** One status for the bot: whichever of its chat and its task comes first for a thread. */
export function botStatus(
  chat: BotStatusCandidate | null,
  task: BotStatusCandidate | null,
): BotStatus {
  const winner = [chat, task]
    .filter((candidate) => candidate !== null)
    .toSorted((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
  if (!winner) return { state: "idle", label: null, detail: null };
  return {
    state: CHARACTER_STATE[winner.kind],
    label: { kind: winner.kind, ...THREAD_STATUS_LABELS[winner.kind] },
    detail: winner.detail,
  };
}
