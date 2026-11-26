import type { EnvironmentId } from "@t3tools/contracts";
import {
  AutomationStore,
  type AutomationSnapshot,
  type AutomationWriteFailure,
} from "@t3tools/tasks-client/automations/automationStore";
import { errorMessage } from "@t3tools/tasks-client/planner/plannerStore";
import { msg } from "gt-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { m } from "../../../i18n/messages";
import { readTasksClient } from "../tasksRpc";

/** The automation store's failures, in the desktop's words. */
const FAILURE_TITLES: Record<AutomationWriteFailure, string> = {
  createAutomation: msg("Could not create the automation"),
  saveAutomation: msg("Could not save the automation"),
  enableAutomation: msg("Could not enable the automation"),
  pauseAutomation: msg("Could not pause the automation"),
  deleteAutomation: msg("Could not delete the automation"),
  moveAutomation: msg("Could not move the automation"),
};

const stores = new Map<EnvironmentId, AutomationStore>();

/** One automation store per computer for the session, shared by the list and the page. */
export function automationStoreFor(environmentId: EnvironmentId): AutomationStore {
  let store = stores.get(environmentId);
  if (!store) {
    store = new AutomationStore(readTasksClient(environmentId), {
      onError: (failure, error) => Alert.alert(m(FAILURE_TITLES[failure]), errorMessage(error)),
    });
    stores.set(environmentId, store);
  }
  return store;
}

/** The computer's automations, kept live while the caller is on screen and `enabled`. */
export function useAutomations(store: AutomationStore, enabled: boolean): AutomationSnapshot {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the store on the computer's change stream while the list or page is on screen
  useEffect(() => (enabled ? store.retain() : undefined), [store, enabled]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
