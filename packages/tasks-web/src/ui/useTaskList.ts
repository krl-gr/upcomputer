import type { TaskListSettings, TaskListSettingsUpdateInput } from "@t3tools/tasks-contracts/v1";
import { useMemo } from "react";

import type { TasksStateTarget } from "../state/tasksState.ts";
import type { TasksPageFilters } from "./pageFilters.ts";
import type { ViewProjectFilter } from "./projectFilter.ts";
import { isStatusGroupOpen } from "./taskStatusGroups.ts";
import { useTaskListSettings } from "./useTaskListSettings.ts";
import { useTaskPages, type TaskStatusGroupPaging } from "./useTaskPages.ts";

/** Grouping by status, for the Tasks view: the settings and each group's count and paging. */
export interface TasksViewGrouping {
  readonly settings: TaskListSettings;
  readonly onSettingsChange: (patch: TaskListSettingsUpdateInput) => void;
  /** Tasks per status key while grouped. */
  readonly counts: ReadonlyMap<string, number> | null;
  readonly paging: ReadonlyMap<string, TaskStatusGroupPaging>;
  readonly onLoadGroup: (key: string) => void;
}

/** The agents' task list of the Tasks page and panel: its pages and its grouping by status. */
export function useTaskList(
  targets: readonly TasksStateTarget[],
  projectFilter: ViewProjectFilter | null,
  filters: TasksPageFilters,
) {
  const { settings, update } = useTaskListSettings(targets);
  const openKey = JSON.stringify(settings.statusGroupOpen);
  const groupOpen = useMemo(() => {
    if (!settings.groupByStatus) return null;
    const open = JSON.parse(openKey) as Record<string, boolean>;
    return (key: string) => isStatusGroupOpen(open, key);
  }, [openKey, settings.groupByStatus]);
  const pages = useTaskPages(
    targets,
    projectFilter,
    filters.status,
    filters.tags,
    filters.archive ?? "active",
    filters.lastRun,
    groupOpen,
  );
  const grouping: TasksViewGrouping = {
    settings,
    onSettingsChange: update,
    counts: pages.groupCounts,
    paging: pages.groupPaging,
    onLoadGroup: pages.loadGroup,
  };
  return { pages, grouping };
}
