/** A bot's status in the thread status vocabulary; each client names and draws it. */
export type BotStatusKind =
  | "preparing"
  | "working"
  | "waiting"
  | "approval"
  | "input"
  | "request"
  | "done"
  | "failed"
  | "limited";

/** What the thread status leaves out, such as a background task being the cause. */
export type BotStatusDetail =
  | "planReview"
  | "taskApproval"
  | "taskQuestion"
  | "taskWaiting"
  | "taskBlocked"
  | "taskInterrupted"
  | "taskFailed"
  | "taskLimited"
  | "chatTaskApproval"
  | "chatTaskQuestion";

export interface BotStatusCandidate {
  readonly kind: BotStatusKind;
  readonly detail: BotStatusDetail | null;
}

// The order a thread row checks a thread in: a request for the user, then work in flight,
// then how the last turn ended.
const PRIORITY: ReadonlyArray<BotStatusKind> = [
  "approval",
  "input",
  "request",
  "preparing",
  "working",
  "waiting",
  "failed",
  "limited",
  "done",
];

/** What a bot status reads of a run's thread; web and mobile thread shells both fit. */
export interface BotRunThread {
  readonly runtime?: {
    readonly status: string;
    readonly lastErrorClass?: string | null | undefined;
  } | null;
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
}

/**
 * The bot's latest background task run, whose result returns to the bot chat. How a run
 * ended shows until the chat is opened after it ended, as a thread's own result does. A
 * running task's approval or question shows until it is answered: the run's own thread
 * holds it, and opening the bot chat does not answer it.
 */
export function botTaskStatus(
  runStatus: string | undefined,
  taskThread: BotRunThread | null,
  seen: {
    readonly completedAt?: string | null | undefined;
    readonly lastVisitedAt?: string | null | undefined;
  } = {},
): BotStatusCandidate | null {
  if (runStatus === "running" || runStatus?.startsWith("finalizing:")) {
    if (taskThread?.hasPendingApprovals) return { kind: "approval", detail: "taskApproval" };
    if (taskThread?.hasPendingUserInput) return { kind: "input", detail: "taskQuestion" };
    return { kind: "waiting", detail: "taskWaiting" };
  }
  if (
    seen.completedAt != null &&
    seen.lastVisitedAt != null &&
    Date.parse(seen.lastVisitedAt) >= Date.parse(seen.completedAt)
  )
    return null;
  if (runStatus === "blocked") return { kind: "input", detail: "taskBlocked" };
  if (runStatus === "interrupted") return { kind: "failed", detail: "taskInterrupted" };
  if (runStatus === "failed")
    return taskThread?.runtime?.status === "failed" &&
      taskThread.runtime.lastErrorClass === "usage_limit"
      ? { kind: "limited", detail: "taskLimited" }
      : { kind: "failed", detail: "taskFailed" };
  return null;
}

export type BotTaskRunRequest = "approval" | "input" | null;

/**
 * Whether a run of a task from the bot's chat, the bot's own or another task agent's, waits
 * for the user. The run's thread holds the request, so opening the bot chat does not answer it.
 */
export function botTaskRunRequest(
  runThreads: ReadonlyArray<Pick<
    BotRunThread,
    "hasPendingApprovals" | "hasPendingUserInput"
  > | null>,
): BotTaskRunRequest {
  if (runThreads.some((thread) => thread?.hasPendingApprovals)) return "approval";
  if (runThreads.some((thread) => thread?.hasPendingUserInput)) return "input";
  return null;
}

export function botTaskRunRequestStatus(request: BotTaskRunRequest): BotStatusCandidate | null {
  if (request === "approval") return { kind: "approval", detail: "chatTaskApproval" };
  if (request === "input") return { kind: "input", detail: "chatTaskQuestion" };
  return null;
}

/**
 * The one status a bot shows: whichever of its chat and its tasks comes first for a thread.
 * On a tie the earlier candidate wins.
 */
export function topBotStatus<C extends { readonly kind: BotStatusKind }>(
  ...candidates: ReadonlyArray<C | null>
): C | null {
  return (
    candidates
      .filter((candidate) => candidate !== null)
      // `filter` returned a new array; Hermes has no `toSorted`.
      .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0] ?? null
  );
}
