import type {
  OrchestrationV2AppThread,
  OrchestrationV2Command,
  ProjectId,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Effect from "effect/Effect";

import type * as ProjectStore from "./ProjectStore.ts";

/**
 * Linked projects (UpComputer). A thread can link other projects, and a
 * project can link projects for all of its threads. A thread shows under every
 * project it reaches this way, and its agent gets their folders as extra
 * directories. Links to projects deleted since stay stored and are skipped by
 * readers; the next link change drops them.
 */

interface LinkedProjectsOwner {
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface ThreadProjectLinksUpdate {
  readonly linkProjectIds?: ReadonlyArray<ProjectId> | undefined;
  readonly unlinkProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface ThreadProjectLinksChange {
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly projectLinksPinned?: true;
}

export const hasThreadProjectLinksUpdate = (update: ThreadProjectLinksUpdate) =>
  update.linkProjectIds !== undefined || update.unlinkProjectIds !== undefined;

/** A metadata update that only changes links, which does not count as thread activity. */
export const isOnlyThreadProjectLinksUpdate = (
  command: Extract<OrchestrationV2Command, { readonly type: "thread.metadata.update" }>,
) =>
  hasThreadProjectLinksUpdate(command) &&
  command.title === undefined &&
  command.regenerateTitle === undefined &&
  command.branch === undefined &&
  command.worktreePath === undefined &&
  command.limitRecovery === undefined &&
  command.linkedPullRequest === undefined;

/**
 * The thread's next link set: current links to active projects, plus the new
 * targets, minus the removed ones. Linking an unknown or deleted project
 * fails; the thread's own project is skipped. A person's unlink pins the set,
 * so auto-linking never re-adds what they removed.
 */
export function planThreadProjectLinks(input: {
  readonly thread: Pick<
    OrchestrationV2AppThread,
    "projectId" | "linkedProjectIds" | "projectLinksPinned"
  >;
  readonly update: ThreadProjectLinksUpdate;
  readonly activeProjectIds: ReadonlySet<ProjectId>;
}):
  | { readonly _tag: "ok"; readonly change: ThreadProjectLinksChange }
  | { readonly _tag: "error"; readonly detail: string } {
  const targets = [...new Set(input.update.linkProjectIds ?? [])].filter(
    (projectId) => projectId !== input.thread.projectId,
  );
  const unknown = targets.filter((projectId) => !input.activeProjectIds.has(projectId));
  if (unknown.length > 0) {
    return {
      _tag: "error",
      detail: `Projects ${unknown.join(", ")} do not exist or were deleted.`,
    };
  }
  const removed = new Set(input.update.unlinkProjectIds ?? []);
  const current = (input.thread.linkedProjectIds ?? []).filter((projectId) =>
    input.activeProjectIds.has(projectId),
  );
  const linkedProjectIds = [
    ...current,
    ...targets.filter((projectId) => !current.includes(projectId)),
  ].filter((projectId) => !removed.has(projectId));
  return {
    _tag: "ok",
    change: {
      linkedProjectIds,
      ...(input.thread.projectLinksPinned === true || removed.size > 0
        ? { projectLinksPinned: true as const }
        : {}),
    },
  };
}

/** Reads the projects a link update touches and plans it; undefined when it has none. */
export const resolveThreadProjectLinks = Effect.fn("resolveThreadProjectLinks")(function* (input: {
  readonly thread: OrchestrationV2AppThread;
  readonly update: ThreadProjectLinksUpdate;
  readonly projects: ProjectStore.ProjectStoreV2["Service"];
}) {
  if (!hasThreadProjectLinksUpdate(input.update)) return undefined;
  const projectIds = [
    ...new Set([...(input.thread.linkedProjectIds ?? []), ...(input.update.linkProjectIds ?? [])]),
  ];
  const rows = projectIds.length === 0 ? [] : yield* input.projects.list({ projectIds });
  const planned = planThreadProjectLinks({
    thread: input.thread,
    update: input.update,
    activeProjectIds: new Set(rows.map((row) => row.projectId)),
  });
  if (planned._tag === "error") return yield* Effect.fail(planned.detail);
  return planned.change;
});

/**
 * Project ids a thread's agent reaches besides its own project: the thread's
 * links first, then its project's links. Deduped, own project removed.
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

export interface LinkedProjectDirectorySource {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly deletedAt: unknown;
}

/**
 * Workspace roots of the thread's linked projects, handed to the provider as
 * extra directories. Deleted or unknown projects and the session cwd itself
 * are skipped; paths are deduped by their normalized form.
 */
export function resolveLinkedProjectDirectories(input: {
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly projects: ReadonlyArray<LinkedProjectDirectorySource>;
  readonly cwd: string | null;
}): ReadonlyArray<string> {
  const projectsById = new Map(input.projects.map((project) => [project.projectId, project]));
  const seenPaths = new Set<string>();
  if (input.cwd !== null) seenPaths.add(normalizeProjectPathForComparison(input.cwd));
  const directories: string[] = [];
  for (const projectId of input.linkedProjectIds) {
    const project = projectsById.get(projectId);
    if (project === undefined || project.deletedAt !== null) continue;
    const comparisonPath = normalizeProjectPathForComparison(project.workspaceRoot);
    if (seenPaths.has(comparisonPath)) continue;
    seenPaths.add(comparisonPath);
    directories.push(project.workspaceRoot);
  }
  return directories;
}
