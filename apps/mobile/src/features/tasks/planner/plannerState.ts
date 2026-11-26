import { addDays, dateRange, weekStartOf, type DateKey } from "@t3tools/tasks-client/planner/dates";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { PlannerKind } from "@t3tools/tasks-client/planner/plannerStore";
import type { TaskScheduleEntry, TaskScheduleEntryStatus } from "@t3tools/tasks-contracts/v1";

/** The Tasks tab's views, as the desktop's Tasks launcher names them. */
export type TasksView = "workers" | "mine" | "routines";

export function plannerKindOf(view: Exclude<TasksView, "workers">): PlannerKind {
  return view === "routines" ? "routine" : "task";
}

/** The seven days of the week that holds `date`. */
export function weekOf(date: DateKey, weekStartDay: number): readonly DateKey[] {
  return dateRange(weekStartOf(date, weekStartDay), 7);
}

/**
 * The locale's first day of the week where the engine knows it, else Monday, as the desktop.
 * 0 is Sunday.
 */
export function localeWeekStart(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return firstDay === undefined ? 1 : firstDay % 7;
  } catch {
    return 1;
  }
}

export interface DayEntry {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
}

/**
 * A day's entries of one kind, in queue order. The desktop's week shows tasks and routines
 * together; the phone shows the view's own. An entry whose task is not loaded yet stays, so
 * the day never jumps when the task arrives.
 */
export function dayEntries(
  entries: readonly TaskScheduleEntry[] | undefined,
  tasks: ReadonlyMap<string, PlannerTask>,
  kind: PlannerKind,
): readonly DayEntry[] {
  return (entries ?? []).flatMap((entry) => {
    const task = tasks.get(entry.taskId);
    return task === undefined || task.kind === kind ? [{ entry, task }] : [];
  });
}

/** The days of the week strip that hold an open entry of the kind. */
export function daysWithOpenEntries(
  days: ReadonlyMap<string, readonly TaskScheduleEntry[]>,
  tasks: ReadonlyMap<string, PlannerTask>,
  kind: PlannerKind,
): ReadonlySet<DateKey> {
  const result = new Set<DateKey>();
  for (const [date, entries] of days)
    if (dayEntries(entries, tasks, kind).some(({ entry }) => entry.status === "open"))
      result.add(date);
  return result;
}

/** What a check-off makes of an entry: done, or open again. A skipped entry counts as handled. */
export function toggledEntryStatus(status: TaskScheduleEntryStatus): TaskScheduleEntryStatus {
  return status === "open" ? "done" : "open";
}

/**
 * Where "Move to" can send an entry: the other days of its week, then the same weekday of the
 * next week.
 */
export function entryMoveTargets(date: DateKey, weekStartDay: number): readonly DateKey[] {
  return [...weekOf(date, weekStartDay).filter((day) => day !== date), addDays(date, 7)];
}

/** The list rows a search keeps: titles that contain it, any case. */
export function searchPlannerTasks(
  tasks: readonly PlannerTask[],
  query: string,
): readonly PlannerTask[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? tasks.filter((task) => task.title.toLocaleLowerCase().includes(needle)) : tasks;
}

/** Whether a task already has an entry on a day, so "Add to" would plan it twice. */
export function plannedOn(entries: readonly DayEntry[], taskId: string): boolean {
  return entries.some(({ entry }) => entry.taskId === taskId);
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
