import { isWindowsAbsolutePath, normalizeProjectPathForComparison } from "@t3tools/shared/path";

/*
 * The leading project icons of a sidebar thread row, as V1's
 * `resolveThreadProjectIconStack` decided them. A thread shows under its own
 * project, the projects it links (`linkedProjectIds` on the thread shell) and
 * the projects its own project links. The scratch project ("No project") is
 * never drawn: a chat without a project shows its links, or V1's muted chat
 * icon while it has none. Links are environment-local; unknown ids are dropped.
 */

interface IconStackProject {
  readonly id: string;
  readonly environmentId: string;
  readonly workspaceRoot: string;
  readonly linkedProjectIds?: ReadonlyArray<string> | undefined;
}

export interface ThreadProjectIconStack<Project> {
  /** Up to `THREAD_PROJECT_ICON_STACK_LIMIT` projects to draw, own project first. */
  readonly visibleProjects: ReadonlyArray<Project>;
  /** Every project the thread shows under, for the tooltip. */
  readonly allProjects: ReadonlyArray<Project>;
  /** A chat without a project and without links: draw the muted chat icon. */
  readonly showScratchIcon: boolean;
}

export const THREAD_PROJECT_ICON_STACK_LIMIT = 3;

function isPathWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeProjectPathForComparison(candidate);
  const normalizedRoot = normalizeProjectPathForComparison(root);
  if (normalizedCandidate.length === 0 || normalizedRoot.length === 0) return false;
  const separator = isWindowsAbsolutePath(normalizedRoot) ? "\\" : "/";
  const prefix = normalizedRoot.endsWith(separator) ? normalizedRoot : normalizedRoot + separator;
  return normalizedCandidate.startsWith(prefix);
}

/** Drops a project whose folder sits inside another listed project's folder. */
function collapseNestedProjects<Project extends IconStackProject>(
  projects: ReadonlyArray<Project>,
): Project[] {
  return projects.filter(
    (project) =>
      !projects.some(
        (other) =>
          other !== project &&
          other.workspaceRoot !== project.workspaceRoot &&
          isPathWithinRoot(project.workspaceRoot, other.workspaceRoot),
      ),
  );
}

export function resolveThreadProjectIconStack<Project extends IconStackProject>(input: {
  readonly thread: {
    readonly environmentId: string;
    readonly linkedProjectIds?: ReadonlyArray<string> | undefined;
  };
  /** The thread's own project record, if loaded. */
  readonly ownProject: Project | null;
  /** The environment's project by id. */
  readonly projectById: (projectId: string) => Project | undefined;
  readonly isScratchProject: (project: Project) => boolean;
}): ThreadProjectIconStack<Project> {
  const { thread, ownProject } = input;
  const candidates: Project[] = ownProject ? [ownProject] : [];
  for (const projectId of [
    ...(thread.linkedProjectIds ?? []),
    ...(ownProject?.linkedProjectIds ?? []),
  ]) {
    const project = input.projectById(projectId);
    if (project && project.environmentId === thread.environmentId) candidates.push(project);
  }
  const allProjects = collapseNestedProjects(
    [...new Set(candidates)].filter((project) => !input.isScratchProject(project)),
  );
  return {
    visibleProjects: allProjects.slice(0, THREAD_PROJECT_ICON_STACK_LIMIT),
    allProjects,
    showScratchIcon:
      allProjects.length === 0 && ownProject !== null && input.isScratchProject(ownProject),
  };
}
