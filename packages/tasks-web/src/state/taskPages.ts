import type { TaskPageCursor, TaskPageResult } from "@t3tools/tasks-contracts/v1";
import { RecentMap, reuseRows } from "./recent.ts";
import type { TasksStateTarget, ScopedTask } from "./tasksState.ts";

export type ScopedTaskListItem = ScopedTask & {
  readonly runCounts: TaskPageResult["tasks"][number]["runCounts"];
};
export interface TaskPageState {
  readonly tasks: readonly ScopedTaskListItem[];
  readonly statuses: readonly string[];
  readonly nextCursor: TaskPageCursor | null;
  readonly pages: number;
  readonly error?: string;
}

export function mergeTaskPage(
  target: TasksStateTarget,
  result: TaskPageResult,
  previous?: TaskPageState,
): TaskPageState {
  const items = result.tasks.map((task) => ({
    ...task,
    environmentId: target.environmentId,
    projectName: target.projectNameById?.get(task.projectId) ?? null,
  }));
  const byId = new Map(previous?.tasks.map((task) => [task.id, task]));
  for (const task of items) byId.set(task.id, task);
  return {
    tasks: [...byId.values()],
    statuses: result.statuses,
    nextCursor: result.nextCursor,
    pages: (previous?.pages ?? 0) + 1,
  };
}

/** Rejects stale responses after a filter change, refresh, or unmount. */
export class TaskPageRequests {
  private generation = 0;
  invalidate(): void {
    this.generation += 1;
  }
  begin(): () => boolean {
    const generation = ++this.generation;
    return () => generation === this.generation;
  }
}

/** Preserve row references, not just keys, when a snapshot contains no change. */
export function reuseTaskPage(
  previous: TaskPageState | undefined,
  next: TaskPageState,
): TaskPageState {
  if (!previous) return next;
  const tasks = reuseRows(previous.tasks, next.tasks, (task) => task.id);
  const sameStatuses =
    next.statuses.length === previous.statuses.length &&
    next.statuses.every((status, index) => status === previous.statuses[index]);
  if (
    tasks === previous.tasks &&
    sameStatuses &&
    next.pages === previous.pages &&
    JSON.stringify(next.nextCursor) === JSON.stringify(previous.nextCursor) &&
    next.error === previous.error
  )
    return previous;
  return { ...next, tasks, statuses: sameStatuses ? previous.statuses : next.statuses };
}

/**
 * The last page of recent query lanes, by lane key (environment, project and
 * search), for every mount of the Tasks table. Only lanes of an environment
 * whose tasks are readable read it.
 */
export const recentTaskPages = new RecentMap<string, TaskPageState>(24);

/** Provider health/config updates must not tear down task query lanes. */
export function sameTaskTargets(
  left: readonly TasksStateTarget[],
  right: readonly TasksStateTarget[],
): boolean {
  return (
    left.length === right.length &&
    left.every((target, index) => {
      const next = right[index]!;
      if (
        target.environmentId !== next.environmentId ||
        target.client !== next.client ||
        target.access.canReadTasks !== next.access.canReadTasks ||
        target.access.reason !== next.access.reason
      )
        return false;
      const names = target.projectNameById;
      const nextNames = next.projectNameById;
      return (
        (names?.size ?? 0) === (nextNames?.size ?? 0) &&
        [...(names ?? [])].every(([id, name]) => nextNames?.get(id) === name)
      );
    })
  );
}
