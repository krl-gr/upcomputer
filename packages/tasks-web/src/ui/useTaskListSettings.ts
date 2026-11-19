import {
  DEFAULT_TASK_LIST_SETTINGS,
  TaskListSettings,
  type TaskListSettingsUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useLocalStorage } from "../../../../apps/web/src/hooks/useLocalStorage.ts";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { useStoredPlannerEnvironment } from "../planner/data/preferences.ts";
import { pickEnvironment } from "../planner/ui/PlannerView.tsx";
import type { TasksStateTarget } from "../state/tasksState.ts";

/** This device's copy of the list settings: shown at once, and kept for a server without them. */
export const TASK_LIST_SETTINGS_STORAGE_KEY = "upcomputer:tasks:list-settings";

/** The stored settings with one change applied; open groups merge per key, as on the server. */
export function applyTaskListSettings(
  current: TaskListSettings,
  patch: TaskListSettingsUpdateInput,
): TaskListSettings {
  return {
    groupByStatus: patch.groupByStatus ?? current.groupByStatus,
    statusGroupOrder: patch.statusGroupOrder ?? current.statusGroupOrder,
    statusGroupOpen: { ...current.statusGroupOpen, ...patch.statusGroupOpen },
  };
}

/**
 * How the agents' task list shows: grouped by status or not, the group order
 * and the open groups. They follow the user across devices on the computer
 * the planner uses (each computer has its own tasks database, so one of them
 * keeps these); local storage holds the last copy.
 */
export function useTaskListSettings(targets: readonly TasksStateTarget[]) {
  const [settings, setSettings] = useLocalStorage(
    TASK_LIST_SETTINGS_STORAGE_KEY,
    DEFAULT_TASK_LIST_SETTINGS,
    TaskListSettings,
  );
  const [storedPlannerEnvironment] = useStoredPlannerEnvironment();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const source = useMemo(() => {
    const candidates = targets.filter((target) => target.access.canReadTasks);
    const environmentId = pickEnvironment(
      candidates,
      storedPlannerEnvironment,
      primaryEnvironmentId,
    );
    return candidates.find((target) => target.environmentId === environmentId) ?? null;
  }, [primaryEnvironmentId, storedPlannerEnvironment, targets]);
  // Bumped by every read and local change, so a read that started before a change is dropped.
  const generation = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the source computer's settings and their change stream
  useEffect(() => {
    if (!source) return;
    let disposed = false;
    const load = () => {
      const request = ++generation.current;
      source.client.tasks.getListSettings({}).then(
        (next) => {
          if (!disposed && request === generation.current) setSettings(next);
        },
        // A server without list settings: this device's copy stays.
        () => undefined,
      );
    };
    const unsubscribe = source.client.tasks.subscribe((change) => {
      if (change.kind === "sync" || change.listSettingsChanged) load();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [setSettings, source]);

  const update = useCallback(
    (patch: TaskListSettingsUpdateInput) => {
      generation.current++;
      setSettings((current) => applyTaskListSettings(current, patch));
      if (source?.access.canMutateTasks)
        source.client.tasks.updateListSettings(patch).catch(() => undefined);
    },
    [setSettings, source],
  );
  return { settings, update };
}
