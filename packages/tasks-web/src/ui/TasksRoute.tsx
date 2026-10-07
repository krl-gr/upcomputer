import { useCallback, useMemo, type ReactNode } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";

import { useStoredTasksView, type TasksViewMode } from "../planner/data/preferences.ts";
import { PlannerView } from "../planner/ui/PlannerView.tsx";
import { TasksViewSwitch } from "../planner/ui/TasksViewSwitch.tsx";
import { taskKey } from "./shared.ts";
import { useTaskPages } from "./useTaskPages.ts";
import { TasksView } from "./TasksView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { usePagesProjectFilter } from "./usePagesProjectFilter.ts";
import { ProjectFilterSelect } from "./ProjectFilterSelect.tsx";
import { useTasksPageFilters } from "./pageFilters.ts";

/**
 * /tasks has two modes: the Planner (person tasks, wande's layout, one
 * environment) and the Table (every task, every environment). The URL's
 * `view` wins, then the last choice; a `task` link always opens the table.
 */
export default function TasksRoute() {
  const navigate = useNavigate();
  const [storedView, setStoredView] = useStoredTasksView();
  const urlView = useLocation({
    select: (location) => {
      const view = (location.search as Record<string, unknown>).view;
      return view === "planner" || view === "table" ? view : null;
    },
  });
  const hasTask = useLocation({
    select: (location) => {
      const task = (location.search as Record<string, unknown>).task;
      return typeof task === "string" && task.length > 0;
    },
  });
  const view: TasksViewMode = hasTask ? "table" : (urlView ?? storedView);
  const setView = useCallback(
    (next: TasksViewMode) => {
      setStoredView(next);
      void navigate({ to: "/tasks", search: { view: next }, replace: true } as never);
    },
    [navigate, setStoredView],
  );
  const viewSwitch = <TasksViewSwitch value={view} onChange={setView} />;
  return view === "planner" ? (
    <PlannerRoute viewSwitch={viewSwitch} onShowTable={() => setView("table")} />
  ) : (
    <TasksTableRoute viewSwitch={viewSwitch} />
  );
}

function PlannerRoute(props: { readonly viewSwitch: ReactNode; readonly onShowTable: () => void }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const data = useTasksWorkspaceData(false);
  const { projectFilter, projectGroups, setProjectKey } = usePagesProjectFilter();
  const navigateBack = useCallback(() => {
    if (canGoBack) window.history.back();
    else void navigate({ to: "/" } as never);
  }, [canGoBack, navigate]);
  return (
    <PlannerView
      viewSwitch={props.viewSwitch}
      projectSelect={
        <ProjectFilterSelect
          projectGroups={projectGroups}
          value={projectFilter?.key ?? null}
          onChange={setProjectKey}
        />
      }
      projects={data.projects}
      taskTargets={data.taskTargets}
      projectFilter={projectFilter}
      agents={data.agents.agents}
      onShowTable={props.onShowTable}
      onOpenTask={(environmentId, taskId) => {
        void navigate({
          to: "/tasks",
          search: { task: taskKey({ environmentId, id: taskId }) },
        } as never);
      }}
      onNavigateBack={navigateBack}
    />
  );
}

function TasksTableRoute(props: { readonly viewSwitch: ReactNode }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const selectedTaskKey = useLocation({
    select: (location) => {
      const task = (location.search as Record<string, unknown>).task;
      return typeof task === "string" && task.length > 0 ? task : undefined;
    },
  });
  const data = useTasksWorkspaceData(false);
  const { projectFilter, projectGroups, setProjectKey } = usePagesProjectFilter();
  const [filters, setFilters] = useTasksPageFilters();
  const pages = useTaskPages(
    data.taskTargets,
    projectFilter,
    filters.status,
    filters.tags,
    filters.archive ?? "active",
  );
  const serverConfigs = useServerConfigs();
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
  const navigateBack = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({
      to: selectedTaskKey ? "/tasks" : "/",
      ...(selectedTaskKey ? { search: {}, replace: true } : {}),
    } as never);
  }, [canGoBack, navigate, selectedTaskKey]);

  return (
    <TasksView
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
      {...(selectedTaskKey === undefined ? {} : { initialSelectedTaskKey: selectedTaskKey })}
      {...(pages.errorMessage === undefined ? {} : { errorMessage: pages.errorMessage })}
      canMutateEnvironment={data.canMutateTasks}
      getClient={data.getClient}
      onReload={pages.reload}
      onNavigateBack={navigateBack}
      onSelectedTaskKeyChange={(taskKey) => {
        void navigate({
          to: "/tasks",
          search: taskKey ? { task: taskKey } : { view: "table" },
          ...(taskKey ? {} : { replace: true }),
        } as never);
      }}
      onOpenThread={(environmentId, threadId) => {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        });
      }}
    />
  );
}
