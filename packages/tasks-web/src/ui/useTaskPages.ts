import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { msg } from "gt-react";
import {
  type ClientNoticeInput,
  useHeldClientNotices,
} from "../../../../apps/web/src/sidebarNotifications/clientNotices.ts";
import { compareScopedTaskOrder, type TasksStateTarget } from "../state/tasksState.ts";
import { TaskPageLoader, type TaskPageLoadState } from "../state/taskPageLoader.ts";
import {
  recentTaskPages,
  type TaskPageState,
  type ScopedTaskListItem,
} from "../state/taskPages.ts";
import {
  recentStatusCounts,
  TaskStatusCountsLoader,
  type TaskStatusCountsState,
} from "../state/taskStatusCounts.ts";
import type {
  TaskArchiveFilter,
  TaskChange,
  TaskStatusCount,
  TaskStatusCountsInput,
} from "@t3tools/tasks-contracts/v1";
import {
  planStatusGroupLanes,
  planTaskQueryLanes,
  type TaskQueryLane,
  type ViewProjectFilter,
} from "./projectFilter.ts";
import { ALL_FILTER } from "./pageFilters.ts";
import { statusGroupKey } from "./taskStatusGroups.ts";
import { resolveTaskPagesStatus, useTasksInitialWaitOver } from "../planner/ui/tasksViewGate.ts";

const PAGE_SIZE = 100;

function recentPage(lane: TaskQueryLane) {
  return lane.target.access.canReadTasks ? recentTaskPages.get(lane.key) : undefined;
}

function recentCounts(lane: TaskQueryLane) {
  return lane.target.access.canReadTasks ? recentStatusCounts.get(lane.key) : undefined;
}

function loadedState(page: TaskPageState): TaskPageLoadState {
  return { page, initialLoading: false, loadingMore: false, error: undefined, disconnected: false };
}

function countsInput(lane: TaskQueryLane): TaskStatusCountsInput {
  const { projectId, tags, archive, audience, kind, lastRun } = lane.search;
  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(tags === undefined ? {} : { tags }),
    ...(archive === undefined ? {} : { archive }),
    ...(audience === undefined ? {} : { audience }),
    ...(kind === undefined ? {} : { kind }),
    ...(lastRun === undefined ? {} : { lastRun }),
  };
}

interface Loader {
  change(event: TaskChange): void;
  fail(error: unknown): void;
  refresh(): void;
  dispose(): void;
}

interface LiveLane<L extends Loader> {
  readonly lane: TaskQueryLane;
  readonly loader: L;
  readonly unsubscribe: () => void;
}

/**
 * Keeps one loader per lane key: a lane that stays keeps its loader and rows,
 * a new one starts, a gone one stops. Every loader listens to its
 * environment's shared change stream, which opens with a sync that loads it.
 */
function syncLoaders<L extends Loader>(
  live: Map<string, LiveLane<L>>,
  lanes: ReadonlyArray<TaskQueryLane>,
  create: (lane: TaskQueryLane) => L,
) {
  const wanted = new Map(lanes.map((lane) => [lane.key, lane]));
  for (const [key, entry] of live) {
    if (wanted.get(key)?.target === entry.lane.target) continue;
    entry.unsubscribe();
    entry.loader.dispose();
    live.delete(key);
  }
  for (const lane of lanes) {
    if (live.has(lane.key)) continue;
    const loader = create(lane);
    const { target } = lane;
    let unsubscribe = () => {};
    if (target.access.canReadTasks)
      unsubscribe = target.client.tasks.subscribe(
        (change) => loader.change(change),
        (error) => loader.fail(error),
      );
    // An access probe still running is not an answer: the lane keeps loading.
    else if (target.access.availability !== "loading") loader.fail(new Error(target.access.reason));
    live.set(lane.key, { lane, loader, unsubscribe });
  }
}

function disposeAll(live: Map<string, LiveLane<Loader>>) {
  for (const entry of live.values()) {
    entry.unsubscribe();
    entry.loader.dispose();
  }
  live.clear();
}

/** Paging of one status group, over its lanes. */
export interface TaskStatusGroupPaging {
  readonly hasMore: boolean;
  /** Its first page, or a next one, is on the way. */
  readonly loading: boolean;
}

/**
 * Paged task queries for the Tasks view, every filter applied by the server.
 * Grouped by status, the server's counts decide the groups and each open
 * group pages by itself; a collapsed group loads only its count.
 */
