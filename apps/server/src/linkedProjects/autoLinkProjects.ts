import type { OrchestrationV2TurnItem, ProjectId } from "@t3tools/contracts";
import { isWindowsAbsolutePath, normalizeProjectPathForComparison } from "@t3tools/shared/path";

/**
 * Auto-linking threads to the projects their agent writes into.
 *
 * When a completed file-change item wrote inside another registered project's
 * folder, the thread links that project. Only writes count (v2 adapters file
 * reads under other item types), and writes inside the thread's own tree never
 * do.
 *
 * Links are picked once: only Scratch ("No project") threads auto-link, and
 * only during the first run that writes into other projects. After that the
 * set belongs to the user, so icons do not shift while the agent works; once
 * the user removed a link (even the last one) the thread is never auto-linked.
 */

function isPathWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeProjectPathForComparison(candidate);
  const normalizedRoot = normalizeProjectPathForComparison(root);
  if (normalizedCandidate.length === 0 || normalizedRoot.length === 0) return false;
  if (normalizedCandidate === normalizedRoot) return true;
  const separator = isWindowsAbsolutePath(normalizedRoot) ? "\\" : "/";
  const prefix = normalizedRoot.endsWith(separator)
    ? normalizedRoot
    : `${normalizedRoot}${separator}`;
  return normalizedCandidate.startsWith(prefix);
}

/**
 * Paths a completed file-change item wrote, as the provider reported them
 * (absolute or relative to the session cwd): every structured change, or the
 * item's file name when it carries none.
 */
export function writtenPathsOfTurnItem(item: OrchestrationV2TurnItem): ReadonlyArray<string> {
  if (item.type !== "file_change" || item.status !== "completed") return [];
  const paths = (item.changes ?? []).map((change) => change.path);
  return [...new Set(paths.length > 0 ? paths : [item.fileName])];
}

export interface AutoLinkProject {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface AutoLinkThread {
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
  readonly projectLinksPinned?: boolean | undefined;
}

/** The subset of `effect/Path` used to resolve written paths. */
export interface AutoLinkPathApi {
  readonly isAbsolute: (path: string) => boolean;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
}

interface AutoLinkContext {
  readonly cwd: string | undefined;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly ownTreeRoots: ReadonlyArray<string>;
  readonly excludedProjectIds: ReadonlySet<ProjectId>;
  /** Folders of projects the thread already reaches; nested projects add nothing. */
  readonly linkedRoots: ReadonlyArray<string>;
  readonly scratchRootKey: string | undefined;
}

function makeAutoLinkContext(input: {
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
}): AutoLinkContext {
  const ownProject = input.projects.find((project) => project.projectId === input.thread.projectId);
  const cwd = input.thread.worktreePath ?? ownProject?.workspaceRoot;
  // The home project's folder counts as the thread's own tree even when the
  // thread runs in a worktree elsewhere; so do projects nested inside either.
  const ownTreeRoots = [cwd, ownProject?.workspaceRoot].filter(
    (root): root is string => root !== undefined,
  );
  const excludedProjectIds = new Set<ProjectId>([
    input.thread.projectId,
    ...(input.thread.linkedProjectIds ?? []),
    ...(ownProject?.linkedProjectIds ?? []),
  ]);
  const linkedRoots = input.projects
    .filter((project) => project.projectId !== input.thread.projectId)
    .filter((project) => excludedProjectIds.has(project.projectId))
    .map((project) => project.workspaceRoot);
  return {
    cwd,
    projects: input.projects,
    ownTreeRoots,
    excludedProjectIds,
    linkedRoots,
    scratchRootKey:
      input.scratchRoot === undefined
        ? undefined
        : normalizeProjectPathForComparison(input.scratchRoot),
  };
}

function matchWithContext(path: string, context: AutoLinkContext): ProjectId | undefined {
  if (context.ownTreeRoots.some((root) => isPathWithinRoot(path, root))) return undefined;
  // The deepest registered folder owns the file, even when that project is
  // excluded below: a write inside an already-linked nested project must not
  // fall through to the project around it.
  let owner: { readonly project: AutoLinkProject; readonly rootKey: string } | undefined;
  for (const project of context.projects) {
    const rootKey = normalizeProjectPathForComparison(project.workspaceRoot);
    if (
      (owner === undefined || rootKey.length > owner.rootKey.length) &&
      isPathWithinRoot(path, project.workspaceRoot)
    ) {
      owner = { project, rootKey };
    }
  }
  if (
    owner === undefined ||
    context.excludedProjectIds.has(owner.project.projectId) ||
    owner.rootKey === context.scratchRootKey
  ) {
    return undefined;
  }
  // A repo inside an already linked workspace is covered by that link.
  const ownerRoot = owner.project.workspaceRoot;
  if (context.linkedRoots.some((root) => isPathWithinRoot(ownerRoot, root))) return undefined;
  return owner.project.projectId;
}

/**
 * Whether a write may still auto-link the thread: its own project is the
 * Scratch ("No project") project, the user has not pinned its links by
 * removing one, and it either has no links yet or is still in the run that
 * made its first auto-links (`autoLinkRunId`).
 */
export function isAutoLinkOpen(input: {
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
  readonly runId: string | null;
  readonly autoLinkRunId: string | undefined;
}): boolean {
  if (input.scratchRoot === undefined || input.thread.projectLinksPinned === true) return false;
  const ownProject = input.projects.find((project) => project.projectId === input.thread.projectId);
  if (
    ownProject === undefined ||
    normalizeProjectPathForComparison(ownProject.workspaceRoot) !==
      normalizeProjectPathForComparison(input.scratchRoot)
  ) {
    return false;
  }
  if ((input.thread.linkedProjectIds ?? []).length === 0) return true;
  return input.runId !== null && input.runId === input.autoLinkRunId;
}

/**
 * Projects to link for a set of written paths: for each, the active project
 * with the longest workspace root containing it, unless that is the thread's
 * own project, one it already reaches, or Scratch, or the path lies inside the
 * thread's own tree. Relative paths resolve against the thread's cwd (its
 * worktree, else its project's root) and are dropped without one.
 */
export function resolveAutoLinkProjectIds(input: {
  readonly writtenPaths: ReadonlyArray<string>;
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
  readonly path: AutoLinkPathApi;
}): ReadonlyArray<ProjectId> {
  const context = makeAutoLinkContext(input);
  const projectIds: ProjectId[] = [];
  for (const writtenPath of input.writtenPaths) {
    const absolutePath = input.path.isAbsolute(writtenPath)
      ? input.path.resolve(writtenPath)
      : context.cwd !== undefined
        ? input.path.resolve(context.cwd, writtenPath)
        : undefined;
    if (absolutePath === undefined) continue;
    const projectId = matchWithContext(absolutePath, context);
    if (projectId !== undefined && !projectIds.includes(projectId)) projectIds.push(projectId);
  }
  return projectIds;
}
