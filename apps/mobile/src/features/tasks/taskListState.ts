import type { EnvironmentConnectionSummary } from "@t3tools/client-runtime/state/presentation";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import type { ScopedTaskListItem } from "@t3tools/tasks-client/state/taskPages";
import {
  defaultStatusGroupOrder,
  isStatusGroupOpen,
  statusGroupKey,
  taskStatusGroups,
} from "@t3tools/tasks-client/taskStatusGroups";
import {
  TASK_LAST_RUN_NONE,
  TaskArchiveFilter,
  taskStatusesFor,
  type TaskListSettings,
  type TaskPageInput,
  type TaskStatusCount,
  type TaskStatusCountsInput,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";
import { msg } from "gt-react-native";

/** Statuses whose groups start collapsed, as on the desktop. */
const CLOSED_STATUS_KEYS: ReadonlySet<string> = new Set(["done", "cancelled"]);

export const TASK_LIST_PAGE_SIZE = 50;

/** The Last run filter's value for tasks that never ran. */
export const NO_RUNS_FILTER = TASK_LAST_RUN_NONE;

/** The Last run filter's choices: the task system's raw run statuses, as on the desktop. */
export const LAST_RUN_OPTIONS = [
  { value: "running", label: msg("Working") },
  { value: "completed", label: msg("Completed") },
  { value: "failed", label: msg("Failed") },
  { value: "stopped", label: msg("Stopped") },
  { value: "blocked", label: msg("Blocked") },
  { value: "interrupted", label: msg("Interrupted") },
  { value: NO_RUNS_FILTER, label: msg("No runs") },
] as const;

/** The Show filter's choices; archived tasks stay hidden unless chosen here. */
export const ARCHIVE_OPTIONS: ReadonlyArray<{
  readonly value: TaskArchiveFilter;
  readonly label: string;
}> = [
  { value: "active", label: msg("Active") },
  { value: "archived", label: msg("Archived") },
  { value: "all", label: msg("Active and archived") },
];

/**
 * The desktop's Worker tasks filters for one computer: project, status, last run, tags and
 * archive. Null means no restriction (All projects, All statuses, Any last run).
 */
export const WorkerTaskFilters = Schema.Struct({
  projectId: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  archive: TaskArchiveFilter,
});
export type WorkerTaskFilters = typeof WorkerTaskFilters.Type;

export const DEFAULT_WORKER_TASK_FILTERS: WorkerTaskFilters = {
  projectId: null,
  status: null,
  lastRun: null,
  tags: [],
  archive: "active",
};

/** How many filters differ from their defaults, as the desktop's Filters button counts them. */
export function appliedWorkerTaskFilterCount(filters: WorkerTaskFilters): number {
  return [
    filters.projectId !== null,
    filters.status !== null,
    filters.lastRun !== null,
    filters.tags.length > 0,
    filters.archive !== "active",
  ].filter(Boolean).length;
}

/** A tag turned on or off in the Tags filter. */
export function toggledTag(tags: readonly string[], tag: string): readonly string[] {
  return tags.includes(tag) ? tags.filter((candidate) => candidate !== tag) : [...tags, tag];
}

/**
 * The workers' tasks the counts cover: the filters without the status, which the counts
 * choose from, as on the desktop.
 */
export function taskListCountsInput(filters: WorkerTaskFilters): TaskStatusCountsInput {
  return {
    audience: "agent",
    ...(filters.projectId === null ? {} : { projectId: ProjectId.make(filters.projectId) }),
    ...(filters.tags.length > 0 ? { tags: [...filters.tags] } : {}),
    ...(filters.archive === "active" ? {} : { archive: filters.archive }),
    ...(filters.lastRun === null ? {} : { lastRun: filters.lastRun }),
  };
}

/**
 * The page the list loads; rows leave out their text. A collapsed group's rows wait until it
 * opens, as on the desktop, so they never take the page's places.
 */
export function taskListPageInput(
  filters: WorkerTaskFilters,
  collapsed: readonly string[] = [],
): TaskPageInput {
  return {
    ...taskListCountsInput(filters),
    omitText: true,
    limit: TASK_LIST_PAGE_SIZE,
    ...(filters.status === null
      ? collapsed.length > 0
        ? { excludeStatuses: [...new Set(collapsed)] }
        : {}
      : { status: filters.status }),
  };
}

type GroupSettings = Pick<TaskListSettings, "groupByStatus" | "statusGroupOpen">;

/**
 * The status keys whose groups are collapsed, the user's choice or the desktop's default (Done
 * and Cancelled); none for one status. The server compares statuses without case.
 */
export function collapsedTaskStatuses(
  filters: Pick<WorkerTaskFilters, "status">,
  settings: GroupSettings,
): readonly string[] {
  if (filters.status !== null || !settings.groupByStatus) return [];
  const keys = new Set([...CLOSED_STATUS_KEYS, ...Object.keys(settings.statusGroupOpen)]);
  return [...keys].filter((key) => !isStatusGroupOpen(settings.statusGroupOpen, key)).sort();
}

/**
 * The Status filter's choices: the workflow's statuses, then any other status with tasks or the
 * one chosen, in the desktop's group order.
 */
export function workerStatusOptions(
  counts: readonly TaskStatusCount[],
  workflowVersion: TaskWorkflowVersion,
  chosen: string | null,
): readonly string[] {
  const order = defaultStatusGroupOrder(workflowVersion).map(statusGroupKey);
  const rank = (status: string) => {
    const index = order.indexOf(statusGroupKey(status));
    return index < 0 ? order.length : index;
  };
  const byKey = new Map<string, string>();
  for (const status of [
    ...taskStatusesFor(workflowVersion),
    ...counts.filter((count) => count.count > 0).map((count) => count.status),
    ...(chosen === null ? [] : [chosen]),
  ])
    if (!byKey.has(statusGroupKey(status))) byKey.set(statusGroupKey(status), status);
  return [...byKey.values()].sort(
    (left, right) => rank(left) - rank(right) || left.localeCompare(right),
  );
}

/** The Tags filter's choices: the loaded tasks' tags and the chosen ones, A to Z. */
export function workerTagOptions(
  tasks: readonly Pick<ScopedTaskListItem, "tags">[],
  chosen: readonly string[],
): readonly string[] {
  return [...new Set([...tasks.flatMap((task) => task.tags), ...chosen])].sort((left, right) =>
    left.localeCompare(right),
  );
}

export interface TaskListSection<T> {
  readonly key: string;
  /** Empty for the one section of an ungrouped list. */
  readonly title: string;
  /** The server's count for the section. */
  readonly count: number;
  readonly tasks: readonly T[];
  /** A collapsed group shows its header and count only. */
  readonly open: boolean;
}

/**
 * The loaded tasks in one section per status, in the desktop's group order. A status the
 * server counts but no loaded task has yet keeps no section, so the list never shows an empty
 * group.
 */
export function taskListSections<T extends Pick<ScopedTaskListItem, "status">>(input: {
  readonly tasks: readonly T[];
  readonly counts: readonly TaskStatusCount[];
  readonly statuses: readonly string[];
  readonly status: string | null;
  readonly workflowVersion: TaskWorkflowVersion;
  readonly settings: GroupSettings & Pick<TaskListSettings, "statusGroupOrder">;
}): readonly TaskListSection<T>[] {
  const { tasks } = input;
  if (!input.settings.groupByStatus)
    return tasks.length === 0
      ? []
      : [{ key: "all", title: "", count: tasks.length, tasks, open: true }];
  const oneStatus = input.status !== null;
  const { groups } = taskStatusGroups({
    tasks,
    counts: new Map(input.counts.map((count) => [statusGroupKey(count.status), count.count])),
    statuses: input.statuses,
    statusFilter: input.status,
    order: input.settings.statusGroupOrder,
    open: input.settings.statusGroupOpen,
    workflowVersion: input.workflowVersion,
  });
  return groups
    .map((group) => ({ ...group, open: oneStatus || group.open }))
    .filter((group) => (group.open ? group.tasks.length > 0 : group.count > 0))
    .map((group) => ({
      key: group.key,
      title: group.title,
      count: Math.max(group.count, group.tasks.length),
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
  | "filtered"
  | "empty";

export function taskListEmptyState(input: {
  readonly environment: TasksEnvironment | null;
  readonly availability: "loading" | "unavailable" | "enabled" | null;
  readonly initialLoading: boolean;
  readonly error: string | undefined;
  /** Filters differ from their defaults. */
  readonly filtered: boolean;
}): TaskListEmptyState {
  if (input.environment === null) return "noEnvironment";
  if (input.environment.connectionState !== "connected") return "offline";
  if (input.availability === "unavailable") return "unavailable";
  if (input.availability !== "enabled") return "checking";
  if (input.error !== undefined) return "error";
  if (input.initialLoading) return "loading";
  return input.filtered ? "filtered" : "empty";
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
