import type { EnvironmentId } from "@t3tools/contracts";
import { addDays } from "@t3tools/tasks-client/planner/dates";
import {
  errorMessage,
  PlannerStore,
  type PlannerKind,
  type PlannerSnapshot,
  type PlannerWriteFailure,
} from "@t3tools/tasks-client/planner/plannerStore";
import type { TasksWebAvailability } from "@t3tools/tasks-client/rpc";
import { msg } from "gt-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { m } from "../../../i18n/messages";
import {
  readTasksAccess,
  readTasksClient,
  readTasksPlannerAvailability,
  subscribeTasksAccess,
} from "../tasksRpc";

/** The planner store's failures, in the desktop's words. */
const FAILURE_TITLES: Record<PlannerWriteFailure, string> = {
  createRoutine: msg("Could not create the routine"),
  createTask: msg("Could not create the task"),
  updateTask: msg("Could not update the task"),
  archiveTask: msg("Could not archive the task"),
  archiveTasks: msg("Could not archive the tasks"),
  restoreTask: msg("Could not restore the task"),
  restoreTasks: msg("Could not restore the tasks"),
  deleteTask: msg("Could not delete the task"),
  moveTask: msg("Could not move the task"),
  moveTasks: msg("Could not move the tasks"),
  scheduleTask: msg("Could not schedule the task"),
  moveEntry: msg("Could not move the entry"),
  moveEntries: msg("Could not move the entries"),
  updateEntry: msg("Could not update the entry"),
  deleteEntry: msg("Could not delete the entry"),
  deleteEntries: msg("Could not delete the entries"),
  copyEntries: msg("Could not copy the entries"),
  rescheduleDay: msg("Could not reschedule the day"),
};

const stores = new Map<EnvironmentId, PlannerStore>();

/** One planner store per computer for the session, shared by the planner and the New task sheet. */
export function plannerStoreFor(environmentId: EnvironmentId): PlannerStore {
  let store = stores.get(environmentId);
  if (!store) {
    store = new PlannerStore(
      {
        environmentId,
        client: readTasksClient(environmentId),
        access: readTasksAccess(environmentId),
      },
      {
        onError: (failure, error) => Alert.alert(m(FAILURE_TITLES[failure]), errorMessage(error)),
      },
    );
    stores.set(environmentId, store);
  }
  return store;
}

/** Whether the computer's server has the planner (schedule RPCs); the first read starts the check. */
export function usePlannerAvailability(
  environmentId: EnvironmentId | null,
): TasksWebAvailability | null {
  const read = () => (environmentId ? readTasksPlannerAvailability(environmentId) : null);
  return useSyncExternalStore(subscribeTasksAccess, read, read);
}

/**
 * The planner of one kind while it is on screen: the store follows the change stream, the
 * visible week (one day more on each side, as the desktop) and the list's progress counters.
 */
export function usePlanner(input: {
  readonly store: PlannerStore;
  readonly kind: PlannerKind;
  readonly weekFrom: string;
  readonly weekTo: string;
  /** The current week, for routines; tasks count every entry. */
  readonly progressWindow: { readonly from: string; readonly to: string } | null;
}): PlannerSnapshot {
  const { store, kind, weekFrom, weekTo } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the store on the computer's change stream while the planner is on screen
  useEffect(() => store.retain(), [store]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the store, outside React, which list this screen shows
  useEffect(() => store.setQuery({ projectIds: null, archiveVisible: false, kind }), [store, kind]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the store which dates are on screen
  useEffect(
    () => store.setRange(addDays(weekFrom, -1), addDays(weekTo, 1)),
    [store, weekFrom, weekTo],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const progressKey = snapshot.active.ids.join(",");
  const from = input.progressWindow?.from;
  const to = input.progressWindow?.to;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the store which rows show a progress counter
  useEffect(() => {
    store.trackProgress(
      progressKey ? progressKey.split(",") : [],
      from !== undefined && to !== undefined ? { from, to } : null,
    );
  }, [store, progressKey, from, to]);
  return snapshot;
}
