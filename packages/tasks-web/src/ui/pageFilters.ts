import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../../../apps/web/src/hooks/useLocalStorage.ts";

/**
 * Project chosen in the Tasks, Agents and Automations headers: one logical
 * project key (as the sidebar groups projects), or null for "All projects".
 * Shared by the three pages and independent of the sidebar's own project scope.
 */
export const PAGES_PROJECT_STORAGE_KEY = "upcomputer:pages:project";
const PagesProjectKey = Schema.NullOr(Schema.String);

export function usePagesProjectKey() {
  return useLocalStorage(PAGES_PROJECT_STORAGE_KEY, null, PagesProjectKey);
}

/** "No restriction" value of the Tasks status and last-run dropdowns. */
export const ALL_FILTER = "__all__";
/** Last-run dropdown value for tasks that never ran. */
export const NO_RUNS_FILTER = "__none__";

/** Last-run dropdown options: the task system's raw run statuses. */
export const LAST_RUN_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "running", label: "Working" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
  { value: "blocked", label: "Blocked" },
  { value: "interrupted", label: "Interrupted" },
  { value: NO_RUNS_FILTER, label: "No runs" },
];

/** Filters of the Tasks table besides the shared project, kept across visits. */
export const TasksPageFilters = Schema.Struct({
  status: Schema.String,
  lastRun: Schema.String,
  tags: Schema.Array(Schema.String),
});
export type TasksPageFilters = typeof TasksPageFilters.Type;

export const TASKS_PAGE_FILTERS_STORAGE_KEY = "upcomputer:tasks:filters";
export const DEFAULT_TASKS_PAGE_FILTERS: TasksPageFilters = {
  status: ALL_FILTER,
  lastRun: ALL_FILTER,
  tags: [],
};

export function useTasksPageFilters() {
  return useLocalStorage(
    TASKS_PAGE_FILTERS_STORAGE_KEY,
    DEFAULT_TASKS_PAGE_FILTERS,
    TasksPageFilters,
  );
}

/**
 * Whether a task's latest run matches the last-run filter. Older servers send
 * no latest status: such a task matches only "all" and, without runs, "No runs".
 */
export function matchesLastRunFilter(
  task: {
    readonly runCounts: ReadonlyArray<unknown>;
    readonly latestRunStatus?: string | null | undefined;
  },
  lastRun: string,
): boolean {
  if (lastRun === ALL_FILTER) return true;
  if (lastRun === NO_RUNS_FILTER) return task.runCounts.length === 0;
  return task.latestRunStatus === lastRun;
}

/** Tags an enabled agent starts on; the table renders them dimmer. */
export function agentTriggerTags(
  agents: ReadonlyArray<{ readonly enabled: boolean; readonly startTags: ReadonlyArray<string> }>,
): ReadonlySet<string> {
  return new Set(agents.flatMap((agent) => (agent.enabled ? agent.startTags : [])));
}
