import { findProjectByPath } from "@upcomputer/client-runtime/state/projects";
import type { AgentSessionProjectCandidate, EnvironmentId, ProjectId } from "@upcomputer/contracts";

const RECENT_PROJECT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Existing projects still need their agent history imported, so every scan
 * candidate is offered. The default selection is every project active in the
 * last 30 days, git repository or not, whatever its number of conversations.
 * The scanner has already left out the directories it excludes.
 */
export function partitionOnboardingProjects<T extends AgentSessionProjectCandidate>(
  candidates: ReadonlyArray<T>,
  now = Date.now(),
) {
  const cutoff = now - RECENT_PROJECT_WINDOW_MS;

  return {
    available: candidates,
    recent: candidates.filter((candidate) => {
      if (candidate.lastActiveAt === null) return false;
      const lastActiveAt = Date.parse(candidate.lastActiveAt);
      return lastActiveAt >= cutoff && lastActiveAt <= now;
    }),
  };
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Summarizes an import that did not finish every selected project. Each
 * attempt reads a bounded number of conversations; the rest are deferred and a
 * later attempt continues with them, so that case asks to run import again.
 */
export function describeImportWarning(input: {
  readonly importedThreadCount: number;
  readonly skippedThreadCount: number;
  readonly deferredThreadCount: number;
}): string {
  const { importedThreadCount, skippedThreadCount, deferredThreadCount } = input;
  if (deferredThreadCount > 0) {
    const total = importedThreadCount + skippedThreadCount + deferredThreadCount;
    const skipped =
      skippedThreadCount > 0
        ? ` ${pluralize(skippedThreadCount, "conversation")} could not be imported.`
        : "";
    return `Imported ${importedThreadCount} of ${pluralize(total, "conversation")}.${skipped} Run import again to continue.`;
  }
  if (importedThreadCount > 0 && skippedThreadCount > 0) {
    return `Imported ${pluralize(importedThreadCount, "conversation")}. ${pluralize(skippedThreadCount, "conversation")} could not be imported.`;
  }
  if (skippedThreadCount > 0) {
    return `${pluralize(skippedThreadCount, "conversation")} could not be imported.`;
  }
  if (importedThreadCount > 0) {
    return `Imported ${pluralize(importedThreadCount, "conversation")}. Some projects could not be imported.`;
  }
  return "Could not import conversation history.";
}

export interface OnboardingProjectGroup<T> {
  /** Stable identity for collapse state and React keys. */
  readonly key: string;
  /** GitHub `owner/name`, or the checkout's folder name when the origin is elsewhere. */
  readonly label: string;
  readonly repository: string | null;
  readonly candidates: ReadonlyArray<T>;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}

function latestActivity(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

/**
 * Group scan candidates for the onboarding picker. Clones of one repository
 * share a group keyed by their normalized origin URL. Repositories without an
 * origin get a group each, as do candidates from servers that do not report
 * git identity. Directories that are not git repositories are returned
 * separately so the UI can fold them away by default. Groups sort by most
 * recent activity, newest first.
 */
export function groupOnboardingProjects<
  T extends Pick<
    AgentSessionProjectCandidate,
    "path" | "title" | "git" | "threadCount" | "lastActiveAt"
  >,
>(candidates: ReadonlyArray<T>) {
  const groups = new Map<string, OnboardingProjectGroup<T> & { candidates: Array<T> }>();
  const other: Array<T> = [];

  for (const candidate of candidates) {
    if (candidate.git === null) {
      other.push(candidate);
      continue;
    }
    const git = candidate.git ?? { remoteKey: null, repository: null };
    const key = git.remoteKey === null ? `path:${candidate.path}` : `remote:${git.remoteKey}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        key,
        label: git.repository ?? candidate.title,
        repository: git.repository,
        candidates: [candidate],
        threadCount: candidate.threadCount,
        lastActiveAt: candidate.lastActiveAt,
      });
      continue;
    }
    existing.candidates.push(candidate);
    groups.set(key, {
      ...existing,
      threadCount: existing.threadCount + candidate.threadCount,
      lastActiveAt: latestActivity(existing.lastActiveAt, candidate.lastActiveAt),
    });
  }

  const repositories = [...groups.values()].sort((left, right) => {
    if (left.lastActiveAt === right.lastActiveAt) return left.label.localeCompare(right.label);
    if (left.lastActiveAt === null) return 1;
    if (right.lastActiveAt === null) return -1;
    return right.lastActiveAt.localeCompare(left.lastActiveAt);
  });

  return { repositories, other };
}

/** Use the server's project match before the client snapshot, which can lag behind the scan. */
export function resolveOnboardingProjectId(
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
  }>,
  environmentId: EnvironmentId,
  candidate: Pick<AgentSessionProjectCandidate, "path" | "projectId">,
): ProjectId | null {
  if (candidate.projectId !== undefined) return candidate.projectId;
  const environmentProjects = projects.filter((project) => project.environmentId === environmentId);
  const currentRootMatch = findProjectByPath(environmentProjects, candidate.path);
  if (currentRootMatch !== undefined) return currentRootMatch.id;
  return null;
}

/** Prefer a selected project with imported history, then a completed empty import. */
export function resolveOnboardingLandingProject<T>(
  selection: ReadonlyArray<string>,
  projectsWithImportedHistory: ReadonlyMap<string, T>,
  completedProjects: ReadonlyMap<string, T>,
): T | undefined {
  for (const path of selection) {
    const project = projectsWithImportedHistory.get(path);
    if (project !== undefined) return project;
  }
  for (const path of selection) {
    const project = completedProjects.get(path);
    if (project !== undefined) return project;
  }
  return undefined;
}

/** Paths identify projects only within the computer that owns them. */
export function onboardingProjectKey(environmentId: EnvironmentId, path: string): string {
  return JSON.stringify([environmentId, path]);
}
