import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { TaskArchiveFilter, TaskPageInput } from "@t3tools/tasks-contracts/v1";

import type { TasksStateTarget } from "../state/tasksState.ts";
import { ALL_FILTER } from "./pageFilters.ts";

/**
 * The logical project chosen in the Tasks, Agents and Automations headers
 * (grouped as the sidebar groups projects). A logical project may group
 * several physical projects, possibly across environments. `null` everywhere
 * means "All projects".
 */
export interface ViewProjectFilter {
  readonly key: string;
  readonly label: string;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
}

function viewProjectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

function projectFilterKeys(filter: ViewProjectFilter | null): ReadonlySet<string> | null {
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

export interface TaskQueryLane {
  /** Stable identity of the query lane (environment + optional project + search). */
  readonly key: string;
  readonly target: TasksStateTarget;
  readonly search: TaskPageInput;
}

/**
 * Task page queries for the current filters. The task search API takes a single
 * `projectId`, so a project with several member projects in one environment gets
 * one lane per project; "all projects" is one unscoped lane per environment.
 * Environments without a matching project get no lane. Tags are matched by the
 * server, which requires every given tag.
 */
export function planTaskQueryLanes(input: {
  readonly targets: ReadonlyArray<TasksStateTarget>;
  readonly projectFilter: ViewProjectFilter | null;
  readonly statusFilter: string;
  readonly tags?: ReadonlyArray<string>;
  /** Active, the server's default, when absent. */
  readonly archive?: TaskArchiveFilter;
  readonly pageSize: number;
}): TaskQueryLane[] {
  const keys = orderedProjectFilterKeys(input.projectFilter);
  const filterSearch = {
    ...(input.statusFilter === ALL_FILTER ? {} : { status: input.statusFilter }),
    ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
    ...(input.archive && input.archive !== "active" ? { archive: input.archive } : {}),
  };
  return input.targets.flatMap((target) => {
    if (keys === null) {
      const search: TaskPageInput = { ...filterSearch, limit: input.pageSize };
      return [{ key: JSON.stringify([target.environmentId, null, search]), target, search }];
    }
    const projectIds = new Set<ProjectId>();
    for (const ref of input.projectFilter?.projectRefs ?? []) {
      if (ref.environmentId === target.environmentId) projectIds.add(ref.projectId);
    }
    return [...projectIds].map((projectId) => {
      const search: TaskPageInput = { projectId, ...filterSearch, limit: input.pageSize };
      return { key: JSON.stringify([target.environmentId, projectId, search]), target, search };
    });
  });
}
