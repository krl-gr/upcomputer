/**
 * One environment's planner data: person task lists, the schedule entries of
 * the dates on screen, schedule progress of list rows, and the schedules of
 * open detail windows. Live through the environment's task change stream
 * (batched like `TaskPageLoader`), never polled; optimistic through the
 * pending ops of `pendingOps.ts`.
 *
 * Stale reads: every fetch notes the local write sequence when it starts, and
 * a row merged from a write after that point wins over the fetched one.
 * Deleted ids stay deleted for the session (ids are never reused), so an
 * in-flight read cannot bring them back.
 */
import {
  AGENT_RESTORED_STATUS,
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  TASK_SCHEDULE_MAX_IDS,
  type Task,
  type TaskChange,
  type TaskId,
  type TaskPageInput,
  type TaskScheduleAddInput,
  type TaskScheduleCopyInput,
  type TaskScheduleEntry,
  type TaskScheduleEntryId,
  type TaskScheduleMoveInput,
  type TaskScheduleUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import type { ProjectId } from "@t3tools/contracts";

import type { TasksWebRpcClient } from "../../rpc/index.ts";
import { TaskPageLoader, type TaskPageLoadState } from "../../state/taskPageLoader.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import type { ScheduleProgressCount } from "../logic/progress.ts";
import type { PlannerAudience, PlannerKind } from "./preferences.ts";
import {
  addEntries,
  moveEntries,
  patchEntry,
  patchTask,
  removeEntries,
  reorderTasks,
  type EntryPatch,
  type PendingOp,
  type PlannerTask,
  type PlannerView,
  type ReorderAnchor,
  type TaskPatch,
} from "./pendingOps.ts";

export type PlannerListKey = "active" | "archive";
/** Convex's paginated query states, which wande's list checks. */
export type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

export interface PlannerListState {
  readonly ids: readonly string[];
  readonly status: PaginationStatus;
  readonly error: string | null;
}

export interface PlannerSnapshot {
  readonly view: PlannerView;
  readonly active: PlannerListState;
  readonly archive: PlannerListState;
  readonly progress: ReadonlyMap<string, ScheduleProgressCount>;
  /** Entries of tasks whose schedule a detail window shows. */
  readonly schedules: ReadonlyMap<string, readonly TaskScheduleEntry[]>;
  readonly rangeError: string | null;
  /** Tasks a window asked for that the server does not have (deleted elsewhere). */
  readonly missingTaskIds: ReadonlySet<string>;
}

export interface PlannerQuery {
  /** Projects the lists show; null for all. */
  readonly projectIds: readonly ProjectId[] | null;
  readonly archiveVisible: boolean;
  /** Whose tasks the lists show; routines are always the person's. */
  readonly audience: PlannerAudience;
  /** Tasks or routines. */
  readonly kind: PlannerKind;
}

/** Dates progress counts are limited to: the current week for routines. */
export interface ProgressWindow {
  readonly from: string;
  readonly to: string;
}

export interface PlannerStoreOptions {
  readonly batchMs?: number;
  readonly onError?: (title: string, error: unknown) => void;
  readonly now?: () => string;
}

/** Page sizes follow wande: 40 active, 30 done or archived. */
const ACTIVE_PAGE_SIZE = 40;
const ARCHIVE_PAGE_SIZE = 30;

interface Lane {
  readonly key: string;
  readonly list: PlannerListKey;
  readonly loader: TaskPageLoader;
  state: TaskPageLoadState;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The request failed.";
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    result.push(items.slice(offset, offset + size));
  return result;
}

function laneQueries(query: PlannerQuery): Array<{ list: PlannerListKey; search: TaskPageInput }> {
  const projects: ReadonlyArray<ProjectId | undefined> = query.projectIds ?? [undefined];
  const base =
    query.kind === "routine"
      ? ({ audience: "person", kind: "routine" } as const)
      : ({ audience: query.audience, kind: "task" } as const);
  return projects.flatMap((projectId) => {
    const scope = projectId === undefined ? {} : { projectId };
    return [
      {
        list: "active" as const,
        search: {
          ...base,
          ...scope,
          excludeStatuses: [PERSON_DONE_STATUS],
          limit: ACTIVE_PAGE_SIZE,
        },
      },
      ...(query.archiveVisible
        ? [
            {
              list: "archive" as const,
              search: { ...base, ...scope, status: PERSON_DONE_STATUS, limit: ARCHIVE_PAGE_SIZE },
            },
            {
              list: "archive" as const,
              search: { ...base, ...scope, archive: "archived", limit: ARCHIVE_PAGE_SIZE } as const,
            },
          ]
        : []),
    ];
  });
}

export function belongsToList(
  task: PlannerTask,
  list: PlannerListKey,
  query: Pick<PlannerQuery, "projectIds" | "audience" | "kind">,
): boolean {
  if (task.kind !== query.kind) return false;
  if (query.kind === "task" && query.audience !== "all" && task.audience !== query.audience)
    return false;
  if (query.projectIds !== null && !query.projectIds.includes(task.projectId)) return false;
  const finished = task.archivedAt !== null || task.status === PERSON_DONE_STATUS;
  return list === "archive" ? finished : !finished;
}

const compareTasks = (left: PlannerTask, right: PlannerTask) =>
  left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id);
