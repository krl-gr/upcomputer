import { statusGroupKey } from "@t3tools/tasks-client/taskStatusGroups";
import { taskRunState, type TaskRunKind } from "@t3tools/tasks-client/taskRunStatus";
import { msg } from "gt-react-native";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import type { MessageResolver } from "../../i18n/messages";

export interface TaskTone {
  readonly icon: AppSymbolName;
  /** Tint class for symbols. */
  readonly tint: string;
  /** Text color class. */
  readonly text: string;
}

const NEUTRAL: TaskTone = {
  icon: "circle",
  tint: "accent-icon-muted",
  text: "text-foreground-muted",
};

const STATUS_TONES: Readonly<Record<string, TaskTone>> = {
  idea: { icon: "circle.dashed", tint: "accent-icon-muted", text: "text-foreground-muted" },
  backlog: { icon: "circle.dashed", tint: "accent-icon-muted", text: "text-foreground-muted" },
  queued: { icon: "circle.dashed", tint: "accent-icon-muted", text: "text-foreground-muted" },
  "to do": NEUTRAL,
  restored: NEUTRAL,
  "in progress": {
    icon: "circle.inset.filled",
    tint: "accent-adaptive-sky-600-400",
    text: "text-adaptive-sky-600-400",
  },
  "in review": {
    icon: "eye",
    tint: "accent-adaptive-sky-600-400",
    text: "text-adaptive-sky-600-400",
  },
  "needs you": {
    icon: "exclamationmark.circle",
    tint: "accent-adaptive-amber-700-300",
    text: "text-adaptive-amber-700-300",
  },
  "needs input": {
    icon: "exclamationmark.circle",
    tint: "accent-adaptive-amber-700-300",
    text: "text-adaptive-amber-700-300",
  },
  "needs review": {
    icon: "eye",
    tint: "accent-adaptive-violet-600-400",
    text: "text-adaptive-violet-600-400",
  },
  "to verify": {
    icon: "eye",
    tint: "accent-adaptive-violet-600-400",
    text: "text-adaptive-violet-600-400",
  },
  blocked: {
    icon: "exclamationmark.triangle",
    tint: "accent-adaptive-rose-600-400",
    text: "text-adaptive-rose-600-400",
  },
  failed: {
    icon: "xmark.circle.fill",
    tint: "accent-adaptive-rose-600-400",
    text: "text-adaptive-rose-600-400",
  },
  done: {
    icon: "checkmark.circle.fill",
    tint: "accent-adaptive-emerald-600-400",
    text: "text-adaptive-emerald-600-400",
  },
  cancelled: { icon: "slash.circle", tint: "accent-icon-muted", text: "text-foreground-muted" },
};

/** How a status looks; statuses are free text, so an unknown one looks like To Do. */
export function taskStatusTone(status: string): TaskTone {
  return STATUS_TONES[statusGroupKey(status)] ?? NEUTRAL;
}

const RUN_LABELS: Readonly<Record<TaskRunKind, string>> = {
  approval: msg("Approval", { $context: "worker run state: waits for an approval" }),
  working: msg("Working", { $context: "worker run state" }),
  awaitingInput: msg("Awaiting input", { $context: "worker run state" }),
  finalizing: msg("Finalizing", { $context: "worker run state" }),
  failed: msg("Failed", { $context: "worker run state" }),
  interrupted: msg("Interrupted", { $context: "worker run state" }),
  stopped: msg("Stopped", { $context: "worker run state" }),
  blocked: msg("Blocked", { $context: "worker run state" }),
  completed: msg("Completed", { $context: "worker run state" }),
};

const RUN_TONES: Readonly<Record<TaskRunKind, TaskTone>> = {
  approval: STATUS_TONES["needs you"]!,
  working: {
    icon: "hammer",
    tint: "accent-adaptive-sky-600-400",
    text: "text-adaptive-sky-600-400",
  },
  awaitingInput: {
    icon: "questionmark.bubble",
    tint: "accent-adaptive-indigo-600-300",
    text: "text-adaptive-indigo-600-300",
  },
  finalizing: { icon: "hammer", tint: "accent-icon-muted", text: "text-foreground-muted" },
  failed: STATUS_TONES.failed!,
  interrupted: STATUS_TONES.failed!,
  stopped: { icon: "stop.fill", tint: "accent-icon-muted", text: "text-foreground-muted" },
  blocked: STATUS_TONES.blocked!,
  completed: STATUS_TONES.done!,
};

export interface TaskRunPresentation extends TaskTone {
  readonly label: string;
}

/** The worker run indicator: the latest run's state, worded and colored. */
export function taskRunPresentation(
  runStatus: string | null | undefined,
  resolve: MessageResolver,
): TaskRunPresentation | null {
  const state = taskRunState(runStatus, false);
  if (state === null) return null;
  if (state.kind === "other") return { ...NEUTRAL, icon: "hammer", label: state.label };
  return { ...RUN_TONES[state.kind], label: resolve(RUN_LABELS[state.kind]) };
}

/** The desktop's run badge order: active and actionable runs before finished ones. */
const RUN_COUNT_ORDER: readonly TaskRunKind[] = [
  "working",
  "approval",
  "awaitingInput",
  "finalizing",
  "failed",
  "interrupted",
  "stopped",
  "blocked",
  "completed",
];

export interface TaskRunCount extends TaskRunPresentation {
  readonly count: number;
  /** The group's first run status: the run filter a tap on its count opens, as on the desktop. */
  readonly status: string;
}

/** A task's runs by state, as the desktop's Runs column counts them. */
export function taskRunCounts(
  counts: ReadonlyArray<{ readonly status: string; readonly count: number }>,
  resolve: MessageResolver,
): readonly TaskRunCount[] {
  const byState = new Map<string, TaskRunCount & { readonly rank: number }>();
  for (const { status, count } of counts) {
    const state = taskRunState(status, false);
    if (state === null || count <= 0) continue;
    const key = state.kind === "other" ? `other:${state.label}` : state.kind;
    const previous = byState.get(key);
    const presentation = taskRunPresentation(status, resolve)!;
    byState.set(key, {
      ...presentation,
      count: (previous?.count ?? 0) + count,
      status: previous?.status ?? status,
      rank: state.kind === "other" ? RUN_COUNT_ORDER.length : RUN_COUNT_ORDER.indexOf(state.kind),
    });
  }
  return [...byState.values()]
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))
    .map(({ rank: _rank, ...count }) => count);
}
