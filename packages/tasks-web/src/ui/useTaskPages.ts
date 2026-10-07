import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareScopedTaskOrder, type TasksStateTarget } from "../state/tasksState.ts";
import { TaskPageLoader, type TaskPageLoadState } from "../state/taskPageLoader.ts";
import type { TaskPageState, ScopedTaskListItem } from "../state/taskPages.ts";
import type { TaskArchiveFilter } from "@t3tools/tasks-contracts/v1";
import { planTaskQueryLanes, type ViewProjectFilter } from "./projectFilter.ts";

const PAGE_SIZE = 100;

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
  const [byLane, setByLane] = useState<Record<string, TaskPageLoadState>>({});
  const loaders = useRef<TaskPageLoader[]>([]);
  const pageCache = useRef<Record<string, TaskPageState>>({});
  const queryKey = useRef("");
  const taskCache = useRef<readonly ScopedTaskListItem[]>([]);
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

  useEffect(() => {
    let disposed = false;
    const key = JSON.stringify(lanes.map((lane) => lane.key));
    const sameQuery = queryKey.current === key;
    queryKey.current = key;
    const cached = sameQuery ? pageCache.current : {};
    pageCache.current = cached;
    // Keep already displayed rows while replacing the query, but start each new
    // query at its first page. No empty-table flash during synchronization.
    setByLane((previous) =>
      Object.fromEntries(
        lanes.map((lane) => [
          lane.key,
          {
            page: previous[lane.key]?.page,
            initialLoading: !sameQuery || !previous[lane.key]?.page,
            loadingMore: false,
            error: undefined,
          },
        ]),
      ),
    );
    const lanesByTarget = new Map<TasksStateTarget, TaskPageLoader[]>();
    loaders.current = lanes.map((lane) => {
      const loader = new TaskPageLoader(
        lane.target,
        lane.search,
        (state) => {
          if (disposed) return;
          if (state.page) pageCache.current[lane.key] = state.page;
          setByLane((previous) => ({
            ...previous,
            [lane.key]: {
              ...state,
              page: state.page ?? previous[lane.key]?.page,
            },
          }));
        },
        150,
        cached[lane.key],
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
