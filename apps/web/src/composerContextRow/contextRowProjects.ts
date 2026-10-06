/*
 * Which projects the row under the composer shows and offers, as V1's
 * `BranchToolbar` decided it, on upstream's thread links
 * (`linkedProjectIds`, changed through `threadEnvironment.updateMetadata`).
 */

interface RowProject {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
}

/**
 * What choosing a project from `+` does:
 * - `link`: a started thread links it right away.
 * - `retarget`: an unsent chat without a project moves into it, as V1 did.
 * - null: an unsent chat in a project cannot link yet. V1 kept a pending link
 *   until the first send; there is no such store here.
 */
export type ProjectChoiceEffect = "link" | "retarget" | null;

export function resolveProjectChoiceEffect(input: {
  readonly isServerThread: boolean;
  readonly isScratch: boolean;
}): ProjectChoiceEffect {
  if (input.isServerThread) return "link";
  return input.isScratch ? "retarget" : null;
}

/** The thread's linked projects in link order, without its own project and unknown ids. */
export function resolveLinkedProjects<Project extends RowProject>(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly environmentId: string;
  readonly ownProjectId: string;
  readonly linkedProjectIds: ReadonlyArray<string>;
}): Project[] {
  const byId = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project] as const),
  );
  return input.linkedProjectIds.flatMap((id) => {
    const project = byId.get(id);
    return project && project.id !== input.ownProjectId ? [project] : [];
  });
}

/** The `+` menu: the environment's projects other than the chat's own, linked or scratch ones. */
export function resolveLinkableProjects<Project extends RowProject>(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly environmentId: string;
  readonly excludedProjectIds: Iterable<string>;
  readonly isScratchProject: (project: Project) => boolean;
}): Project[] {
  const excluded = new Set(input.excludedProjectIds);
  return input.projects.filter(
    (project) =>
      project.environmentId === input.environmentId &&
      !excluded.has(project.id) &&
      !input.isScratchProject(project),
  );
}

function titleMatchRank(title: string, query: string): number | null {
  const normalized = title.trim().toLocaleLowerCase();
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  // Word starts: "api" matches "My API server", "web-app" matches "app".
  if (normalized.split(/[\s\-_./]+/u).some((word) => word.startsWith(query))) return 2;
  if (normalized.includes(query)) return 3;
  return null;
}

/**
 * Filters projects by title, best matches first (exact, prefix, word start,
 * substring), keeping the incoming order within a rank. An empty query keeps all.
 */
export function searchProjectsByTitle<Project extends { readonly title: string }>(
  projects: ReadonlyArray<Project>,
  query: string,
): Project[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [...projects];
  return projects
    .flatMap((project, index) => {
      const rank = titleMatchRank(project.title, normalizedQuery);
      return rank === null ? [] : [{ project, rank, index }];
    })
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.project);
}
