/**
 * The planner's optimistic layer. The store derives a view from what the
 * server said, then applies each pending write's `apply` in order; a write's
 * op is dropped when its response is merged (or it fails). The apply functions
 * are pure and are wande's own optimistic helpers (`dayQueueOptimistic`,
 * `entityListOptimistic`) rewritten for entries and ranked lists.
 */
import type { TaskPageResult, TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { insertionIndex, type PlannerPlacement } from "../logic/placement.ts";

export type PlannerTask = TaskPageResult["tasks"][number];

export interface PlannerView {
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  /** Task ids of each list, in display order, before the list's own filter. */
  readonly lists: ReadonlyMap<string, readonly string[]>;
  /** Entries of each loaded date, in queue order. */
  readonly days: ReadonlyMap<string, readonly TaskScheduleEntry[]>;
}

export interface PendingOp {
  readonly id: number;
  readonly apply: (view: PlannerView) => PlannerView;
}

export type TaskPatch = Partial<
  Pick<PlannerTask, "title" | "description" | "projectId" | "status" | "archivedAt">
>;

export function patchTask(view: PlannerView, id: string, patch: TaskPatch): PlannerView {
  const task = view.tasks.get(id);
  if (!task) return view;
  const tasks = new Map(view.tasks);
  tasks.set(id, { ...task, ...patch });
  return { ...view, tasks };
}

export type ReorderAnchor =
  | { readonly beforeTaskId: string }
  | { readonly afterTaskId: string }
  /** No neighbor: first. */
  | {};

/**
 * Moves tasks as one block, in their current order, next to the anchor in
 * every list that holds them. A list without the anchor keeps its order.
 */
export function reorderTasks(
  view: PlannerView,
  ids: readonly string[],
  anchor: ReorderAnchor,
): PlannerView {
  const moving = new Set(ids);
  const lists = new Map<string, readonly string[]>();
  for (const [key, order] of view.lists) {
    const block = order.filter((id) => moving.has(id));
    if (block.length === 0) {
      lists.set(key, order);
      continue;
    }
    const others = order.filter((id) => !moving.has(id));
    let index: number;
    if ("beforeTaskId" in anchor) index = others.indexOf(anchor.beforeTaskId);
    else if ("afterTaskId" in anchor) {
      const after = others.indexOf(anchor.afterTaskId);
      index = after < 0 ? -1 : after + 1;
    } else index = 0;
    lists.set(
      key,
      index < 0 ? order : [...others.slice(0, index), ...block, ...others.slice(index)],
    );
  }
  return { ...view, lists };
}

export type EntryPatch = Partial<
  Pick<TaskScheduleEntry, "status" | "startTime" | "durationMinutes">
>;

export function patchEntry(view: PlannerView, id: string, patch: EntryPatch): PlannerView {
  let changed = false;
  const days = new Map<string, readonly TaskScheduleEntry[]>();
  for (const [date, entries] of view.days) {
    days.set(
      date,
      entries.some((entry) => entry.id === id)
        ? entries.map((entry) => {
            if (entry.id !== id) return entry;
            changed = true;
            return { ...entry, ...patch };
          })
        : entries,
    );
  }
  return changed ? { ...view, days } : view;
}

export function removeEntries(view: PlannerView, ids: ReadonlySet<string>): PlannerView {
  const days = new Map<string, readonly TaskScheduleEntry[]>();
  for (const [date, entries] of view.days) {
    days.set(
      date,
      entries.some((entry) => ids.has(entry.id))
        ? entries.filter((entry) => !ids.has(entry.id))
        : entries,
    );
  }
  return { ...view, days };
}

function placeBlock(
  view: PlannerView,
  date: string,
  block: readonly TaskScheduleEntry[],
  placement: PlannerPlacement | undefined,
  startTime: string | null,
): PlannerView {
  const others = view.days.get(date) ?? [];
  const index = insertionIndex(others, placement, startTime) ?? others.length;
  const days = new Map(view.days);
  days.set(date, [...others.slice(0, index), ...block, ...others.slice(index)]);
  return { ...view, days };
}

/** New entries (with temporary ids) where the server will put them. */
export function addEntries(
  view: PlannerView,
  date: string,
  entries: readonly TaskScheduleEntry[],
  placement: PlannerPlacement | undefined,
): PlannerView {
  return placeBlock(view, date, entries, placement, entries[0]?.startTime ?? null);
}

/**
 * Moves entries as one block in their current order (by date, then queue
 * order) to `date`, keeping ids and status. Given timing replaces theirs.
 */
export function moveEntries(
  view: PlannerView,
  ids: readonly string[],
  date: string,
  placement: PlannerPlacement | undefined,
  timing: EntryPatch,
): PlannerView {
  const moving = new Set(ids);
  const block: TaskScheduleEntry[] = [];
  for (const dayDate of [...view.days.keys()].sort()) {
    for (const entry of view.days.get(dayDate) ?? [])
      if (moving.has(entry.id)) block.push({ ...entry, ...timing, date });
  }
  if (block.length === 0) return view;
  const startTime = timing.startTime !== undefined ? timing.startTime : null;
  return placeBlock(removeEntries(view, moving), date, block, placement, startTime);
}
