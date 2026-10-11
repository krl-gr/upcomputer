import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";

import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";

import { useStoredTasksView } from "../planner/data/preferences.ts";
import { PlannerView } from "../planner/ui/PlannerView.tsx";
import { TasksViewSwitch } from "../planner/ui/TasksViewSwitch.tsx";
import { taskKey } from "./shared.ts";
import { useTaskPages } from "./useTaskPages.ts";
import { TasksView } from "./TasksView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { useTasksPageFilters } from "./pageFilters.ts";
import { usePagesProjectFilter } from "./usePagesProjectFilter.ts";
import { ProjectFilterSelect } from "./ProjectFilterSelect.tsx";

/**
 * The Tasks page as a right-panel surface beside a thread: the same Planner or
 * Table (the page's last choice) with the page's filters, whatever the thread's
 * project, and a task opened inside the panel instead of the URL.
 */
export default function TasksPanel() {
  const [storedView, setStoredView] = useStoredTasksView();
  // A task opened here, from the table or the planner's "Open in table".
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | undefined>(undefined);
  const view = selectedTaskKey === undefined ? storedView : "table";
  const openTask = useCallback(
    (environmentId: EnvironmentId, taskId: string) =>
      setSelectedTaskKey(taskKey({ environmentId, id: taskId })),
    [],
  );

  return view === "planner" ? (
    <PlannerPanel
      viewSwitch={<TasksViewSwitch value={view} onChange={setStoredView} icons />}
      onShowTable={() => setStoredView("table")}
      onOpenTask={openTask}
    />
  ) : (
    <TablePanel
      viewSwitch={<TasksViewSwitch value={view} onChange={setStoredView} />}
      selectedTaskKey={selectedTaskKey}
      onSelectedTaskKeyChange={setSelectedTaskKey}
    />
  );
}

function PlannerPanel(props: {
  readonly viewSwitch: ReactNode;
  readonly onShowTable: () => void;
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
}) {
  const data = useTasksWorkspaceData(false);
  return (
    <PlannerView
      panel
      viewSwitch={props.viewSwitch}
      projects={data.projects}
      taskTargets={data.taskTargets}
      agents={data.agents.agents}
      onShowTable={props.onShowTable}
      onOpenTask={props.onOpenTask}
      onNavigateBack={() => undefined}
    />
  );
}

function TablePanel(props: {
  readonly viewSwitch: ReactNode;
  readonly selectedTaskKey: string | undefined;
  readonly onSelectedTaskKeyChange: (taskKey: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const data = useTasksWorkspaceData(false);
  const serverConfigs = useServerConfigs();
  const { projectFilter, projectGroups, setProjectKey } = usePagesProjectFilter();
  const [filters, setFilters] = useTasksPageFilters();
  const pages = useTaskPages(
    data.taskTargets,
    projectFilter,
    filters.status,
    filters.tags,
    filters.archive ?? "active",
  );
  const providerEntriesByEnvironment = useMemo(
    () =>
      new Map(
        [...serverConfigs].map(([environmentId, config]) => [
          environmentId,
          deriveProviderInstanceEntries(config.providers),
        ]),
      ),
    [serverConfigs],
  );

  return (
    <TasksView
      layout="panel"
      projects={data.projects}
      tasks={pages.tasks}
      statuses={pages.statuses}
      projectFilter={projectFilter}
      viewSwitch={props.viewSwitch}
      projectSelect={
        <ProjectFilterSelect
          projectGroups={projectGroups}
          value={projectFilter?.key ?? null}
          onChange={setProjectKey}
        />
      }
      filters={filters}
      onFiltersChange={setFilters}
      hasMore={pages.hasMore}
      loadingMore={pages.loadingMore}
      onLoadMore={pages.loadMore}
      agents={data.agents.agents}
      runs={data.agents.runs}
      providerEntriesByEnvironment={providerEntriesByEnvironment}
      status={pages.status}
      {...(props.selectedTaskKey === undefined
        ? {}
        : { initialSelectedTaskKey: props.selectedTaskKey })}
      {...(pages.errorMessage === undefined ? {} : { errorMessage: pages.errorMessage })}
      canMutateEnvironment={data.canMutateTasks}
      getClient={data.getClient}
      onReload={pages.reload}
      onNavigateBack={() => props.onSelectedTaskKeyChange(undefined)}
      onSelectedTaskKeyChange={(taskKey) => props.onSelectedTaskKeyChange(taskKey ?? undefined)}
      onOpenThread={(environmentId, threadId) => {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        });
      }}
    />
  );
}
