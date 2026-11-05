import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2ShellThreadStatus, ProjectId } from "@t3tools/contracts";

export type ThreadProjectMoveSubject = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "worktreePath" | "lineage"
> & {
  readonly source: Pick<
    EnvironmentThreadShell["source"],
    "status" | "activityRunStatus" | "pendingRuntimeRequest"
  >;
};

export interface ThreadProjectMoveTarget {
  readonly id: ProjectId;
  readonly label: string;
  readonly workspaceRoot: string;
  readonly isScratch: boolean;
}

const BUSY_STATUSES: ReadonlySet<OrchestrationV2ShellThreadStatus> = new Set([
  "queued",
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/**
 * Why the server would refuse to move the thread now, or null. Mirrors the orchestrator's
 * `thread.project.move` check: no subagent, no worktree, no queued or live run, no open request.
 */
function threadProjectMoveBlocker(thread: ThreadProjectMoveSubject): string | null {
  if (thread.lineage.relationshipToParent === "subagent") return "Subagents stay with their parent";
  if (thread.worktreePath !== null) return "Threads in a worktree cannot move";
  if (
    BUSY_STATUSES.has(thread.source.status) ||
    (thread.source.activityRunStatus ?? null) !== null ||
    thread.source.pendingRuntimeRequest !== null
  )
    return "Available when the thread is idle";
  return null;
}

/** The other projects on the thread's own computer, by name, with Scratch last as "No project". */
export function threadProjectMoveTargets(
  projects: ReadonlyArray<EnvironmentProject>,
  thread: Pick<ThreadProjectMoveSubject, "environmentId" | "projectId">,
): ReadonlyArray<ThreadProjectMoveTarget> {
  const candidates = projects.filter(
    (project) => project.environmentId === thread.environmentId && project.id !== thread.projectId,
  );
  const named = candidates
    .filter((project) => project.isScratch !== true)
    .map((project) => ({
      id: project.id,
      label: project.title,
      workspaceRoot: project.workspaceRoot,
      isScratch: false,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const scratch = candidates.find((project) => project.isScratch === true);
  return scratch === undefined
    ? named
    : [
        ...named,
        {
          id: scratch.id,
          label: "No project",
          workspaceRoot: scratch.workspaceRoot,
          isScratch: true,
        },
      ];
}

/** The reason the move is unavailable, counting a computer with no other project. */
export function threadProjectMoveUnavailableReason(
  thread: ThreadProjectMoveSubject,
  targets: ReadonlyArray<ThreadProjectMoveTarget>,
): string | null {
  return (
    threadProjectMoveBlocker(thread) ??
    (targets.length === 0 ? "No other project on this computer" : null)
  );
}
