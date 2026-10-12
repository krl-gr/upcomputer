import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareScopedTaskOrder, type TasksStateTarget } from "../state/tasksState.ts";
import { TaskPageLoader, type TaskPageLoadState } from "../state/taskPageLoader.ts";
import {
  recentTaskPages,
  type TaskPageState,
  type ScopedTaskListItem,
} from "../state/taskPages.ts";
import type { TaskArchiveFilter } from "@t3tools/tasks-contracts/v1";
import { planTaskQueryLanes, type TaskQueryLane, type ViewProjectFilter } from "./projectFilter.ts";

const PAGE_SIZE = 100;

function recentPage(lane: TaskQueryLane) {
  return lane.target.access.canReadTasks ? recentTaskPages.get(lane.key) : undefined;
}

function loadedState(page: TaskPageState): TaskPageLoadState {
  return { page, initialLoading: false, loadingMore: false, error: undefined };
}

/**
 * Paged task queries for the Tasks view: the header's project, task status,
 * tags (every tag required) and archive state, all applied by the server.
 */
export function useTaskPages(
  targets: readonly TasksStateTarget[],
  projectFilter: ViewProjectFilter | null,
  statusFilter: string,
  tags: readonly string[],
  archive: TaskArchiveFilter,
) {
  const lanes = useMemo(
    () =>
      planTaskQueryLanes({
        targets,
        projectFilter,
        statusFilter,
        tags,
        archive,
        pageSize: PAGE_SIZE,
      }),
    [targets, projectFilter, statusFilter, tags, archive],
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
  const loaders = useRef<TaskPageLoader[]>([]);
  const taskCache = useRef<readonly ScopedTaskListItem[]>([]);

  useEffect(() => {
    let disposed = false;
    const cached = new Map<string, TaskPageState>();
    for (const lane of lanes) {
      const page = recentPage(lane);
      if (page) cached.set(lane.key, page);
      else if (!lane.target.access.canReadTasks) recentTaskPages.delete(lane.key);
    }
    // A recent lane starts from its last rows and refreshes in the background;
    // another keeps the rows on screen until its first page. No empty-table flash.
    setByLane((previous) => {
      const next = Object.fromEntries(
        lanes.map((lane) => {
          const page = cached.get(lane.key);
          const shown = previous[lane.key];
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
    const lanesByTarget = new Map<TasksStateTarget, TaskPageLoader[]>();
    loaders.current = lanes.map((lane) => {
      const loader = new TaskPageLoader(
        lane.target,
        lane.search,
        (state) => {
          if (disposed) return;
          if (state.page) recentTaskPages.set(lane.key, state.page);
          setByLane((previous) => ({
            ...previous,
            [lane.key]: {
              ...state,
              page: state.page ?? previous[lane.key]?.page,
            },
          }));
        },
        150,
        cached.get(lane.key),
      );
      lanesByTarget.set(lane.target, [...(lanesByTarget.get(lane.target) ?? []), loader]);
      return loader;
    });
    // One change subscription per environment, fanned out to its project lanes.
    const subscriptions: (() => void)[] = [];
    for (const [target, targetLoaders] of lanesByTarget) {
      if (target.access.canReadTasks)
        subscriptions.push(
          target.client.tasks.subscribe(
            (change) => {
              for (const loader of targetLoaders) loader.change(change);
            },
            (error) => {
              for (const loader of targetLoaders) loader.fail(error);
            },
          ),
        );
      else for (const loader of targetLoaders) loader.fail(new Error(target.access.reason));
    }
    // Foreground is a recovery boundary, not a recurring polling interval.
    const foreground = () => {
      if (document.visibilityState === "visible")
        for (const loader of loaders.current) loader.refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    const current = loaders.current;
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", foreground);
      for (const unsubscribe of subscriptions) unsubscribe();
      for (const loader of current) loader.dispose();
    };
  }, [lanes]);

  // Only lanes of the current query count; a stale entry may linger for one
  // render between a filter change and the effect that replaces the lanes.
  const states = lanes.flatMap((lane) => {
    const state = byLane[lane.key];
    return state ? [state] : [];
  });
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
  const errors = states.flatMap((state) => (state.error ? [state.error] : []));
  const initialLoading =
    states.length < lanes.length || states.some((state) => state.initialLoading);
  return {
    tasks: taskCache.current,
    statuses: [...new Set(states.flatMap((state) => state.page?.statuses ?? []))],
    hasMore: states.some((state) => state.page?.nextCursor != null),
    loadingMore: states.some((state) => state.loadingMore),
    errorMessage: [...new Set(errors)].join(" "),
    status: initialLoading
      ? ("loading" as const)
      : errors.length > 0
        ? ("error" as const)
        : ("ready" as const),
    reload: useCallback(() => {
      for (const loader of loaders.current) loader.refresh();
    }, []),
    loadMore: useCallback(() => {
      for (const loader of loaders.current) loader.loadMore();
    }, []),
  };
}
