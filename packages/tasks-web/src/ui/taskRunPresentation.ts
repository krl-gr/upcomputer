/** Run-count status for a blocked run that is no longer its task's latest run. */
const SUPERSEDED_BLOCKED_RUN_STATUS = "blocked:superseded";

/** Status to search runs by for a run-count status. */
export function runSearchStatus(countStatus: string): string {
  return countStatus === SUPERSEDED_BLOCKED_RUN_STATUS ? "blocked" : countStatus;
}

export interface TaskRunPresentation {
  readonly label: string;
  readonly className: string;
}

export function taskRunPresentation(
  runStatus: string | undefined,
  hasPendingApproval: boolean,
): TaskRunPresentation | null {
  if (hasPendingApproval) {
    return { label: "Approval", className: "text-amber-600 dark:text-amber-300" };
  }
  const normalized = runStatus?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "finalizing:interrupted" || normalized === "finalizing:failed") {
    return {
      label: normalized === "finalizing:failed" ? "Failed" : "Interrupted",
      className: "text-red-700 dark:text-red-300",
    };
  }
  if (normalized === "finalizing:stopped" || normalized === "finalizing:result") {
    return {
      label: "Finalizing",
      className: "text-muted-foreground dark:text-white/64",
    };
  }
  if (normalized === "completed") {
    return { label: "Completed", className: "text-emerald-600 dark:text-emerald-300/90" };
  }
  if (normalized === "running") {
    return { label: "Working", className: "text-sky-600 dark:text-sky-400" };
  }
  if (normalized === "blocked") {
    return { label: "Awaiting Input", className: "text-indigo-600 dark:text-indigo-300" };
  }
  // A blocked run a newer run replaced: history, not a call to action.
  if (normalized === SUPERSEDED_BLOCKED_RUN_STATUS) {
    return { label: "Blocked", className: "text-orange-600 dark:text-orange-300" };
  }
  if (normalized === "failed" || normalized === "interrupted") {
    return {
      label: normalized === "failed" ? "Failed" : "Interrupted",
      className: "text-red-700 dark:text-red-300",
    };
  }
  return {
    label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    className: "text-muted-foreground dark:text-white/64",
  };
}

const RUN_LABEL_ORDER = [
  "Working",
  "Approval",
  "Awaiting Input",
  "Finalizing",
  "Failed",
  "Interrupted",
  "Stopped",
  "Blocked",
  "Completed",
];

/** Active and actionable runs precede historical successes. */
export function compareTaskRunStatuses(left: string, right: string): number {
  const priority = (status: string) => {
    const index = RUN_LABEL_ORDER.indexOf(taskRunPresentation(status, false)?.label ?? "");
    return index < 0 ? RUN_LABEL_ORDER.length : index;
  };
  return priority(left) - priority(right) || left.localeCompare(right);
}

export interface TaskRunCountGroup extends TaskRunPresentation {
  readonly count: number;
}

/** Nonzero run counts merged by label, in badge order. Shared by sidebar rows and their task menu. */
export function groupTaskRunCounts(
  counts: ReadonlyArray<{ readonly status: string; readonly count: number }>,
): TaskRunCountGroup[] {
  const result = new Map<string, TaskRunCountGroup>();
  for (const count of [...counts].sort((a, b) => compareTaskRunStatuses(a.status, b.status))) {
    const presentation = taskRunPresentation(count.status, false);
    if (!presentation || count.count <= 0) continue;
    const previous = result.get(presentation.label);
    result.set(presentation.label, {
      ...presentation,
      count: (previous?.count ?? 0) + count.count,
    });
  }
  return [...result.values()];
}
