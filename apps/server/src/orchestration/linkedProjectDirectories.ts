import type { ProjectId } from "@upcomputer/contracts";
import { normalizeProjectPathForComparison } from "@upcomputer/shared/path";

interface LinkedProjectsOwner {
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface LinkedProjectDirectorySource {
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly deletedAt?: string | null | undefined;
}

/**
 * Project ids a thread's agent may access besides its own project: the
 * thread's links first, then its project's tags. Deduped, own project removed.
 */
export function collectLinkedProjectIds(input: {
  readonly thread: LinkedProjectsOwner & { readonly projectId: ProjectId };
  readonly threadProject: LinkedProjectsOwner | undefined;
}): ReadonlyArray<ProjectId> {
  const ids = new Set<ProjectId>([
    ...(input.thread.linkedProjectIds ?? []),
    ...(input.threadProject?.linkedProjectIds ?? []),
  ]);
  ids.delete(input.thread.projectId);
  return [...ids];
}

/**
 * Workspace roots of the thread's linked projects, handed to the provider as
 * extra directories. Deleted or unknown projects and the session cwd itself
 * are skipped; paths are deduped by their normalized form.
 */
export function resolveLinkedProjectDirectories(input: {
  readonly thread: LinkedProjectsOwner & { readonly projectId: ProjectId };
  readonly threadProject: LinkedProjectsOwner | undefined;
  readonly projects: ReadonlyArray<LinkedProjectDirectorySource>;
  readonly cwd: string | undefined;
}): ReadonlyArray<string> {
  const projectsById = new Map(input.projects.map((project) => [project.id, project]));
  const seenPaths = new Set<string>();
  if (input.cwd !== undefined) {
    seenPaths.add(normalizeProjectPathForComparison(input.cwd));
  }
  const directories: string[] = [];
  for (const projectId of collectLinkedProjectIds(input)) {
    const project = projectsById.get(projectId);
    if (project === undefined || (project.deletedAt ?? null) !== null) {
      continue;
    }
    const comparisonPath = normalizeProjectPathForComparison(project.workspaceRoot);
    if (seenPaths.has(comparisonPath)) {
      continue;
    }
    seenPaths.add(comparisonPath);
    directories.push(project.workspaceRoot);
  }
  return directories;
}
