import { EnvironmentRpcUnavailableError, isRpcClientError } from "@t3tools/client-runtime/rpc";
import type {
  TaskChange,
  TaskStatusCount,
  TaskStatusCountsInput,
} from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";

import { RecentMap } from "./recent.ts";
import type { TasksStateTarget } from "./tasksState.ts";

export interface TaskStatusCountsState {
  readonly counts: readonly TaskStatusCount[] | undefined;
  readonly initialLoading: boolean;
  readonly error: string | undefined;
  readonly disconnected: boolean;
}

const isEnvironmentRpcUnavailable = Schema.is(EnvironmentRpcUnavailableError);

/** The last counts of recent count lanes, by lane key, so a remounted list shows its groups at once. */
export const recentStatusCounts = new RecentMap<string, readonly TaskStatusCount[]>(24);

function sameCounts(left: readonly TaskStatusCount[], right: readonly TaskStatusCount[]) {
  return (
    left.length === right.length &&
    left.every(
      (count, index) =>
        count.status === right[index]!.status && count.count === right[index]!.count,
    )
  );
}

/**
 * The tasks per status of one environment's list filters, read again after
 * every change to the list's membership. One request at a time; changes that
 * arrive meanwhile are read once it ends.
 */
export class TaskStatusCountsLoader {
  private state: TaskStatusCountsState;
  private disposed = false;
  private busy = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly target: TasksStateTarget;
  private readonly query: TaskStatusCountsInput;
  private readonly publish: (state: TaskStatusCountsState) => void;
  private readonly batchMs: number;

  constructor(
    target: TasksStateTarget,
    query: TaskStatusCountsInput,
    publish: (state: TaskStatusCountsState) => void,
    batchMs = 150,
    initialCounts?: readonly TaskStatusCount[],
  ) {
    this.target = target;
    this.query = query;
    this.publish = publish;
    this.batchMs = batchMs;
    this.state = {
      counts: initialCounts,
      initialLoading: initialCounts === undefined,
      error: undefined,
      disconnected: false,
    };
  }

  change(event: TaskChange) {
    if (
      event.kind === "sync" ||
      event.listChanged ||
      (event.runsChanged && this.query.lastRun !== undefined)
    ) {
      this.pending = true;
      this.schedule(event.kind === "sync" && !this.state.counts ? 0 : this.batchMs);
    }
  }

  fail(error: unknown) {
    this.emit({
      initialLoading: false,
      error: error instanceof Error ? error.message : "Task counts are temporarily unavailable.",
      disconnected: isEnvironmentRpcUnavailable(error) || isRpcClientError(error),
    });
  }

  refresh() {
    this.pending = true;
    this.schedule(0);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private emit(update: Partial<TaskStatusCountsState>) {
    if (this.disposed) return;
    const next = { ...this.state, ...update };
    if (
      next.counts === this.state.counts &&
      next.initialLoading === this.state.initialLoading &&
      next.error === this.state.error &&
      next.disconnected === this.state.disconnected
    )
      return;
    this.state = next;
    this.publish(next);
  }

  private schedule(delay: number) {
    if (this.disposed || this.busy || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (this.disposed || this.busy || !this.pending) return;
    this.busy = true;
    this.pending = false;
    try {
      if (!this.target.access.canReadTasks) throw new Error(this.target.access.reason);
      const { counts } = await this.target.client.tasks.statusCounts(this.query);
      const previous = this.state.counts;
      this.emit({
        counts: previous && sameCounts(previous, counts) ? previous : counts,
        initialLoading: false,
        error: undefined,
        disconnected: false,
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      if (this.pending) this.schedule(this.batchMs);
    }
  }
}
