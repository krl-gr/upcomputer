import type { TaskAgentRun, TaskId } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import { runSearchStatus } from "../taskRunStatus.ts";

export const TASK_RUNS_PAGE_SIZE = 100;

/**
 * A task's worker runs, newest first: `pages` pages after `after`, or from the newest.
 * `status` is a run-count status, as a click on a task's run count picks it; null is all runs.
 * Paging stops early once `isCurrent` says a newer request replaced this one.
 */
export async function fetchTaskRuns(
  client: Pick<TasksWebRpcClient, "agents">,
  input: {
    readonly taskId: TaskId;
    readonly status: string | null;
    readonly after?: Pick<TaskAgentRun, "startedAt" | "id"> | undefined;
    readonly pages: number;
    readonly isCurrent?: () => boolean;
  },
): Promise<{ readonly runs: TaskAgentRun[]; readonly hasMore: boolean }> {
  const runs: TaskAgentRun[] = [];
  let cursor = input.after ? { startedAt: input.after.startedAt, id: input.after.id } : undefined;
  let hasMore = false;
  for (let index = 0; index < input.pages; index += 1) {
    const result = await client.agents.searchRuns({
      taskId: input.taskId,
      limit: TASK_RUNS_PAGE_SIZE,
      ...(input.status === null ? {} : { status: runSearchStatus(input.status) }),
      ...(cursor ? { cursor } : {}),
    });
    if (input.isCurrent && !input.isCurrent()) break;
    runs.push(...result.runs);
    hasMore = result.runs.length === TASK_RUNS_PAGE_SIZE;
    const tail = result.runs[result.runs.length - 1];
    if (!hasMore || !tail) break;
    cursor = { startedAt: tail.startedAt, id: tail.id };
  }
  return { runs, hasMore };
}

/** Loaded runs after a fetch: the next page appended, or a reload replacing them; one per id. */
export function mergeTaskRuns<Run extends { readonly id: string }>(
  previous: readonly Run[],
  fetched: readonly Run[],
  append: boolean,
): Run[] {
  return [
    ...new Map((append ? [...previous, ...fetched] : fetched).map((run) => [run.id, run])).values(),
  ];
}

/**
 * A run a person can stop: still active and not already wrapping up. Finalizing runs end on
 * their own in a moment.
 */
export function canStopRun(run: Pick<TaskAgentRun, "completedAt" | "status">): boolean {
  return run.completedAt === null && !run.status.startsWith("finalizing:");
}
