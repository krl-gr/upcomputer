import type { TaskChange, TaskId, TaskPageInput } from "@upcomputer/tasks-contracts/v1";
import type { TasksStateTarget } from "./tasksState.ts";
import { mergeTaskPage, reuseTaskPage, type TaskPageState } from "./taskPages.ts";

export interface TaskPageLoadState {
  readonly page: TaskPageState | undefined;
  readonly initialLoading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | undefined;
}

/** A serialized, event-driven request lane for one environment/query.
 * A Load more click is queued, never dropped because a background read is busy.
 */
export class TaskPageLoader {
  private state: TaskPageLoadState = {
    page: undefined,
    initialLoading: true,
    loadingMore: false,
    error: undefined,
  };
  private disposed = false;
  private busy = false;
  private refreshPending = false;
  private morePending = false;
  private changedIds = new Set<TaskId>();
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
      next.error === this.state.error
    )
      return;
    this.state = next;
    this.publish(this.state);
  }

  change(event: TaskChange) {
    if (event.kind === "sync" || event.listChanged) this.refreshPending = true;
    else for (const id of event.taskIds) this.changedIds.add(id);
    this.schedule(event.kind === "sync" && !this.state.page ? 0 : this.batchMs);
  }

  fail(error: unknown) {
    this.emit({
      initialLoading: false,
      error: error instanceof Error ? error.message : "Task updates are temporarily unavailable.",
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
    try {
      if (!this.target.access.canReadTasks) throw new Error(this.target.access.reason);
      const previous = this.state.page;
      let page = previous;
      if (refresh) {
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
      if (this.refreshPending || this.morePending || this.changedIds.size > 0)
        this.schedule(this.morePending ? 0 : this.batchMs);
    }
  }
}
