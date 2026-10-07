/**
 * React access to an environment's planner store, under wande's hook names
 * where a ported component reads them. Writes are store methods.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { readTasksWebAccess, readTasksWebClient } from "../../environmentApi.ts";
import { addDays } from "../logic/dates.ts";
import type { PlannerTask } from "./pendingOps.ts";
import {
  errorMessage,
  PlannerStore,
  type PaginationStatus,
  type PlannerListState,
  type PlannerSnapshot,
  type ProgressWindow,
} from "./plannerStore.ts";

const stores = new Map<EnvironmentId, PlannerStore>();

/** One store per environment for the session, so windows and data survive leaving /tasks. */
export function plannerStoreFor(environmentId: EnvironmentId): PlannerStore {
  let store = stores.get(environmentId);
  if (!store) {
    store = new PlannerStore(
      {
        environmentId,
        client: readTasksWebClient(environmentId),
        access: readTasksWebAccess(environmentId),
      },
      {
        onError: (title, error) =>
          toastManager.add({ type: "error", title, description: errorMessage(error) }),
      },
    );
    stores.set(environmentId, store);
  }
  return store;
}

export function usePlannerSnapshot(store: PlannerStore): PlannerSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Keeps the store following the change stream while the planner is mounted. */
export function usePlannerLive(store: PlannerStore) {
  useEffect(() => store.retain(), [store]);
}

export interface PaginatedTasks {
  readonly results: readonly PlannerTask[];
  readonly status: PaginationStatus;
  readonly loadMore: () => void;
}

function paginated(
  store: PlannerStore,
  tasks: ReadonlyMap<string, PlannerTask>,
  list: PlannerListState,
  key: "active" | "archive",
): PaginatedTasks {
  return {
    results: list.ids.flatMap((id) => {
      const task = tasks.get(id);
      return task ? [task] : [];
    }),
    status: list.status,
    loadMore: () => store.loadMore(key),
  };
}

export function useActiveTasksPaginated(store: PlannerStore, snapshot: PlannerSnapshot) {
  const { active, view } = snapshot;
  return useMemo(() => paginated(store, view.tasks, active, "active"), [store, view.tasks, active]);
}

export function useArchivedTasksPaginated(store: PlannerStore, snapshot: PlannerSnapshot) {
  const { archive, view } = snapshot;
  return useMemo(
    () => paginated(store, view.tasks, archive, "archive"),
    [store, view.tasks, archive],
  );
}

/** A task by id, loading it when no list or day holds it; null while unknown. */
export function useTaskById(store: PlannerStore, snapshot: PlannerSnapshot, taskId: string) {
  useEffect(() => store.ensureTask(taskId), [store, taskId]);
  return snapshot.view.tasks.get(taskId) ?? null;
}

/** A task's entries for its detail window, followed while mounted. */
export function useQueueInstancesByTaskId(
  store: PlannerStore,
  snapshot: PlannerSnapshot,
  taskId: string,
  enabled: boolean,
): readonly TaskScheduleEntry[] | undefined {
  useEffect(() => (enabled ? store.watchSchedule(taskId) : undefined), [store, taskId, enabled]);
  return snapshot.schedules.get(taskId);
}

export interface DayEntries {
  readonly date: string;
  readonly entries: readonly TaskScheduleEntry[];
}

/** Wande's day queues: each shown date's entries in queue order, joined with tasks on render. */
export function useDayQueues(
  store: PlannerStore,
  snapshot: PlannerSnapshot,
  dates: readonly string[],
): readonly DayEntries[] {
  const from = dates[0];
  const to = dates.at(-1);
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    // One day more on each side, as wande, so moving to the next day is already loaded.
    store.setRange(addDays(from, -1), addDays(to, 1));
  }, [store, from, to]);
  return useMemo(
    () => dates.map((date) => ({ date, entries: snapshot.view.days.get(date) ?? [] })),
    [dates, snapshot.view.days],
  );
}

/**
 * Progress chips of list rows; only fetched while the counter is shown. A
 * window limits them to its dates (wande counts routines per week).
 */
export function useQueueProgressByTaskIds(
  store: PlannerStore,
  snapshot: PlannerSnapshot,
  taskIds: readonly string[],
  enabled: boolean,
  window: ProgressWindow | null = null,
) {
  const key = enabled ? taskIds.join(",") : "";
  const from = window?.from;
  const to = window?.to;
  useEffect(() => {
    store.trackProgress(
      key ? key.split(",") : [],
      from !== undefined && to !== undefined ? { from, to } : null,
    );
  }, [store, key, from, to]);
  return snapshot.progress;
}
