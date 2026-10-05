/**
 * Linked projects in the sidebar's project scope (UpComputer). A thread shows
 * under its own project, every project it links, and every project its own
 * project links. Keys are `environmentId:projectId`, as the scope uses; links
 * are environment-local.
 */

export interface LinkedProjectScopeThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly linkedProjectIds?: ReadonlyArray<string> | undefined;
}

/** Project-level links by project key, from the environments' project shells. */
export function projectLinksByKey(
  projects: ReadonlyArray<{
    readonly environmentId: string;
    readonly id: string;
    readonly linkedProjectIds?: ReadonlyArray<string> | undefined;
  }>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const links = new Map<string, ReadonlyArray<string>>();
  for (const project of projects) {
    if (project.linkedProjectIds !== undefined && project.linkedProjectIds.length > 0) {
      links.set(`${project.environmentId}:${project.id}`, project.linkedProjectIds);
    }
  }
  return links;
}

export function isThreadInProjectScope(
  thread: LinkedProjectScopeThread,
  scopedProjectKeys: ReadonlySet<string> | null,
  projectLinks: ReadonlyMap<string, ReadonlyArray<string>> | undefined,
): boolean {
  if (scopedProjectKeys === null) return true;
  const ownKey = `${thread.environmentId}:${thread.projectId}`;
  if (scopedProjectKeys.has(ownKey)) return true;
  const reached = [...(thread.linkedProjectIds ?? []), ...(projectLinks?.get(ownKey) ?? [])];
  return reached.some((projectId) => scopedProjectKeys.has(`${thread.environmentId}:${projectId}`));
}
