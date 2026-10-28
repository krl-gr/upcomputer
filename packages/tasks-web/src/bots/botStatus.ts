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
  request: "attention",
  done: "done",
  failed: "failed",
  limited: "limited",
};

// The order `resolveSidebarThreadStatus` checks a thread in: a request for the
// user, then work in flight, then how the last turn ended.
const PRIORITY: ReadonlyArray<ThreadStatusLabelKind> = [
  "approval",
  "input",
  "request",
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

/**
 * The bot's latest background task run, whose result returns to the bot chat. How a run
 * ended shows until the chat is opened after it ended, as a thread's own result does. A
 * running task's approval or question shows until it is answered: the run's own thread
 * holds it, and opening the bot chat does not answer it.
 */
export function botTaskStatus(
  runStatus: string | undefined,
  taskThread: Pick<
    SidebarThreadSummary,
    "runtime" | "hasPendingApprovals" | "hasPendingUserInput"
  > | null,
  seen: {
    readonly completedAt?: string | null | undefined;
    readonly lastVisitedAt?: string | null | undefined;
  } = {},
): BotStatusCandidate | null {
  if (runStatus === "running" || runStatus?.startsWith("finalizing:")) {
    if (taskThread?.hasPendingApprovals)
      return { kind: "approval", detail: "Background task needs approval" };
    if (taskThread?.hasPendingUserInput)
      return { kind: "input", detail: "Background task asks a question" };
    return { kind: "waiting", detail: "Waiting for its background task" };
  }
  if (
    seen.completedAt != null &&
    seen.lastVisitedAt != null &&
    Date.parse(seen.lastVisitedAt) >= Date.parse(seen.completedAt)
  )
    return null;
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

export type BotTaskRunRequest = "approval" | "input" | null;

/**
 * Whether a run of a task from the bot's chat, the bot's own or another task agent's, waits
 * for the user. The run's thread holds the request, so opening the bot chat does not answer it.
 */
export function botTaskRunRequest(
  runThreads: ReadonlyArray<Pick<
    SidebarThreadSummary,
    "hasPendingApprovals" | "hasPendingUserInput"
  > | null>,
): BotTaskRunRequest {
  if (runThreads.some((thread) => thread?.hasPendingApprovals)) return "approval";
  if (runThreads.some((thread) => thread?.hasPendingUserInput)) return "input";
  return null;
}

export function botTaskRunRequestStatus(request: BotTaskRunRequest): BotStatusCandidate | null {
  if (request === "approval")
    return { kind: "approval", detail: "A task from this chat needs approval" };
  if (request === "input")
    return { kind: "input", detail: "A task from this chat asks a question" };
  return null;
}

/**
 * One status for the bot: whichever of its chat and its tasks comes first for a thread. On
 * a tie the earlier candidate's detail shows.
 */
export function botStatus(...candidates: ReadonlyArray<BotStatusCandidate | null>): BotStatus {
  const winner = candidates
    .filter((candidate) => candidate !== null)
    .toSorted((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
  if (!winner) return { state: "idle", label: null, detail: null };
  return {
    state: CHARACTER_STATE[winner.kind],
    label: { kind: winner.kind, ...THREAD_STATUS_LABELS[winner.kind] },
    detail: winner.detail,
  };
}
