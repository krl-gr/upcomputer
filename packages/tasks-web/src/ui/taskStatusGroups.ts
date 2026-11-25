import {
  LEGACY_TASK_WORKFLOW_VERSION,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";

/** Workflow 1's standard statuses, in the order their groups show by default. */
export const LEGACY_STATUS_GROUP_ORDER = [
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

/** The standard statuses, in the order their groups show by default. */
export const DEFAULT_STATUS_GROUP_ORDER = [
  "Needs You",
  "Failed",
  "Blocked",
  "In Review",
  "In Progress",
  "To Do",
  "Queued",
  "To Verify",
  "Idea",
  "Done",
  "Cancelled",
] as const;

export function defaultStatusGroupOrder(version: TaskWorkflowVersion): readonly string[] {
  return version === LEGACY_TASK_WORKFLOW_VERSION
    ? LEGACY_STATUS_GROUP_ORDER
    : DEFAULT_STATUS_GROUP_ORDER;
}

/** Groups that start collapsed until the user opens them. */
const START_COLLAPSED: ReadonlySet<string> = new Set(["done", "cancelled"]);

/** Statuses are free text: one group per status whatever its letter case. */
export function statusGroupKey(status: string): string {
  return status.trim().toLowerCase();
}

export function sameStatusGroup(left: string, right: string): boolean {
  return statusGroupKey(left) === statusGroupKey(right);
}

/** The tasks of one status's group, in their order: where a task of that status can move. */
export function tasksOfGroup<T extends { readonly status: string }>(
  tasks: readonly T[],
  status: string,
): readonly T[] {
  return tasks.filter((task) => sameStatusGroup(task.status, status));
}

/** Whether a group is open: the user's choice, else open but for Done and Cancelled. */
export function isStatusGroupOpen(open: Readonly<Record<string, boolean>>, key: string): boolean {
  return open[key] ?? !START_COLLAPSED.has(key);
}

/** The groups that stay loaded while closed: `kept`, and each one this change closed. */
export function keptStatusGroups(
  kept: ReadonlySet<string>,
  before: Readonly<Record<string, boolean>>,
  after: Readonly<Record<string, boolean>>,
): ReadonlySet<string> {
  const closed = Object.keys(after).filter(
    (key) => !isStatusGroupOpen(after, key) && isStatusGroupOpen(before, key) && !kept.has(key),
  );
  return closed.length === 0 ? kept : new Set([...kept, ...closed]);
}

export interface TaskStatusGroup<T> {
  readonly key: string;
  readonly title: string;
  /** The server's count for the list's filters; loaded tasks may be fewer. */
  readonly count: number;
  readonly tasks: readonly T[];
  readonly open: boolean;
}

/**
 * One group per status with tasks (counted, or loaded before its count
 * arrives), in the user's order. A status without tasks keeps its place in
 * `order`, so its group comes back where it was.
 */
export function taskStatusGroups<T extends { readonly status: string }>(input: {
  readonly tasks: readonly T[];
  /** Tasks per status key, from the server. */
  readonly counts: ReadonlyMap<string, number>;
  /** Status names to title the groups. */
  readonly statuses: readonly string[];
  readonly statusFilter: string | null;
  readonly order: readonly string[];
  readonly open: Readonly<Record<string, boolean>>;
  readonly workflowVersion: TaskWorkflowVersion;
}): { readonly groups: readonly TaskStatusGroup<T>[]; readonly order: readonly string[] } {
  const titles = new Map<string, string>(
    defaultStatusGroupOrder(input.workflowVersion).map((status) => [
      statusGroupKey(status),
      status,
    ]),
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

  // Every status ever ordered or known now, so a hidden group's place survives a reorder.
  const defaultKeys = [...titles.keys()];
  const order = [...input.order, ...defaultKeys.filter((key) => !input.order.includes(key))];
  const filterKey = input.statusFilter === null ? null : statusGroupKey(input.statusFilter);
  return {
    order,
    groups: order
      .filter(
        (key) =>
          (filterKey === null || key === filterKey) &&
          ((input.counts.get(key) ?? 0) > 0 || byKey.has(key)),
      )
      .map((key) => ({
        key,
        title: titles.get(key) ?? key,
        count: input.counts.get(key) ?? byKey.get(key)?.length ?? 0,
        tasks: byKey.get(key) ?? [],
        open: isStatusGroupOpen(input.open, key),
      })),
  };
}

/**
 * The full order after one shown group moved: `moved` goes right before the
 * shown group that now follows it, or right after the one before it. Groups
 * that are not shown keep their places.
 */
export function mergedGroupOrder(
  order: readonly string[],
  shown: readonly string[],
  moved: string,
): readonly string[] {
  const index = shown.indexOf(moved);
  const rest = order.filter((key) => key !== moved);
  const next = shown[index + 1];
  const previous = shown[index - 1];
  const at =
    next !== undefined
      ? rest.indexOf(next)
      : previous !== undefined
        ? rest.indexOf(previous) + 1
        : rest.length;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
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
