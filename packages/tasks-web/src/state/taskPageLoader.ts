import { EnvironmentRpcUnavailableError, isRpcClientError } from "@t3tools/client-runtime/rpc";
import type { TaskChange, TaskId, TaskPageInput } from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";
import { TaskChangeStreamEnded } from "../rpc/taskChanges.ts";
import type { TasksStateTarget } from "./tasksState.ts";
import { mergeTaskPage, reuseTaskPage, type TaskPageState } from "./taskPages.ts";

export interface TaskPageLoadState {
  readonly page: TaskPageState | undefined;
  readonly initialLoading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | undefined;
  /** The error is the environment being disconnected; its change stream reloads the lane on reconnect. */
  readonly disconnected: boolean;
}

const isEnvironmentRpcUnavailable = Schema.is(EnvironmentRpcUnavailableError);
const isTaskChangeStreamEnded = Schema.is(TaskChangeStreamEnded);

/** The computer went away: an unreachable environment, a dying socket, or an ended change stream. */
export const isDisconnectError = (error: unknown) =>
  isEnvironmentRpcUnavailable(error) || isRpcClientError(error) || isTaskChangeStreamEnded(error);

/** A serialized, event-driven request lane for one environment/query.
 * A Load more click is queued, never dropped because a background read is busy.
 */
export class TaskPageLoader {
  private state: TaskPageLoadState = {
    page: undefined,
    initialLoading: true,
    loadingMore: false,
    error: undefined,
    disconnected: false,
  };
  private disposed = false;
  private busy = false;
  private refreshPending = false;
  private morePending = false;
  private changedIds = new Set<TaskId>();
  /** Tasks whose status, rank or membership changed; they decide whether this lane reloads. */
  private movedIds = new Set<TaskId>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly target: TasksStateTarget;
  private readonly query: TaskPageInput;
  private readonly publish: (state: TaskPageLoadState) => void;
  private readonly batchMs: number;

  constructor(
    target: TasksStateTarget,
    query: TaskPageInput,
    publish: (state: TaskPageLoadState) => void,
    batchMs = 150,
    initialPage?: TaskPageState,
  ) {
    this.target = target;
    this.query = query;
    this.publish = publish;
    this.batchMs = batchMs;
    if (initialPage) this.state = { ...this.state, page: initialPage, initialLoading: false };
  }

  private emit(update: Partial<TaskPageLoadState>) {
    if (this.disposed) return;
    const next = { ...this.state, ...update };
    if (
      next.page === this.state.page &&
      next.initialLoading === this.state.initialLoading &&
      next.loadingMore === this.state.loadingMore &&
      next.error === this.state.error &&
      next.disconnected === this.state.disconnected
    )
      return;
    this.state = next;
    this.publish(this.state);
  }

  change(event: TaskChange) {
    // A run can move a task in or out of a Last run filter's list.
    if (event.kind === "sync" || (event.runsChanged && this.query.lastRun !== undefined))
      this.refreshPending = true;
    // A status lane reloads only for the tasks that are or can be in it; see laneMoved.
    else if (event.listChanged && (this.query.status === undefined || event.taskIds.length === 0))
      this.refreshPending = true;
    else if (event.listChanged) for (const id of event.taskIds) this.movedIds.add(id);
    else for (const id of event.taskIds) this.changedIds.add(id);
    this.schedule(event.kind === "sync" && !this.state.page ? 0 : this.batchMs);
  }

  fail(error: unknown) {
    this.emit({
      initialLoading: false,
      error: error instanceof Error ? error.message : "Task updates are temporarily unavailable.",
      // A request cut off by a dying socket fails as a transport error, not as unavailable.
      disconnected: isDisconnectError(error),
    });
  }

  refresh() {
    this.refreshPending = true;
    this.schedule(0);
  }