const compareEntries = (left: TaskScheduleEntry, right: TaskScheduleEntry) =>
  left.position.localeCompare(right.position) || left.id.localeCompare(right.id);

function listStatus(lanes: readonly Lane[]): PaginationStatus {
  if (lanes.length === 0) return "Exhausted";
  if (lanes.some((lane) => lane.state.initialLoading && !lane.state.page))
    return "LoadingFirstPage";
  if (lanes.some((lane) => lane.state.loadingMore)) return "LoadingMore";
  if (lanes.some((lane) => lane.state.page?.nextCursor)) return "CanLoadMore";
  return "Exhausted";
}

export class PlannerStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: PlannerSnapshot | null = null;

  private readonly tasks = new Map<string, PlannerTask>();
  private readonly taskSeq = new Map<string, number>();
  private readonly entries = new Map<string, TaskScheduleEntry>();
  private readonly entrySeq = new Map<string, number>();
  private readonly deletedTasks = new Set<string>();
  private readonly deletedEntries = new Set<string>();
  private readonly missingTasks = new Set<string>();
  private seq = 0;
  private ops: PendingOp[] = [];
  private nextOpId = 1;
  private nextTempId = 1;

  private query: PlannerQuery = {
    projectIds: null,
    archiveVisible: false,
    audience: "person",
    kind: "task",
  };
  private lanes: Lane[] = [];
  private readonly lanePages = new Map<string, NonNullable<TaskPageLoadState["page"]>>();
  /** Tasks created here, shown before their list's next page includes them. */
  private readonly created = new Set<string>();

  private range: { readonly from: string; readonly to: string } | null = null;
  private rangeError: string | null = null;
  private readonly progress = new Map<string, ScheduleProgressCount>();
  private progressIds = new Set<string>();
  private progressWindow: ProgressWindow | null = null;
  private readonly schedules = new Map<string, readonly TaskScheduleEntry[]>();
  private readonly scheduleWatchers = new Map<string, number>();

  private retained = 0;
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private stale = {
    range: false,
    progress: new Set<string>(),
    schedules: new Set<string>(),
    tasks: new Set<string>(),
  };

  private readonly target: TasksStateTarget;
  private readonly client: TasksWebRpcClient;
  private readonly batchMs: number;
  private readonly onError: (title: string, error: unknown) => void;
  private readonly now: () => string;

  constructor(target: TasksStateTarget, options: PlannerStoreOptions = {}) {
    this.client = target.client;
    this.batchMs = options.batchMs ?? 150;
    this.onError = options.onError ?? (() => undefined);
    this.now = options.now ?? (() => new Date().toISOString());
    // List pages go through the store first, so their rows meet the stale-read guard.
    const tasks = target.client.tasks;
    this.target = {
      ...target,
      client: {
        ...target.client,
        tasks: {
          ...tasks,
          page: async (input) => {
            const start = this.seq;
            const result = await tasks.page(input);
            this.mergeFetchedTasks(result.tasks, start);
            return result;
          },
          items: async (input) => {
            const start = this.seq;
            const result = await tasks.items(input);
            this.mergeFetchedTasks(result.tasks, start);
            return result;
          },
        },
      },
    };
  }

  // ---- subscription -------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlannerSnapshot => {
    this.snapshot ??= this.derive();
    return this.snapshot;
  };

  private emit() {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  /** Keeps the store live while the planner is on screen; data stays cached after release. */
  retain(): () => void {
    this.retained += 1;
    if (this.retained === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retained -= 1;
      if (this.retained === 0) this.stop();
    };
  }

  private start() {
    this.buildLanes();
    this.unsubscribe = this.client.tasks.subscribe(
      (change) => this.change(change),
      (error) => {
        for (const lane of this.lanes) lane.loader.fail(error);
        this.rangeError = errorMessage(error);
        this.emit();
      },
    );
  }

  private stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const lane of this.lanes) lane.loader.dispose();
    this.lanes = [];
  }

  // ---- queries --------------------------------------------------------------

  setQuery(query: PlannerQuery) {
    const same =
      query.archiveVisible === this.query.archiveVisible &&
      query.audience === this.query.audience &&
      query.kind === this.query.kind &&
      JSON.stringify(query.projectIds) === JSON.stringify(this.query.projectIds);
    if (same) return;
    this.query = query;
    if (this.retained > 0) {
      for (const lane of this.lanes) lane.loader.dispose();
      this.buildLanes();
      for (const lane of this.lanes) lane.loader.refresh();
    }
    this.emit();
  }

  private buildLanes() {
    this.lanes = laneQueries(this.query).map(({ list, search }) => {
      const key = JSON.stringify([list, search]);
      const cached = this.lanePages.get(key);
      const lane: Lane = {
        key,
        list,
        state: { page: cached, initialLoading: !cached, loadingMore: false, error: undefined },
        loader: new TaskPageLoader(
          this.target,
          search,
          (state) => {
            lane.state = state;
            if (state.page) {
              this.lanePages.set(key, state.page);
              for (const task of state.page.tasks) this.created.delete(task.id);
            }
            this.emit();
          },
          this.batchMs,
          cached,
        ),
      };
      return lane;
    });
  }

  loadMore(list: PlannerListKey) {
    for (const lane of this.lanes) if (lane.list === list) lane.loader.loadMore();
  }

  /** The dates on screen (wande loads one day more on each side). */
  setRange(from: string, to: string) {
    if (this.range?.from === from && this.range.to === to) return;
    this.range = { from, to };
    this.stale.range = true;
    this.schedule(0);
  }

  /**
   * The list rows whose progress chip is visible; others are not fetched.
   * With a window, only entries on those dates count (a routine's week).
   */
  trackProgress(ids: readonly string[], window: ProgressWindow | null = null) {
    const next = new Set(ids);
    const windowChanged =
      window?.from !== this.progressWindow?.from || window?.to !== this.progressWindow?.to;
    if (windowChanged) this.progressWindow = window;
    for (const id of next)
      if (windowChanged || !this.progressIds.has(id)) this.stale.progress.add(id);
    this.progressIds = next;
    if (this.stale.progress.size > 0) this.schedule(0);
  }

  /** Loads and follows a task's entries while a detail window shows them. */
  watchSchedule(taskId: string): () => void {
    const count = this.scheduleWatchers.get(taskId) ?? 0;
    this.scheduleWatchers.set(taskId, count + 1);
    if (count === 0) {
      this.stale.schedules.add(taskId);
      this.schedule(0);
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const left = (this.scheduleWatchers.get(taskId) ?? 1) - 1;
      if (left > 0) this.scheduleWatchers.set(taskId, left);
      else {
        this.scheduleWatchers.delete(taskId);
        this.schedules.delete(taskId);
      }
    };
  }

  /** Loads a task that no list or loaded day holds, for a detail window. */
  ensureTask(taskId: string) {
    if (this.tasks.has(taskId) || this.deletedTasks.has(taskId) || this.missingTasks.has(taskId))
      return;
    this.stale.tasks.add(taskId);
    this.schedule(0);
  }

  // ---- change events ----------------------------------------------------

  private change(change: TaskChange) {
    const scheduleOnly = (change.scheduleDates?.length ?? 0) > 0 && !change.listChanged;
    // Schedule-only writes name the tasks whose progress changed, not changed rows.
    const forLists = scheduleOnly ? { ...change, taskIds: [] } : change;
    for (const lane of this.lanes) lane.loader.change(forLists);
    if (change.kind === "sync") {
      this.stale.range = this.range !== null;
      for (const id of this.progressIds) this.stale.progress.add(id);
      for (const id of this.scheduleWatchers.keys()) this.stale.schedules.add(id);
      for (const id of this.tasks.keys()) if (!this.inLane(id)) this.stale.tasks.add(id);
    } else {
      const range = this.range;
      if (range && change.scheduleDates?.some((date) => date >= range.from && date <= range.to))
        this.stale.range = true;
      for (const id of change.taskIds) {
        if (this.progressIds.has(id)) this.stale.progress.add(id);
        if (this.scheduleWatchers.has(id)) this.stale.schedules.add(id);
        if (!scheduleOnly && this.tasks.has(id) && !this.inLane(id)) this.stale.tasks.add(id);
      }
    }
    this.schedule(this.batchMs);
  }

  private inLane(id: string) {
    return this.lanes.some((lane) => lane.state.page?.tasks.some((task) => task.id === id));
  }

  private schedule(delay: number) {
    if (this.flushing) return;
    if (this.timer !== undefined) {
      if (delay > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private hasStale() {
    const stale = this.stale;
    return (
      stale.range || stale.progress.size > 0 || stale.schedules.size > 0 || stale.tasks.size > 0
    );
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    const stale = this.stale;
    this.stale = {
      range: false,
      progress: new Set(),
      schedules: new Set(),
      tasks: new Set(),
    };
    try {
      await Promise.all([
        stale.range ? this.loadRange() : undefined,
        this.loadProgress([...stale.progress].filter((id) => this.progressIds.has(id))),
        ...[...stale.schedules]
          .filter((id) => this.scheduleWatchers.has(id))
          .map((id) => this.loadSchedule(id)),
        this.loadTasks([...stale.tasks]),
      ]);
    } finally {
      this.flushing = false;
      this.emit();
      if (this.hasStale()) this.schedule(this.batchMs);
    }
  }

  private async loadRange() {
    const range = this.range;
    if (!range) return;
    const start = this.seq;
    try {
      const result = await this.client.tasks.scheduleRange(range);
      this.mergeFetchedTasks(result.tasks, start);
      for (const entry of result.entries) this.mergeFetchedEntry(entry, start);
      const fetched = new Set<string>(result.entries.map((entry) => entry.id));
      for (const [id, entry] of this.entries) {
        if (entry.date < range.from || entry.date > range.to || fetched.has(id)) continue;
        if ((this.entrySeq.get(id) ?? 0) <= start) {
          this.entries.delete(id);
          this.entrySeq.delete(id);
        }
      }
      this.rangeError = null;
    } catch (error) {
      this.rangeError = errorMessage(error);
    }
  }

  private async loadProgress(ids: readonly string[]) {
    for (const part of chunks(ids, TASK_SCHEDULE_MAX_IDS)) {
      try {
        const window = this.progressWindow;
        const result = await this.client.tasks.scheduleProgress({
          taskIds: part as TaskId[],
          ...(window ? { from: window.from, to: window.to } : {}),
        });
        if (window !== this.progressWindow) continue;
        for (const id of part) this.progress.delete(id);
        for (const item of result.progress)
          this.progress.set(item.taskId, { total: item.total, handled: item.handled });
      } catch {
        // A missing chip is not worth a toast; the next change asks again.
      }
    }
  }

  private async loadSchedule(taskId: string) {
    try {
      const result = await this.client.tasks.scheduleForTask({
        taskId: taskId as TaskId,
        limit: 500,
      });
      if (this.scheduleWatchers.has(taskId)) this.schedules.set(taskId, result.entries);
    } catch {
      // The table keeps its last rows; the next change asks again.
    }
  }

  private async loadTasks(ids: readonly string[]) {
    for (const part of chunks(ids, 500)) {
      try {
        const { tasks } = await this.target.client.tasks.items({ ids: part as TaskId[] });
        for (const id of part)
          if (!tasks.some((task) => task.id === id)) {
            this.missingTasks.add(id);
            this.tasks.delete(id);
          }
      } catch {
        // Rows keep their last known state until the next change.
      }
    }
  }

  // ---- merging ----------------------------------------------------------

  private mergeFetchedTasks(rows: readonly PlannerTask[], start: number) {
    for (const row of rows) {
      if (this.deletedTasks.has(row.id)) continue;
      if ((this.taskSeq.get(row.id) ?? 0) > start) continue;
      this.missingTasks.delete(row.id);
      this.tasks.set(row.id, row);
      this.taskSeq.set(row.id, start);
    }
  }

  private mergeFetchedEntry(entry: TaskScheduleEntry, start: number) {
    if (this.deletedEntries.has(entry.id)) return;
    if ((this.entrySeq.get(entry.id) ?? 0) > start) return;
    this.entries.set(entry.id, entry);
    this.entrySeq.set(entry.id, start);
  }

  /** A write's returned task; run counts are not part of it and stay as they were. */
  private mergeWrittenTask(task: Task) {
    if (this.deletedTasks.has(task.id)) return;
    const previous = this.tasks.get(task.id);
    this.tasks.set(task.id, {
      ...task,
      runCounts: previous?.runCounts ?? [],
      ...(previous?.latestRunStatus !== undefined
        ? { latestRunStatus: previous.latestRunStatus }
        : {}),
    });
    this.taskSeq.set(task.id, ++this.seq);
  }

  private mergeWrittenEntries(entries: readonly TaskScheduleEntry[]) {
    const seq = ++this.seq;
    for (const entry of entries) {
      if (this.deletedEntries.has(entry.id)) continue;
      this.entries.set(entry.id, entry);
      this.entrySeq.set(entry.id, seq);
      const schedule = this.schedules.get(entry.taskId);
      if (schedule)
        this.schedules.set(entry.taskId, [
          ...schedule.filter((existing) => existing.id !== entry.id),
          entry,
        ]);
    }
  }

  private forgetEntries(ids: Iterable<string>) {
    for (const id of ids) {
      this.deletedEntries.add(id);
      const entry = this.entries.get(id);
      this.entries.delete(id);
      this.entrySeq.delete(id);
      if (!entry) continue;
      const schedule = this.schedules.get(entry.taskId);
      if (schedule)
        this.schedules.set(
          entry.taskId,
          schedule.filter((existing) => existing.id !== id),
        );
    }
    for (const [taskId, schedule] of this.schedules)
      if (schedule.some((entry) => this.deletedEntries.has(entry.id)))
        this.schedules.set(
          taskId,
          schedule.filter((entry) => !this.deletedEntries.has(entry.id)),
        );
  }

  // ---- view -------------------------------------------------------------

  private derive(): PlannerSnapshot {
    const tasks = new Map(this.tasks);
    const lists = new Map<string, readonly string[]>();
    for (const list of ["active", "archive"] as const) {
      const ids = new Set<string>();
      for (const lane of this.lanes)
        if (lane.list === list) for (const task of lane.state.page?.tasks ?? []) ids.add(task.id);
      if (list === "active") for (const id of this.created) ids.add(id);
      lists.set(
        list,
        [...ids]
          .flatMap((id) => {
            const task = tasks.get(id);
            return task && !this.deletedTasks.has(id) ? [task] : [];
          })
          .sort(compareTasks)
          .map((task) => task.id),
      );
    }
    const byDate = new Map<string, TaskScheduleEntry[]>();
    for (const entry of this.entries.values()) {
      const day = byDate.get(entry.date);
      if (day) day.push(entry);
      else byDate.set(entry.date, [entry]);
    }
    const days = new Map<string, readonly TaskScheduleEntry[]>();
    for (const [date, entries] of byDate) days.set(date, entries.sort(compareEntries));
    let view: PlannerView = { tasks, lists, days };
    for (const op of this.ops) view = op.apply(view);
    const listState = (list: PlannerListKey): PlannerListState => {
      const lanes = this.lanes.filter((lane) => lane.list === list);
      return {
        ids: (view.lists.get(list) ?? []).filter((id) => {
          const task = view.tasks.get(id);
          return task !== undefined && belongsToList(task, list, this.query);
        }),
        status: listStatus(lanes),
        error: lanes.find((lane) => lane.state.error)?.state.error ?? null,
      };
    };
    return {
      view,
      active: listState("active"),
      archive: listState("archive"),
      progress: new Map(this.progress),
      schedules: new Map(
        [...this.schedules].map(([taskId, entries]) => [
          taskId,
          [...entries].sort(
            (left, right) =>
              left.date.localeCompare(right.date) ||
              (left.startTime ?? "99:99").localeCompare(right.startTime ?? "99:99") ||
              compareEntries(left, right),
          ),
        ]),
      ),
      rangeError: this.rangeError,
      missingTaskIds: new Set(this.missingTasks),
    };
  }

  // ---- writes -----------------------------------------------------------

  /**
   * Runs one write: shows `apply` until the response is merged, then drops
   * it. On failure the view returns to the server's state and the error is
   * reported. Resolves to whether the write succeeded.
   */
  private async write<T>(
    title: string,
    apply: ((view: PlannerView) => PlannerView) | null,
    run: () => Promise<T>,
    merge: (result: T) => void | Promise<void>,
  ): Promise<boolean> {
    const op = apply ? { id: this.nextOpId++, apply } : null;
    if (op) {
      this.ops = [...this.ops, op];
      this.emit();
    }
    try {
      await merge(await run());
      return true;
    } catch (error) {
      this.onError(title, error);
      return false;
    } finally {
      if (op) this.ops = this.ops.filter((candidate) => candidate.id !== op.id);
      this.emit();
    }
  }

  /** Writes that return no rows (archive) fetch them before the optimistic op goes. */
  private refetchTasks(ids: readonly string[]) {
    return this.target.client.tasks.items({ ids: ids as TaskId[] }).then((result) => {
      for (const task of result.tasks) this.taskSeq.set(task.id, ++this.seq);
    });
  }

  async createTask(input: {
    readonly title: string;
    readonly description: string;
    readonly projectId?: ProjectId;
    readonly beforeTaskId?: string;
    readonly afterTaskId?: string;
    readonly kind?: PlannerKind;
  }): Promise<boolean> {
    return this.write(
      input.kind === "routine" ? "Could not create the routine" : "Could not create the task",
      null,
      () =>
        this.client.tasks.create({
          title: input.title,
          description: input.description,
          status: PERSON_OPEN_STATUS,
          audience: "person",
          ...(input.kind === "routine" ? { kind: "routine" as const } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.beforeTaskId ? { beforeTaskId: input.beforeTaskId as TaskId } : {}),
          ...(input.afterTaskId ? { afterTaskId: input.afterTaskId as TaskId } : {}),
        }),
      (task) => {
        this.mergeWrittenTask(task);
        this.created.add(task.id);
      },
    );
  }

  updateTask(id: string, patch: Omit<TaskPatch, "archivedAt">): Promise<boolean> {
    return this.write(
      "Could not update the task",
      (view) => patchTask(view, id, patch),
      () =>
        this.client.tasks.update({
          id: id as TaskId,
          ...patch,
        }),
      (task) => this.mergeWrittenTask(task),
    );
  }

  /** Wande's Done button: status Done, entries untouched. */
  async markDone(ids: readonly string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.updateTask(id, { status: PERSON_DONE_STATUS })));
  }

  archive(ids: readonly string[]): Promise<boolean> {
    const archivedAt = this.now();
    return this.write(
      ids.length === 1 ? "Could not archive the task" : "Could not archive the tasks",
      (view) => ids.reduce((next, id) => patchTask(next, id, { archivedAt }), view),
      () => this.client.tasks.archive({ ids: ids as TaskId[] }),
      () => this.refetchTasks(ids),
    );
  }

  /**
   * Wande's Restore: back in the active list, unarchived. A Done person task
   * is To Do again. An agent task becomes Restored, which starts no agent, and
   * its status is written before the unarchive: an unarchived task in a start
   * status would start its agents at once. A failed status write unarchives
   * nothing.
   */
  async restore(ids: readonly string[]): Promise<boolean> {
    const view = this.getSnapshot().view;
    const archived: string[] = [];
    const statuses = new Map<string, string>();
    for (const id of ids) {
      const task = view.tasks.get(id);
      if (!task) continue;
      if (task.archivedAt) archived.push(id);
      const status =
        task.audience === "agent"
          ? task.archivedAt || task.status === PERSON_DONE_STATUS
            ? AGENT_RESTORED_STATUS
            : null
          : task.status === PERSON_DONE_STATUS
            ? PERSON_OPEN_STATUS
            : null;
      if (status !== null && status !== task.status) statuses.set(id, status);
    }
    return this.write(
      ids.length === 1 ? "Could not restore the task" : "Could not restore the tasks",
      (current) =>
        ids.reduce((next, id) => {
          const status = statuses.get(id);
          return patchTask(next, id, { archivedAt: null, ...(status ? { status } : {}) });
        }, current),
      async () => {
        const written = await Promise.all(
          [...statuses].map(([id, status]) =>
            this.client.tasks.update({ id: id as TaskId, status }),
          ),
        );
        for (const task of written) this.mergeWrittenTask(task);
        if (archived.length > 0) await this.client.tasks.unarchive({ ids: archived as TaskId[] });
      },
      () => this.refetchTasks(archived),
    );
  }

  async deleteTasks(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.write(
        "Could not delete the task",
        null,
        () => this.client.tasks.delete({ id: id as TaskId }),
        () => {
          this.deletedTasks.add(id);
          this.missingTasks.add(id);
          this.tasks.delete(id);
          this.forgetEntries(
            [...this.entries.values()].filter((entry) => entry.taskId === id).map(({ id }) => id),
          );
        },
      );
    }
  }

  /** Moves tasks as a block next to `anchor`; no anchor is the top. */
  reorder(ids: readonly string[], anchor: ReorderAnchor): Promise<boolean> {
    const neighbors = {
      ...("beforeTaskId" in anchor ? { beforeTaskId: anchor.beforeTaskId as TaskId } : {}),
      ...("afterTaskId" in anchor ? { afterTaskId: anchor.afterTaskId as TaskId } : {}),
    };
    return this.write(
      ids.length === 1 ? "Could not move the task" : "Could not move the tasks",
      (view) => reorderTasks(view, ids, anchor),
      async () =>
        ids.length === 1
          ? [await this.client.tasks.reorder({ id: ids[0] as TaskId, ...neighbors })]
          : (await this.client.tasks.reorderMany({ ids: ids as TaskId[], ...neighbors })).tasks,
      (tasks) => {
        for (const task of tasks) this.mergeWrittenTask(task);
      },
    );
  }

  addEntries(input: TaskScheduleAddInput): Promise<boolean> {
    const timestamp = this.now();
    const temporary = input.taskIds.map((taskId): TaskScheduleEntry => ({
      id: `pending-entry-${this.nextTempId++}` as TaskScheduleEntryId,
      taskId,
      date: input.date,
      position: "0000000000000000" as TaskScheduleEntry["position"],
      startTime: input.startTime ?? null,
      durationMinutes: input.durationMinutes ?? null,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    return this.write(
      "Could not schedule the task",
      (view) => addEntries(view, input.date, temporary, input.placement),
      () => this.client.tasks.scheduleAdd(input),
      (result) => this.mergeWrittenEntries(result.entries),
    );
  }

  moveEntries(input: TaskScheduleMoveInput): Promise<boolean> {
    const timing: EntryPatch = {
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    };
    return this.write(
      input.ids.length === 1 ? "Could not move the entry" : "Could not move the entries",
      (view) => moveEntries(view, input.ids, input.date, input.placement, timing),
      () => this.client.tasks.scheduleMove(input),
      (result) => this.mergeWrittenEntries(result.entries),
    );
  }

  updateEntry(input: TaskScheduleUpdateInput): Promise<boolean> {
    const patch: EntryPatch = {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    };
    return this.write(
      "Could not update the entry",
      (view) => patchEntry(view, input.id, patch),
      () => this.client.tasks.scheduleUpdate(input),
      (result) => this.mergeWrittenEntries(result.entries),
    );
  }

  deleteEntries(ids: readonly string[]): Promise<boolean> {
    return this.write(
      ids.length === 1 ? "Could not delete the entry" : "Could not delete the entries",
      (view) => removeEntries(view, new Set(ids)),
      () => this.client.tasks.scheduleDelete({ ids: ids as TaskScheduleEntryId[] }),
      (result) => this.forgetEntries(result.entries.map((entry) => entry.id)),
    );
  }

  copyEntries(input: TaskScheduleCopyInput): Promise<boolean> {
    return this.write(
      "Could not copy the entries",
      null,
      () => this.client.tasks.scheduleCopy(input),
      (result) => this.mergeWrittenEntries(result.entries),
    );
  }

  /** "Reschedule incomplete": every open entry of a day to the end of another. */
  moveOpen(fromDate: string, toDate: string): Promise<boolean> {
    return this.write(
      "Could not reschedule the day",
      null,
      () => this.client.tasks.scheduleMoveOpen({ fromDate, toDate }),
      (result) => this.mergeWrittenEntries(result.entries),
    );
  }
}
