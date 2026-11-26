import type { EnvironmentConnectionSummary } from "@t3tools/client-runtime/state/presentation";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import {
  defaultStatusGroupOrder,
  isStatusGroupOpen,
  statusGroupKey,
  taskStatusGroups,
} from "@t3tools/tasks-client/taskStatusGroups";
import {
  taskStatusesFor,
  type TaskListSettings,
  type TaskPageInput,
  type TaskStatusCount,
  type TaskStatusCountsInput,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";

/** Statuses of finished tasks: the default list leaves them out. */
const CLOSED_TASK_STATUSES = ["Done", "Cancelled"] as const;
const CLOSED_STATUS_KEYS: ReadonlySet<string> = new Set(CLOSED_TASK_STATUSES.map(statusGroupKey));

export const TASK_LIST_PAGE_SIZE = 50;

/** Which tasks the list shows: open ones (the default), every one, or one status. */
export type TaskListFilter =
  | { readonly kind: "open" }
  | { readonly kind: "all" }
  | { readonly kind: "status"; readonly status: string };

export const OPEN_TASKS_FILTER: TaskListFilter = { kind: "open" };
/** Every status, as the desktop's table lists them, with Done and Cancelled collapsed. */
export const ALL_TASKS_FILTER: TaskListFilter = { kind: "all" };

export function taskListFilterKey(filter: TaskListFilter): string {
  return filter.kind === "status" ? `status:${statusGroupKey(filter.status)}` : filter.kind;
}

export function parseTaskListFilter(key: string, statuses: readonly string[]): TaskListFilter {
  if (key === "all") return { kind: "all" };
  if (key.startsWith("status:")) {
    const status = statuses.find((candidate) => statusGroupKey(candidate) === key.slice(7));
    if (status !== undefined) return { kind: "status", status };
  }
  return key === "open" ? OPEN_TASKS_FILTER : ALL_TASKS_FILTER;
}

/** The workers' tasks, as the desktop's task table lists them; rows leave out their text. */
export const TASK_LIST_COUNTS_INPUT: TaskStatusCountsInput = { audience: "agent" };

/**
 * The page the list loads: a collapsed group's rows wait until it opens, as on the desktop,
 * so they never take the page's places.
 */
export function taskListPageInput(
  filter: TaskListFilter,
  collapsed: readonly string[] = [],
): TaskPageInput {
  const excluded = [...(filter.kind === "open" ? CLOSED_TASK_STATUSES : []), ...collapsed];
  return {
    audience: "agent",
    omitText: true,
    limit: TASK_LIST_PAGE_SIZE,
    ...(filter.kind !== "status" && excluded.length > 0
      ? { excludeStatuses: [...new Set(excluded)] }
      : {}),
    ...(filter.kind === "status" ? { status: filter.status } : {}),
  };
}

type GroupSettings = Pick<TaskListSettings, "groupByStatus" | "statusGroupOpen">;

/**
 * The status keys whose groups are collapsed, the user's choice or the desktop's default (Done
 * and Cancelled); none for one status. The server compares statuses without case.
 */
export function collapsedTaskStatuses(
  filter: TaskListFilter,
  settings: GroupSettings,
): readonly string[] {
  if (filter.kind === "status" || !settings.groupByStatus) return [];
  const keys = new Set([...CLOSED_STATUS_KEYS, ...Object.keys(settings.statusGroupOpen)]);
  return [...keys].filter((key) => !isStatusGroupOpen(settings.statusGroupOpen, key)).sort();
}

export interface TaskStatusOption {
  readonly status: string;
  readonly count: number;
}

/** Statuses with tasks, in the desktop's group order, for the status filter. */
export function taskStatusOptions(
  counts: readonly TaskStatusCount[],
  workflowVersion: TaskWorkflowVersion,
): readonly TaskStatusOption[] {
  const order = defaultStatusGroupOrder(workflowVersion).map(statusGroupKey);
  const rank = (status: string) => {
    const index = order.indexOf(statusGroupKey(status));
    return index < 0 ? order.length : index;
  };
  return counts
    .filter((count) => count.count > 0)
    .map(({ status, count }) => ({ status, count }))
    .sort(
      (left, right) =>
        rank(left.status) - rank(right.status) || left.status.localeCompare(right.status),
    );
}

/** How many tasks a filter holds, from the counts per status. */
export function taskListFilterCount(
  filter: TaskListFilter,
  counts: readonly TaskStatusCount[],
): number {
  return counts
    .filter((count) =>
      filter.kind === "all"
        ? true
        : filter.kind === "open"
          ? !CLOSED_STATUS_KEYS.has(statusGroupKey(count.status))
          : statusGroupKey(count.status) === statusGroupKey(filter.status),
    )
    .reduce((sum, count) => sum + count.count, 0);
}

export interface TaskListSection<T> {
  readonly key: string;
  /** Empty for the one section of an ungrouped list. */
  readonly title: string;
  /** The server's count for the section, or the matches when searching. */
  readonly count: number;
  readonly tasks: readonly T[];
  /** A collapsed group shows its header and count only. */
  readonly open: boolean;
}

function matchesQuery(
  task: Pick<ScopedTaskListItem, "title" | "tags" | "status">,
  projectName: string | null,
  query: string,
): boolean {
  const needle = query.toLocaleLowerCase();
  return [task.title, task.status, projectName ?? "", ...task.tags].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

/**
 * The loaded tasks in one section per status, in the desktop's group order. A status the
 * server counts but no loaded task has yet keeps no section, so the list never shows an empty
 * group. A search narrows the loaded rows by title, status, project or tag.
 */
export function taskListSections<
  T extends Pick<ScopedTaskListItem, "title" | "tags" | "status" | "projectId">,
>(input: {
  readonly tasks: readonly T[];
  readonly counts: readonly TaskStatusCount[];
  readonly statuses: readonly string[];
  readonly filter: TaskListFilter;
  readonly workflowVersion: TaskWorkflowVersion;
  readonly query: string;
  readonly projectName: (task: T) => string | null;
  readonly settings: GroupSettings & Pick<TaskListSettings, "statusGroupOrder">;
}): readonly TaskListSection<T>[] {
  const query = input.query.trim();
  const tasks = query
    ? input.tasks.filter((task) => matchesQuery(task, input.projectName(task), query))
    : input.tasks;
  if (!input.settings.groupByStatus)
    return tasks.length === 0
      ? []
      : [{ key: "all", title: "", count: tasks.length, tasks, open: true }];
  const oneStatus = input.filter.kind === "status";
  const { groups } = taskStatusGroups({
    tasks,
    counts: new Map(input.counts.map((count) => [statusGroupKey(count.status), count.count])),
    statuses: input.statuses,
    statusFilter: oneStatus ? input.filter.status : null,
    order: input.settings.statusGroupOrder,
    open: input.settings.statusGroupOpen,
    workflowVersion: input.workflowVersion,
  });
  return groups
    .map((group) => ({ ...group, open: oneStatus || group.open }))
    .filter(
      (group) =>
        (input.filter.kind !== "open" || !CLOSED_STATUS_KEYS.has(group.key)) &&
        (group.open ? group.tasks.length > 0 : !query && group.count > 0),
    )
    .map((group) => ({
      key: group.key,
      title: group.title,
      count: query ? group.tasks.length : Math.max(group.count, group.tasks.length),
      tasks: group.open ? group.tasks : [],
      open: group.open,
    }));
}

/** The statuses a task can be moved to: the workflow's, plus its own when that is custom. */
export function taskStatusChoices(
  workflowVersion: TaskWorkflowVersion,
  current: string | null,
): readonly string[] {
  const statuses = taskStatusesFor(workflowVersion);
  return current === null ||
    statuses.some((status) => statusGroupKey(status) === statusGroupKey(current))
    ? statuses
    : [...statuses, current];
}

type TasksEnvironment = Pick<
  EnvironmentConnectionSummary,
  "environmentId" | "environmentLabel" | "connectionState" | "isEnabled"
>;

/** The environments the Tasks tab can show: the enabled ones, connected first. */
export function tasksEnvironments<E extends TasksEnvironment>(environments: readonly E[]): E[] {
  return environments
    .filter((environment) => environment.isEnabled)
    .sort(
      (left, right) =>
        Number(right.connectionState === "connected") -
          Number(left.connectionState === "connected") ||
        left.environmentLabel.localeCompare(right.environmentLabel),
    );
}

/** The one the person picked while it is still listed, else the first. */
export function chooseTasksEnvironment(
  environments: readonly TasksEnvironment[],
  picked: EnvironmentId | null,
): EnvironmentId | null {
  return (
    environments.find((environment) => environment.environmentId === picked)?.environmentId ??
    environments[0]?.environmentId ??
    null
  );
}

/** What the list says when it has no rows to show. */
export type TaskListEmptyState =
  | "noEnvironment"
  | "offline"
  | "checking"
  | "unavailable"
  | "loading"
  | "error"
  | "noResults"
  | "empty";

export function taskListEmptyState(input: {
  readonly environment: TasksEnvironment | null;
  readonly availability: "loading" | "unavailable" | "enabled" | null;
  readonly initialLoading: boolean;
  readonly error: string | undefined;
  readonly searching: boolean;
}): TaskListEmptyState {
  if (input.environment === null) return "noEnvironment";
  if (input.environment.connectionState !== "connected") return "offline";
  if (input.availability === "unavailable") return "unavailable";
  if (input.availability !== "enabled") return "checking";
  if (input.error !== undefined) return "error";
  if (input.initialLoading) return "loading";
  return input.searching ? "noResults" : "empty";
}

export interface NewTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly status: string;
}

/** Whether a draft can be created: it needs a title, the one field the server requires. */
export function canCreateTask(draft: NewTaskDraft): boolean {
  return draft.title.trim().length > 0 && draft.status.trim().length > 0;
}
