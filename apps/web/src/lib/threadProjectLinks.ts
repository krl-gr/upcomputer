import type { EnvironmentId, ProjectId } from "@upcomputer/contracts";

/**
 * Pure helpers for choosing projects from a chat: the "Select Project" /
 * "+ Project" menu under the composer and `@project` mentions.
 *
 * A thread's working folder is fixed at its first message. Before that, a
 * chat without a project can still be moved into a project (retarget).
 * Afterwards, and for chats already in a project, choosing a project links
 * it: the thread shows under it too and its agent may use its folder.
 */

export interface ProjectLinkCandidate {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
}

export interface ScopedProjectLink {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/**
 * Projects a thread can link: same environment (links are project ids within
 * one environment), never the hidden "No project" home, the thread's own
 * project, or one that is already linked.
 */
export function selectLinkableProjects<T extends ProjectLinkCandidate>(input: {
  readonly projects: ReadonlyArray<T>;
  readonly environmentId: EnvironmentId;
  readonly isScratchProject: (project: T) => boolean;
  readonly excludedProjectIds: Iterable<ProjectId>;
}): T[] {
  const excluded = new Set(input.excludedProjectIds);
  return input.projects.filter(
    (project) =>
      project.environmentId === input.environmentId &&
      !excluded.has(project.id) &&
      !input.isScratchProject(project),
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function titleMatchRank(title: string, query: string): number | null {
  const normalizedTitle = normalizeSearchText(title);
  if (normalizedTitle === query) return 0;
  if (normalizedTitle.startsWith(query)) return 1;
  // Word starts: "api" matches "My API server", "web-app" matches "app".
  if (normalizedTitle.split(/[\s\-_./]+/u).some((word) => word.startsWith(query))) return 2;
  if (normalizedTitle.includes(query)) return 3;
  return null;
}

/**
 * Filters projects by title, best matches first (exact, prefix, word start,
 * substring). Keeps the incoming order within a rank, so callers can pass a
 * list already in sidebar order. An empty query keeps every project.
 */
export function searchProjectsByTitle<T extends { readonly title: string }>(
  projects: ReadonlyArray<T>,
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [...projects];
  return projects
    .flatMap((project, index) => {
      const rank = titleMatchRank(project.title, normalizedQuery);
      return rank === null ? [] : [{ project, rank, index }];
    })
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.project);
}

/** The composer's `@` menu shows a few project matches above file matches. */
export const PROJECT_MENTION_LIMIT = 5;

export function matchProjectMentions<T extends { readonly title: string }>(
  projects: ReadonlyArray<T>,
  query: string,
  limit = PROJECT_MENTION_LIMIT,
): T[] {
  return searchProjectsByTitle(projects, query).slice(0, limit);
}

/**
 * Plain text a picked `@project` mention leaves in the prompt. Titles with
 * spaces or quotes use the composer's quoted form (`@"My App"`), so the
 * whole title stays one mention token instead of `@My` plus loose text.
 */
export function formatProjectMentionText(title: string): string {
  const trimmed = title.trim();
  if (/^[^\s@"]+$/u.test(trimmed)) return `@${trimmed} `;
  return `@"${trimmed.replace(/["\\]/gu, "\\$&")}" `;
}

/**
 * What choosing a project from the composer does:
 * - `retarget`: a chat without a project that has not been sent yet moves
 *   into the project (its working folder becomes the project's).
 * - `pending-link`: any other draft remembers the project and links it once
 *   the first send has created the thread.
 * - `link`: a started thread links the project right away.
 */
export type ProjectChoiceEffect = "retarget" | "pending-link" | "link";

export function resolveProjectChoiceEffect(input: {
  readonly isServerThread: boolean;
  readonly isScratchProject: boolean;
}): ProjectChoiceEffect {
  if (input.isServerThread) return "link";
  return input.isScratchProject ? "retarget" : "pending-link";
}

function sameProjectLink(left: ScopedProjectLink, right: ScopedProjectLink): boolean {
  return left.environmentId === right.environmentId && left.projectId === right.projectId;
}

export function addPendingProjectLink(
  links: ReadonlyArray<ScopedProjectLink>,
  link: ScopedProjectLink,
): ReadonlyArray<ScopedProjectLink> {
  return links.some((existing) => sameProjectLink(existing, link)) ? links : [...links, link];
}

export function removePendingProjectLink(
  links: ReadonlyArray<ScopedProjectLink>,
  link: ScopedProjectLink,
): ReadonlyArray<ScopedProjectLink> {
  const next = links.filter((existing) => !sameProjectLink(existing, link));
  return next.length === links.length ? links : next;
}

/**
 * Pending links that still apply to a thread created from a draft. A draft
 * can change project or environment after a mention, so drop links to the
 * thread's own project, to other environments, to projects that no longer
 * exist, and ones the thread already has.
 */
export function resolvePendingProjectLinks(input: {
  readonly pending: ReadonlyArray<ScopedProjectLink>;
  readonly environmentId: EnvironmentId;
  readonly threadProjectId: ProjectId;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
  readonly availableProjectIds: ReadonlySet<ProjectId>;
}): ProjectId[] {
  const alreadyLinked = new Set(input.linkedProjectIds ?? []);
  const result: ProjectId[] = [];
  for (const link of input.pending) {
    if (
      link.environmentId !== input.environmentId ||
      link.projectId === input.threadProjectId ||
      alreadyLinked.has(link.projectId) ||
      !input.availableProjectIds.has(link.projectId) ||
      result.includes(link.projectId)
    ) {
      continue;
    }
    result.push(link.projectId);
  }
  return result;
}
