import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { useLocalStorage } from "../../../../apps/web/src/hooks/useLocalStorage.ts";

/** The standard statuses, in the order their groups show by default. */
export const DEFAULT_STATUS_GROUP_ORDER = [
  "Needs Input",
  "Needs Review",
  "In Review",
  "In Progress",
  "To Do",
  "Backlog",
  "Blocked",
  "Idea",
  "Done",
  "Cancelled",
] as const;

/** Groups that start collapsed until the user opens them. */
const START_COLLAPSED: ReadonlySet<string> = new Set(["done", "cancelled"]);

/** Statuses are free text: one group per status whatever its letter case. */
export function statusGroupKey(status: string): string {
  return status.trim().toLowerCase();
}

/**
 * Grouping of the agents' task list by status: on or off, the user's group
 * order, and which groups are open. Design stand-in: kept per device in local
 * storage; the build stores it with the tasks so it follows the user.
 */
const TaskStatusGrouping = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  /** Group keys in the user's order. A group missing here keeps its default place. */
  order: Schema.optional(Schema.Array(Schema.String)),
  /** Group key to open. A group missing here takes its default. */
  open: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
});
type TaskStatusGrouping = typeof TaskStatusGrouping.Type;

const STORAGE_KEY = "upcomputer:tasks:status-groups";
const DEFAULT_GROUPING: TaskStatusGrouping = {};

export interface TaskStatusGroup<T> {
  readonly key: string;
  readonly title: string;
  readonly tasks: readonly T[];
  readonly open: boolean;
}

/**
 * One group per status, empty ones included: the standard statuses in the
 * default order, then any other status in the data by name, all re-sorted by
 * the user's own order. A status filter leaves only its group.
 */
export function taskStatusGroups<T extends { readonly status: string }>(input: {
  readonly tasks: readonly T[];
  readonly statuses: readonly string[];
  readonly statusFilter: string | null;
  readonly order: readonly string[];
  readonly open: Readonly<Record<string, boolean>>;
}): readonly TaskStatusGroup<T>[] {
  const titles = new Map<string, string>(
    DEFAULT_STATUS_GROUP_ORDER.map((status) => [statusGroupKey(status), status]),
  );
  const custom = new Map<string, string>();
  for (const status of [...input.statuses, ...input.tasks.map((task) => task.status)]) {
    const key = statusGroupKey(status);
    if (key && !titles.has(key) && !custom.has(key)) custom.set(key, status.trim());
  }
  for (const [key, title] of [...custom].sort((left, right) => left[1].localeCompare(right[1])))
    titles.set(key, title);

  const byKey = new Map<string, T[]>();
  for (const task of input.tasks) {
    const key = statusGroupKey(task.status);
    const list = byKey.get(key);
    if (list) list.push(task);
    else byKey.set(key, [task]);
  }

  const defaultKeys = [...titles.keys()];
  const place = (key: string) => {
    const index = input.order.indexOf(key);
    return index === -1 ? input.order.length + defaultKeys.indexOf(key) : index;
  };
  const filterKey = input.statusFilter === null ? null : statusGroupKey(input.statusFilter);
  return defaultKeys
    .filter((key) => filterKey === null || key === filterKey)
    .sort((left, right) => place(left) - place(right))
    .map((key) => ({
      key,
      title: titles.get(key) ?? key,
      tasks: byKey.get(key) ?? [],
      open: input.open[key] ?? !START_COLLAPSED.has(key),
    }));
}

/**
 * The order after a group is dropped into the gap before `insertIndex` (the
 * list's length for the end). Returns `keys` itself when nothing moves.
 */
export function movedGroupOrder(
  keys: readonly string[],
  activeKey: string,
  insertIndex: number,
): readonly string[] {
  const from = keys.indexOf(activeKey);
  if (from < 0 || insertIndex < 0 || insertIndex > keys.length) return keys;
  const to = insertIndex > from ? insertIndex - 1 : insertIndex;
  if (to === from) return keys;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, activeKey);
  return next;
}

export function useTaskStatusGrouping() {
  const [stored, setStored] = useLocalStorage(STORAGE_KEY, DEFAULT_GROUPING, TaskStatusGrouping);
  const setEnabled = useCallback(
    (enabled: boolean) => setStored((current) => ({ ...current, enabled })),
    [setStored],
  );
  const setOrder = useCallback(
    (order: readonly string[]) => setStored((current) => ({ ...current, order: [...order] })),
    [setStored],
  );
  const setOpen = useCallback(
    (key: string, open: boolean) =>
      setStored((current) => ({ ...current, open: { ...current.open, [key]: open } })),
    [setStored],
  );
  return {
    enabled: stored.enabled ?? true,
    order: stored.order ?? [],
    open: stored.open ?? {},
    setEnabled,
    setOrder,
    setOpen,
  };
}
