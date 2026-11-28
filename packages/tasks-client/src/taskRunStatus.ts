/** Run-count status for a blocked run that is no longer its task's latest run. */
const SUPERSEDED_BLOCKED_RUN_STATUS = "blocked:superseded";

/** Status to search runs by for a run-count status. */
export function runSearchStatus(countStatus: string): string {
  return countStatus === SUPERSEDED_BLOCKED_RUN_STATUS ? "blocked" : countStatus;
}

const FINISHED_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "stopped",
  SUPERSEDED_BLOCKED_RUN_STATUS,
]);

/**
 * A finished run is history: a thread row counts it only until the thread is seen. Running,
 * finalizing and awaiting-input runs are active and always count. Mirrors the server's rule.
 */
export function isFinishedRunStatus(status: string): boolean {
  return FINISHED_RUN_STATUSES.has(status);
}

/** What a worker run's raw status means to a person, before any client names it. */
export type TaskRunKind =
  | "approval"
  | "working"
  | "awaitingInput"
  | "finalizing"
  | "failed"
  | "interrupted"
  | "stopped"
  | "blocked"
  | "completed";

/** A kind, or a status no client knows yet, shown as the server wrote it. */
export type TaskRunState =
  | { readonly kind: TaskRunKind }
  | { readonly kind: "other"; readonly label: string };

export function taskRunState(
  runStatus: string | null | undefined,
  hasPendingApproval: boolean,
): TaskRunState | null {
  if (hasPendingApproval) return { kind: "approval" };
  const normalized = runStatus?.trim().toLowerCase();
  if (!normalized) return null;
  switch (normalized) {
    case "finalizing:interrupted":
    case "interrupted":
      return { kind: "interrupted" };
    case "finalizing:failed":
    case "failed":
      return { kind: "failed" };
    case "finalizing:stopped":
    case "finalizing:result":
      return { kind: "finalizing" };
    case "completed":
      return { kind: "completed" };
    case "running":
      return { kind: "working" };
    case "blocked":
      return { kind: "awaitingInput" };
    // A blocked run a newer run replaced: history, not a call to action.
    case SUPERSEDED_BLOCKED_RUN_STATUS:
      return { kind: "blocked" };
    case "stopped":
      return { kind: "stopped" };
    default:
      return {
        kind: "other",
        label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
      };
  }
}