export function useTaskPages(
  targets: readonly TasksStateTarget[],
  projectFilter: ViewProjectFilter | null,
  statusFilter: string,
  tags: readonly string[],
  archive: TaskArchiveFilter,
  lastRun: string = ALL_FILTER,
  /** Grouped by status: whether a group is open, by status key. Keep it stable. */
  groupOpen: ((key: string) => boolean) | null = null,
) {
  const grouped = groupOpen !== null;
  const baseLanes = useMemo(
    () =>
      planTaskQueryLanes({
        targets,
        projectFilter,
        statusFilter: grouped ? ALL_FILTER : statusFilter,
        tags,
        archive,
        lastRun,
        pageSize: PAGE_SIZE,
      }),
    [targets, projectFilter, grouped, statusFilter, tags, archive, lastRun],
  );
  const countLanes = useMemo(() => (grouped ? baseLanes : []), [grouped, baseLanes]);

  const [byCountLane, setByCountLane] = useState<Record<string, TaskStatusCountsState>>(() =>
    Object.fromEntries(
      countLanes.flatMap((lane) => {
        const counts = recentCounts(lane);
        return counts
          ? [[lane.key, { counts, initialLoading: false, error: undefined, disconnected: false }]]
          : [];
      }),
    ),
  );
  // As the plan reads them: absent while loading, null when the server gave none.
  const countsByLane = useMemo(() => {
    const counts: Record<string, readonly TaskStatusCount[] | null> = {};
    for (const lane of countLanes) {
      const state = byCountLane[lane.key];
      if (state?.counts) counts[lane.key] = state.counts;
      else if (state?.error !== undefined) counts[lane.key] = null;
    }
    return counts;
  }, [byCountLane, countLanes]);
  const lanes = useMemo(
    () =>
      groupOpen
        ? planStatusGroupLanes({
            lanes: baseLanes,
            counts: countsByLane,
            open: groupOpen,
            statusFilter,
          })
        : baseLanes,
    [baseLanes, countsByLane, groupOpen, statusFilter],
  );

  // A lane seen recently shows its last rows on the first render.
  const [byLane, setByLane] = useState<Record<string, TaskPageLoadState>>(() =>
    Object.fromEntries(
      lanes.flatMap((lane) => {
        const page = recentPage(lane);
        return page ? [[lane.key, loadedState(page)]] : [];
      }),
    ),
  );
  const initialWaitOver = useTasksInitialWaitOver();
  const loaders = useRef(new Map<string, LiveLane<TaskPageLoader>>());
  const countLoaders = useRef(new Map<string, LiveLane<TaskStatusCountsLoader>>());
  const taskCache = useRef<readonly ScopedTaskListItem[]>([]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps one counts request lane per query lane, held until it goes
  useEffect(() => {
    syncLoaders(countLoaders.current, countLanes, (lane) => {
      const cached = recentCounts(lane);
      if (!lane.target.access.canReadTasks) recentStatusCounts.delete(lane.key);
      return new TaskStatusCountsLoader(
        lane.target,
        countsInput(lane),
        (state) => {
          if (state.counts) recentStatusCounts.set(lane.key, state.counts);
          setByCountLane((previous) => ({ ...previous, [lane.key]: state }));
        },
        150,
        cached,
      );
    });
  }, [countLanes]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps one page request lane per query lane, held until it goes
  useEffect(() => {
    const live = loaders.current;
    const cached = new Map<string, TaskPageState>();
    for (const lane of lanes) {
      if (live.get(lane.key)?.lane.target === lane.target) continue;
      const page = recentPage(lane);
      if (page) cached.set(lane.key, page);
      else if (!lane.target.access.canReadTasks) recentTaskPages.delete(lane.key);
    }
    // A recent lane starts from its last rows and refreshes in the background;
    // another keeps the rows on screen until its first page. No empty-table flash.
    setByLane((previous) => {
      const next = Object.fromEntries(
        lanes.map((lane) => {
          const shown = previous[lane.key];
          if (shown && live.get(lane.key)?.lane.target === lane.target) return [lane.key, shown];
          const page = cached.get(lane.key);
          return [
            lane.key,
            page
              ? shown?.page === page &&
                !shown.initialLoading &&
                !shown.loadingMore &&
                shown.error === undefined
                ? shown
                : loadedState(page)
              : {
                  page: shown?.page,
                  initialLoading: true,
                  loadingMore: false,
                  error: undefined,
                  disconnected: false,
                },
          ];
        }),
      );
      const keys = Object.keys(next);
      return keys.length === Object.keys(previous).length &&
        keys.every((key) => next[key] === previous[key])
        ? previous
        : next;
    });
    syncLoaders(
      live,
      lanes,
      (lane) =>
        new TaskPageLoader(
          lane.target,
          // Details read a task's text themselves, so the rows go without it.
          { ...lane.search, omitText: true },
          (state) => {
            if (state.page) recentTaskPages.set(lane.key, state.page);
            setByLane((previous) => ({
              ...previous,
              [lane.key]: { ...state, page: state.page ?? previous[lane.key]?.page },
            }));
          },
          150,
          cached.get(lane.key),
        ),
    );
  }, [lanes]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the document's visibility, and the lanes' teardown on unmount
  useEffect(() => {
    // Foreground is a recovery boundary, not a recurring polling interval.
    const foreground = () => {
      if (document.visibilityState !== "visible") return;
      for (const { loader } of countLoaders.current.values()) loader.refresh();
      for (const { loader } of loaders.current.values()) loader.refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    const pages = loaders.current;
    const counts = countLoaders.current;
    return () => {
      document.removeEventListener("visibilitychange", foreground);
      disposeAll(pages);
      disposeAll(counts);
    };
  }, []);

  // Only lanes of the current query count; a stale entry may linger for one
  // render between a filter change and the effect that replaces the lanes.
  const laneStates = lanes.flatMap((lane) => {
    const state = byLane[lane.key];
    return state ? [{ lane, state }] : [];
  });
  const states = laneStates.map(({ state }) => state);
  const nextTasks = states.flatMap((state) => state.page?.tasks ?? []).sort(compareScopedTaskOrder);
  // While a replaced query has not produced any page yet, keep the rows already
  // on screen instead of flashing an empty table.
  const awaitingFirstPage =
    lanes.length > 0 && states.every((state) => state.initialLoading && !state.page);
  if (
    !awaitingFirstPage &&
    (nextTasks.length !== taskCache.current.length ||
      nextTasks.some((task, index) => task !== taskCache.current[index]))
  )
    taskCache.current = nextTasks;

  // Counts per status key: the servers' counts, and the loaded rows of a lane
  // whose server has none (it pages as one list, with Load more).
  let groupCounts: Map<string, number> | null = null;
  if (grouped) {
    groupCounts = new Map();
    const add = (status: string, count: number) => {
      const key = statusGroupKey(status);
      groupCounts!.set(key, (groupCounts!.get(key) ?? 0) + count);
    };
    for (const counts of Object.values(countsByLane))
      for (const { status, count } of counts ?? []) add(status, count);
    for (const { lane, state } of laneStates)
      if (lane.group === undefined) for (const task of state.page?.tasks ?? []) add(task.status, 1);
  }
  const groupPaging = new Map<string, TaskStatusGroupPaging>();
  // A lane the effect has not started yet is loading too: its rows may come from a cache at once.
  for (const lane of lanes) {
    if (lane.group === undefined) continue;
    const state = byLane[lane.key];
    const current = groupPaging.get(lane.group);
    groupPaging.set(lane.group, {
      hasMore: (current?.hasMore ?? false) || state?.page?.nextCursor != null,
      loading: (current?.loading ?? false) || !state || state.initialLoading || state.loadingMore,
    });
  }
  const listStates = laneStates.filter(({ lane }) => lane.group === undefined);

  // A failed load is a Notifications card per computer.
  const { status, failures, offlineEnvironmentIds } = resolveTaskPagesStatus({
    lanes: [
      // A lane's counts speak for it while its groups load; a lane without counts speaks by its rows.
      ...countLanes
        .filter((lane) => countsByLane[lane.key] !== null)
        .map((lane) => ({
          environmentId: lane.target.environmentId,
          accessPending: lane.target.access.availability === "loading",
          accessUnavailable: lane.target.access.availability === "unavailable",
          state: byCountLane[lane.key],
        })),
      ...lanes.map((lane) => ({
        environmentId: lane.target.environmentId,
        accessPending: lane.target.access.availability === "loading",
        accessUnavailable: lane.target.access.availability === "unavailable",
        state: byLane[lane.key],
      })),
    ],
    initialWaitOver,
  });
  const reload = useCallback(() => {
    for (const { loader } of countLoaders.current.values()) loader.refresh();
    for (const { loader } of loaders.current.values()) loader.refresh();
  }, []);
  useHeldClientNotices(
    [...failures].map(([environmentId, detail]): ClientNoticeInput => ({
      id: "tasks:list",
      environmentId,
      severity: "error",
      title: msg("Tasks didn't load on {computer}"),
      message: msg("The list shows what it had before."),
      detail,
    })),
    reload,
  );
  return {
    tasks: taskCache.current,
    statuses: [
      ...new Set([
        ...states.flatMap((state) => state.page?.statuses ?? []),
        ...Object.values(countsByLane).flatMap((counts) =>
          (counts ?? []).map((count) => count.status),
        ),
      ]),
    ],
    /** Tasks per status key while grouped; null when the list is not grouped. */
    groupCounts,
    groupPaging,
    /** Loads the next page of one status group's lanes. */
    loadGroup: useCallback((key: string) => {
      for (const { lane, loader } of loaders.current.values())
        if (lane.group === key) loader.loadMore();
    }, []),
    hasMore: listStates.some(({ state }) => state.page?.nextCursor != null),
    loadingMore: listStates.some(({ state }) => state.loadingMore),
    status,
    offlineEnvironmentIds,
    reload,
    loadMore: useCallback(() => {
      for (const { lane, loader } of loaders.current.values())
        if (lane.group === undefined) loader.loadMore();
    }, []),
  };
}
