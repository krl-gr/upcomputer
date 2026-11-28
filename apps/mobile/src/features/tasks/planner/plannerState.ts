import type { ProjectIconColor, ProjectIconOverride } from "@t3tools/contracts";
import {
  addDays,
  dateRange,
  viewStartFor,
  type DateKey,
} from "@t3tools/tasks-client/planner/dates";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { PlannerKind } from "@t3tools/tasks-client/planner/plannerStore";
import {
  PERSON_DONE_STATUS,
  type TaskScheduleEntry,
  type TaskScheduleEntryStatus,
} from "@t3tools/tasks-contracts/v1";

import { projectAutoMonogram } from "../../../lib/projectIcon";

export function plannerKindOf(view: "mine" | "routines"): PlannerKind {
  return view === "routines" ? "routine" : "task";
}

/** The days the week shows from its first one. */
export function plannerDays(start: DateKey, dayCount: number): readonly DateKey[] {
  return dateRange(start, dayCount);
}

/** The desktop's week buttons: back or forward a week or a day, or to today. */
export type WeekStep = "previous-week" | "previous-day" | "today" | "next-day" | "next-week";

const STEP_DAYS = { "previous-week": -7, "previous-day": -1, "next-day": 1, "next-week": 7 };

export function steppedWeekStart(input: {
  readonly start: DateKey;
  readonly step: WeekStep;
  readonly today: DateKey;
  readonly dayCount: number;
  readonly weekStartDay: number;
}): DateKey {
  return input.step === "today"
    ? viewStartFor(input.today, input.dayCount, input.weekStartDay)
    : addDays(input.start, STEP_DAYS[input.step]);
}

export interface DayEntry {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
}

/**
 * A day's entries in queue order, tasks and routines together as in the desktop's week. An
 * entry whose task is not loaded yet stays, so the day never jumps when the task arrives.
 */
export function dayEntries(
  entries: readonly TaskScheduleEntry[] | undefined,
  tasks: ReadonlyMap<string, PlannerTask>,
): readonly DayEntry[] {
  return (entries ?? []).map((entry) => ({ entry, task: tasks.get(entry.taskId) }));
}

/** What a check-off makes of an entry: done, or open again. A skipped entry counts as handled. */
export function toggledEntryStatus(status: TaskScheduleEntryStatus): TaskScheduleEntryStatus {
  return status === "open" ? "done" : "open";
}

/** A task done or archived: its row offers Restore instead of Mark as done and Archive. */
export function isFinishedTask(task: Pick<PlannerTask, "archivedAt" | "status">): boolean {
  return task.archivedAt !== null || task.status === PERSON_DONE_STATUS;
}

/**
 * The color of a card's stripe and tint: the project's badge color, as the desktop picks it (the
 * icon's color, else the one its monogram takes from the title). None without a project, for the
 * scratch project, or while the entry is handled.
 */
export function plannerProjectColor(
  project: {
    readonly title: string;
    readonly projectIcon?: ProjectIconOverride | null;
  } | null,
): ProjectIconColor | null {
  if (project === null) return null;
  const icon = project.projectIcon;
  if (icon && icon.kind !== "emoji") return icon.color;
  const monogram = projectAutoMonogram(project.title);
  return monogram?.kind === "monogram" ? monogram.color : null;
}

/** What the planner says when it has nothing to show yet. */
export type PlannerGate = "noEnvironment" | "offline" | "checking" | "unavailable" | "ready";

export function plannerGate(input: {
  readonly hasEnvironment: boolean;
  readonly connected: boolean;
  readonly access: "loading" | "unavailable" | "enabled" | null;
  readonly planner: "loading" | "unavailable" | "enabled" | null;
}): PlannerGate {
  if (!input.hasEnvironment) return "noEnvironment";
  if (!input.connected) return "offline";
  if (input.access === "unavailable" || input.planner === "unavailable") return "unavailable";
  if (input.access !== "enabled" || input.planner !== "enabled") return "checking";
  return "ready";
}