  loadMore() {
    if (this.disposed || this.state.loadingMore) return;
    this.morePending = true;
    this.emit({ loadingMore: true });
    this.schedule(0);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.disposed || this.busy || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  /**
   * Whether tasks that moved can change this status lane: one it holds can leave or reorder,
   * and one it does not hold can enter only with the lane's status. A status the page does not
   * list yet reloads too, since the page's `statuses` feed the status filter.
   */
  private async laneMoved(previous: TaskPageState, ids: ReadonlySet<TaskId>): Promise<boolean> {
    const status = this.query.status?.toLowerCase();
    if (status === undefined || previous.tasks.some((task) => ids.has(task.id))) return true;
    const unknown = [...ids];
    for (let offset = 0; offset < unknown.length; offset += 500) {
      const { tasks } = await this.target.client.tasks.items({
        ids: unknown.slice(offset, offset + 500),
        omitText: true,
      });
      if (this.disposed) throw new Error("Disposed task query");
      if (
        tasks.some(
          (task) =>
            task.status.toLowerCase() === status || !previous.statuses.includes(task.status),
        )
      )
        return true;
    }
    return false;
  }

  private async prefix(pages: number): Promise<TaskPageState> {
    let page: TaskPageState | undefined;
    for (let index = 0; index < Math.max(pages, 1); index += 1) {
      const result = await this.target.client.tasks.page({
        ...this.query,
        ...(page?.nextCursor ? { cursor: page.nextCursor } : {}),
      });
      if (this.disposed) throw new Error("Disposed task query");
      page = mergeTaskPage(this.target, result, page);
      if (!page.nextCursor) break;
    }
    return page!;
  }

  private async flush() {
    if (this.disposed || this.busy) return;
    this.busy = true;
    // Pending user work has priority after a running background request finishes.
    // Keyset cursors survive concurrent changes; a queued membership/order event
    // still refreshes the loaded prefix afterwards.
    const more = this.morePending && this.state.page !== undefined;
    const refresh = !more && (this.refreshPending || !this.state.page);
    if (refresh) this.refreshPending = false;
    if (more) this.morePending = false;
    // Appending a page does not refresh existing rows: retain their pending
    // patches until the next lane operation instead of silently losing events.
    const ids = more ? new Set<TaskId>() : this.changedIds;
    if (!more) this.changedIds = new Set();
    const moved = more ? new Set<TaskId>() : this.movedIds;
    if (!more) this.movedIds = new Set();
    try {
      if (!this.target.access.canReadTasks) throw new Error(this.target.access.reason);
      const previous = this.state.page;
      let page = previous;
      if (refresh || (previous && moved.size > 0 && (await this.laneMoved(previous, moved)))) {
        page = await this.prefix(previous?.pages ?? 1);
      } else if (more) {
        if (previous?.nextCursor) {
          const result = await this.target.client.tasks.page({
            ...this.query,
            cursor: previous.nextCursor,
          });
          page = mergeTaskPage(this.target, result, previous);
        }
      } else if (previous && ids.size > 0) {
        const visible = previous.tasks.filter((task) => ids.has(task.id)).map((task) => task.id);
        const replacements = new Map<TaskId, TaskPageState["tasks"][number]>();
        for (let offset = 0; offset < visible.length; offset += 500) {
          const result = await this.target.client.tasks.items({
            ids: visible.slice(offset, offset + 500),
            ...(this.query.omitText === true ? { omitText: true } : {}),
          });
          for (const task of result.tasks)
            replacements.set(task.id, {
              ...task,
              environmentId: this.target.environmentId,
              projectName: this.target.projectNameById?.get(task.projectId) ?? null,
            });
        }
        if (visible.some((id) => !replacements.has(id))) this.refreshPending = true;
        page = {
          ...previous,
          tasks: previous.tasks.map((task) => replacements.get(task.id) ?? task),
        };
      }
      if (page) page = reuseTaskPage(previous, page);
      this.emit({
        page,
        initialLoading: false,
        error: undefined,
        disconnected: false,
        ...(more ? { loadingMore: false } : {}),
      });
    } catch (error) {
      // Keep the last good rows and retryable cursor on every background failure.
      this.fail(error);
      if (more) this.emit({ loadingMore: false });
      if (refresh && !this.state.page) {
        this.morePending = false;
        this.emit({ loadingMore: false });
      }
    } finally {
      this.busy = false;
      if (
        this.refreshPending ||
        this.morePending ||
        this.changedIds.size > 0 ||
        this.movedIds.size > 0
      )
        this.schedule(this.morePending ? 0 : this.batchMs);
    }
  }
}
