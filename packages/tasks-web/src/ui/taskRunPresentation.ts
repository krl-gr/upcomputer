import { taskRunState, type TaskRunKind } from "@t3tools/tasks-client/taskRunStatus";
import { msg } from "gt-react";

export { isFinishedRunStatus, runSearchStatus } from "@t3tools/tasks-client/taskRunStatus";

export interface TaskRunPresentation {
  /** English, from `msg()`; the component that shows it translates it with `useMessages()`. */
  readonly label: string;
  readonly className: string;
}

const PRESENTATION: Record<TaskRunKind, TaskRunPresentation> = {
  approval: { label: msg("Approval"), className: "text-amber-600 dark:text-amber-300" },
  working: { label: msg("Working"), className: "text-sky-600 dark:text-sky-400" },
  awaitingInput: {
    label: msg("Awaiting Input"),
    className: "text-indigo-600 dark:text-indigo-300",
  },
  finalizing: { label: msg("Finalizing"), className: "text-muted-foreground dark:text-white/64" },
  failed: { label: msg("Failed"), className: "text-red-700 dark:text-red-300" },
  interrupted: { label: msg("Interrupted"), className: "text-red-700 dark:text-red-300" },
  stopped: { label: msg("Stopped"), className: "text-muted-foreground dark:text-white/64" },
  blocked: { label: msg("Blocked"), className: "text-orange-600 dark:text-orange-300" },
  completed: { label: msg("Completed"), className: "text-emerald-600 dark:text-emerald-300/90" },
};

export function taskRunPresentation(
  runStatus: string | undefined,
  hasPendingApproval: boolean,
): TaskRunPresentation | null {
  const state = taskRunState(runStatus, hasPendingApproval);
  if (state === null) return null;
  return state.kind === "other"
    ? { label: state.label, className: "text-muted-foreground dark:text-white/64" }
    : PRESENTATION[state.kind];
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
  /** The group's first run status in badge order: the run filter a click on its count opens. */
  readonly status: string;
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
      status: previous?.status ?? count.status,
    });
  }
  return [...result.values()];
}

/** The groups a bot's compact sidebar pill shows: what is running or needs attention. */
export function attentionRunCountGroups(groups: readonly TaskRunCountGroup[]): TaskRunCountGroup[] {
  return groups.filter((group) => group.label !== "Completed");
}
