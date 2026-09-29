import { scopedProjectKey, scopeProjectRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@upcomputer/contracts";
import { isPathWithinRoot } from "@upcomputer/shared/path";

/**
 * Pure helpers behind the unified sidebar: which projects a thread "shows
 * under", filtering the chat list by the selected project, the leading
 * project-icon stack, and resolving the persisted filter key.
 *
 * A thread belongs to project P for display when its own project is P, P is in
 * the thread's `linkedProjectIds`, or P is in its own project's
 * `linkedProjectIds`. Linked ids are environment-local, and unknown or deleted
 * ids are ignored.
 */

export interface SidebarFilterProjectInput {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
  readonly workspaceRoot?: string | undefined;
}

export interface SidebarFilterThreadInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface SidebarLogicalProjectInput {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

export interface SidebarProjectFilter {
  /** Logical project key (the same key the Projects section selects). */
  readonly key: string;
  readonly label: string;
  /** Every physical project grouped under the logical project. */
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
}

export function buildProjectIndex<P extends SidebarFilterProjectInput>(
  projects: ReadonlyArray<P>,
): ReadonlyMap<string, P> {
  return new Map(
    projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
}

/**
 * Projects a thread shows under, in display order: its own project, then its
 * own links, then its project's links. Deduplicated; ids that are not in
 * `projectByKey` (unknown, deleted, other environment) are dropped.
 */
export function resolveThreadDisplayProjects<P extends SidebarFilterProjectInput>(
  thread: SidebarFilterThreadInput,
  projectByKey: ReadonlyMap<string, P>,
): P[] {
  const keyFor = (projectId: ProjectId) =>
    scopedProjectKey(scopeProjectRef(thread.environmentId, projectId));
  const ownProject = projectByKey.get(keyFor(thread.projectId));
  const candidateIds: ProjectId[] = [
    thread.projectId,
    ...(thread.linkedProjectIds ?? []),
    ...(ownProject?.linkedProjectIds ?? []),
  ];
  const seen = new Set<string>();
  const result: P[] = [];
  for (const projectId of candidateIds) {
    const key = keyFor(projectId);
    if (seen.has(key)) continue;
    seen.add(key);
    const project = projectByKey.get(key);
    if (project) result.push(project);
  }
  return result;
}

/** Scoped project keys a thread belongs to (own project always included, even if not loaded). */
export function resolveThreadBelongingProjectKeys(
  thread: SidebarFilterThreadInput,
  projectByKey: ReadonlyMap<string, SidebarFilterProjectInput>,
): Set<string> {
  const keys = new Set<string>([
    scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
  ]);
  for (const project of resolveThreadDisplayProjects(thread, projectByKey)) {
    keys.add(scopedProjectKey(scopeProjectRef(project.environmentId, project.id)));
  }
  return keys;
}

export function threadBelongsToProjectRefs(
  thread: SidebarFilterThreadInput,
  projectByKey: ReadonlyMap<string, SidebarFilterProjectInput>,
  filterProjectKeys: ReadonlySet<string>,
): boolean {
  for (const key of resolveThreadBelongingProjectKeys(thread, projectByKey)) {
    if (filterProjectKeys.has(key)) return true;
  }
  return false;
}

/** Keeps threads that belong to any of `projectRefs`; `null` refs (All projects) keeps everything. */
export function filterThreadsByProjectRefs<T extends SidebarFilterThreadInput>(
  threads: ReadonlyArray<T>,
  projectByKey: ReadonlyMap<string, SidebarFilterProjectInput>,
  projectRefs: ReadonlyArray<ScopedProjectRef> | null,
): T[] {
  if (projectRefs === null) return [...threads];
  const filterProjectKeys = new Set(projectRefs.map((ref) => scopedProjectKey(ref)));
  return threads.filter((thread) =>
    threadBelongsToProjectRefs(thread, projectByKey, filterProjectKeys),
  );
}

export interface ThreadProjectIconStack<P> {
  /** Up to `limit` projects to draw, own project first. */
  readonly visibleProjects: P[];
  /** Every project the thread shows under (tooltip), nested ones folded into their parent. */
  readonly allProjects: P[];
  /** Scratch ("No project") chat without links: draw the muted chat icon instead. */
  readonly showScratchIcon: boolean;
}

export const THREAD_PROJECT_ICON_STACK_LIMIT = 3;

/**
 * Drops projects whose folder sits inside another listed project's folder in
 * the same environment, so a thread linked to a repo and its parent workspace
 * shows only the parent.
 */
export function collapseNestedProjects<P extends SidebarFilterProjectInput>(
  projects: ReadonlyArray<P>,
): P[] {
  return projects.filter((project) => {
    const root = project.workspaceRoot;
    if (root === undefined) return true;
    return !projects.some(
      (other) =>
        other !== project &&
        other.environmentId === project.environmentId &&
        other.workspaceRoot !== undefined &&
        other.workspaceRoot !== root &&
        isPathWithinRoot(root, other.workspaceRoot),
    );
  });
}

export function resolveThreadProjectIconStack<P extends SidebarFilterProjectInput>(input: {
  thread: SidebarFilterThreadInput;
  projectByKey: ReadonlyMap<string, P>;
  isScratchProject: (project: P) => boolean;
  limit?: number;
}): ThreadProjectIconStack<P> {
  const allProjects = collapseNestedProjects(
    resolveThreadDisplayProjects(input.thread, input.projectByKey).filter(
      (project) => !input.isScratchProject(project),
    ),
  );
  const ownProject = input.projectByKey.get(
    scopedProjectKey(scopeProjectRef(input.thread.environmentId, input.thread.projectId)),
  );
  return {
    visibleProjects: allProjects.slice(0, input.limit ?? THREAD_PROJECT_ICON_STACK_LIMIT),
    allProjects,
    showScratchIcon:
      allProjects.length === 0 && ownProject !== undefined && input.isScratchProject(ownProject),
  };
}

/** Resolves the persisted filter key against the current logical projects; null = All projects. */
export function resolveSidebarProjectFilter(
  key: string | null,
  logicalProjects: ReadonlyArray<SidebarLogicalProjectInput>,
): SidebarProjectFilter | null {
  if (key === null) return null;
  const project = logicalProjects.find((candidate) => candidate.projectKey === key);
  if (!project) return null;
  return {
    key: project.projectKey,
    label: project.displayName,
    projectRefs: project.memberProjectRefs,
  };
}

/** Logical project key that contains a physical project, for "Open project" from a thread. */
export function findLogicalProjectKeyForRef(
  ref: ScopedProjectRef,
  logicalProjects: ReadonlyArray<SidebarLogicalProjectInput>,
): string | null {
  const key = scopedProjectKey(ref);
  return (
    logicalProjects.find((project) =>
      project.memberProjectRefs.some((memberRef) => scopedProjectKey(memberRef) === key),
    )?.projectKey ?? null
  );
}

/**
 * First `limit` projects in their existing order, keeping the selected one
 * visible: when it falls past the preview it takes the last preview slot.
 */
export function selectPreviewProjects<T extends { readonly projectKey: string }>(
  projects: ReadonlyArray<T>,
  selectedProjectKey: string | null,
  limit: number,
): T[] {
  const preview = projects.slice(0, limit);
  if (
    selectedProjectKey === null ||
    limit <= 0 ||
    preview.some((project) => project.projectKey === selectedProjectKey)
  ) {
    return preview;
  }
  const selected = projects.find((project) => project.projectKey === selectedProjectKey);
  return selected ? [...preview.slice(0, limit - 1), selected] : preview;
}
