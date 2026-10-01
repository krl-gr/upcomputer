import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@upcomputer/contracts";
import type { TaskPageInput } from "@upcomputer/tasks-contracts/v1";

import type { TasksStateTarget } from "../state/tasksState.ts";

/**
 * The sidebar's selected logical project as seen by the Tasks, Agents, and
 * Automations views (structurally the host's `SidebarProjectFilter`). A
 * logical project may group several physical projects, possibly across
 * environments. `null` everywhere means "All projects".
 */
export interface ViewProjectFilter {
  readonly key: string;
  readonly label: string;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
}

/** "No restriction" value shared by the Tasks project and status dropdowns. */
export const ALL_FILTER = "__all__";
/** Task-view project dropdown values besides a concrete `${environmentId}:${projectId}` key. */
export const ALL_PROJECTS_FILTER = ALL_FILTER;
/** Follow the sidebar's selected logical project (every member project). */
export const SIDEBAR_PROJECTS_FILTER = "__sidebar__";

export function viewProjectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

export function projectFilterKeys(filter: ViewProjectFilter | null): ReadonlySet<string> | null {
  return filter
    ? new Set(filter.projectRefs.map((ref) => viewProjectKey(ref.environmentId, ref.projectId)))
    : null;
}

/** Member project keys in the sidebar's order (primary first); `null` = all projects. */
export function orderedProjectFilterKeys(filter: ViewProjectFilter | null): string[] | null {
  return filter
    ? filter.projectRefs.map((ref) => viewProjectKey(ref.environmentId, ref.projectId))
    : null;
}

/**
 * Keeps items that belong to one of the filter's member projects. Items with
 * a `null` project (global agents) are kept only when `includeGlobal` is set.
 * Returns the input array unchanged when there is no filter.
 */
export function filterByProjectFilter<
  T extends { readonly environmentId: EnvironmentId; readonly projectId: ProjectId | null },
>(
  items: ReadonlyArray<T>,
  filter: ViewProjectFilter | null,
  options: { readonly includeGlobal?: boolean } = {},
): ReadonlyArray<T> {
  const keys = projectFilterKeys(filter);
  if (!keys) return items;
  return items.filter((item) =>
    item.projectId === null
      ? options.includeGlobal === true
      : keys.has(viewProjectKey(item.environmentId, item.projectId)),
  );
}

/**
 * Project to preselect in a create form: the first candidate (in `preferredKeys`
 * order, e.g. the sidebar's member order) that is available, else the first
 * available project.
 */
export function preferredProject<
  P extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(projects: ReadonlyArray<P>, preferredKeys: ReadonlyArray<string> | null): P | undefined {
  if (preferredKeys) {
    const byKey = new Map(
      projects.map((project) => [viewProjectKey(project.environmentId, project.id), project]),
    );
    for (const key of preferredKeys) {
      const project = byKey.get(key);
      if (project) return project;
    }
  }
  return projects[0];
}

/**
 * Effective Tasks dropdown value: a local choice made while the current sidebar
 * selection was active, otherwise the sidebar selection itself. Changing the
 * sidebar selection therefore always takes effect, discarding the local choice.
 */
export function resolveTaskProjectFilter(
  override: { readonly sidebarKey: string | null; readonly value: string } | null,
  sidebarFilter: ViewProjectFilter | null,
): string {
  const sidebarKey = sidebarFilter?.key ?? null;
  if (override && override.sidebarKey === sidebarKey) {
    if (override.value !== SIDEBAR_PROJECTS_FILTER || sidebarFilter) return override.value;
  }
  return sidebarFilter ? SIDEBAR_PROJECTS_FILTER : ALL_PROJECTS_FILTER;
}

/** Project keys the effective Tasks dropdown value covers; `null` = all projects. */
export function taskProjectFilterKeys(
  projectFilter: string,
  sidebarFilter: ViewProjectFilter | null,
): readonly string[] | null {
  if (projectFilter === ALL_PROJECTS_FILTER) return null;
  if (projectFilter === SIDEBAR_PROJECTS_FILTER) return orderedProjectFilterKeys(sidebarFilter);
  return [projectFilter];
}

export interface TaskQueryLane {
  /** Stable identity of the query lane (environment + optional project + search). */
  readonly key: string;
  readonly target: TasksStateTarget;
  readonly search: TaskPageInput;
}

/**
 * Task page queries for the current filters. The task search API takes a single
 * `projectId`, so a scope with several member projects in one environment gets
 * one lane per project; "all projects" is one unscoped lane per environment.
 * Environments without a matching project get no lane.
 */
export function planTaskQueryLanes(input: {
  readonly targets: ReadonlyArray<TasksStateTarget>;
  readonly projectFilter: string;
  readonly statusFilter: string;
  readonly sidebarFilter: ViewProjectFilter | null;
  readonly pageSize: number;
}): TaskQueryLane[] {
  const keys = taskProjectFilterKeys(input.projectFilter, input.sidebarFilter);
  const statusSearch = input.statusFilter === ALL_FILTER ? {} : { status: input.statusFilter };
  return input.targets.flatMap((target) => {
    if (keys === null) {
      const search: TaskPageInput = { ...statusSearch, limit: input.pageSize };
      return [{ key: JSON.stringify([target.environmentId, null, search]), target, search }];
    }
    const projectIds = new Set<ProjectId>();
    for (const ref of input.sidebarFilter?.projectRefs ?? []) {
      if (
        ref.environmentId === target.environmentId &&
        keys.includes(viewProjectKey(ref.environmentId, ref.projectId))
      )
        projectIds.add(ref.projectId);
    }
    for (const projectId of target.projectNameById?.keys() ?? []) {
      if (keys.includes(viewProjectKey(target.environmentId, projectId))) projectIds.add(projectId);
    }
    return [...projectIds].map((projectId) => {
      const search: TaskPageInput = { projectId, ...statusSearch, limit: input.pageSize };
      return { key: JSON.stringify([target.environmentId, projectId, search]), target, search };
    });
  });
}
