import { useCallback, useMemo, type ReactNode } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";

import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useEnvironmentProviders } from "../../../../apps/web/src/state/environments.ts";
import { useAnalyticsView } from "../../../../apps/web/src/uiAnalytics.ts";

import {
  useStoredPlannerEnvironment,
  useStoredTableSection,
  useStoredTasksView,
  type TasksViewMode,
} from "../planner/data/preferences.ts";
import { AutomationsView } from "../planner/ui/AutomationsView.tsx";
import { PlannerView } from "../planner/ui/PlannerView.tsx";
import { TasksViewSwitch } from "../planner/ui/TasksViewSwitch.tsx";
import { windowStoreFor } from "../planner/windows/windowStore.ts";
import { taskKey } from "./shared.ts";
import { TableSectionSwitch } from "./TableSectionSwitch.tsx";
import { useTaskPages } from "./useTaskPages.ts";
import { TasksView } from "./TasksView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { usePagesProjectFilter } from "./usePagesProjectFilter.ts";
import { ProjectFilterSelect } from "./ProjectFilterSelect.tsx";
import { useTasksPageFilters } from "./pageFilters.ts";

/**
 * /tasks has two sides, one switch: Me is the planner (person tasks and
 * routines, wande's layout, one environment), Agents is the table (agent
 * tasks of every environment, or the automations). The URL's `view` wins,
 * then the last choice; a `task` link always opens the table's task details,
 * whatever the task's audience. Only the table filters by project; the
 * planner leaves the stored choice (shared with Agents) as it is and lists
 * every project.
 */
export default function TasksRoute() {
  const navigate = useNavigate();
  const [storedView, setStoredView] = useStoredTasksView();
  const [storedSection, setSection] = useStoredTableSection();
  const [, setPlannerEnvironment] = useStoredPlannerEnvironment();
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
  const section = hasTask ? "tasks" : storedSection;
  useAnalyticsView(
    view === "planner" ? "planner" : section === "automations" ? "automations" : "tasks",
  );
  const setView = useCallback(
    (next: TasksViewMode) => {
      setStoredView(next);
      void navigate({ to: "/tasks", search: { view: next }, replace: true } as never);
    },
    [navigate, setStoredView],
  );
  // A task taken back from agents: its window in the planner, in its environment.
  const openInPlanner = useCallback(
    (environmentId: EnvironmentId, taskId: string) => {
      setPlannerEnvironment(environmentId);
      windowStoreFor(environmentId).openDetail(taskId);
      setView("planner");
    },
    [setPlannerEnvironment, setView],
  );
  if (view === "planner")
    return (
      <PlannerRoute
        viewSwitch={<TasksViewSwitch value={view} onChange={setView} />}
        onShowTable={() => setView("table")}
      />
    );
  const viewSwitch = (
    <>
      <TasksViewSwitch value={view} onChange={setView} />
      <TableSectionSwitch value={section} onChange={setSection} />
    </>
  );
  return section === "automations" ? (
    <AutomationsRoute viewSwitch={viewSwitch} onOpenInPlanner={openInPlanner} />
  ) : (
    <TasksTableRoute viewSwitch={viewSwitch} onOpenInPlanner={openInPlanner} />
  );
}

function useNavigateBack() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  return useCallback(() => {
    if (canGoBack) window.history.back();
    else void navigate({ to: "/" } as never);
  }, [canGoBack, navigate]);
}

function AutomationsRoute(props: {
  readonly viewSwitch: ReactNode;
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
}) {
  const navigate = useNavigate();
  const data = useTasksWorkspaceData(false);
  const navigateBack = useNavigateBack();
  return (
    <AutomationsView
      viewSwitch={props.viewSwitch}
      projects={data.projects}
      taskTargets={data.taskTargets}
      agents={data.agents.agents}
      onOpenTask={(environmentId, taskId) => {
        void navigate({
          to: "/tasks",
          search: { task: taskKey({ environmentId, id: taskId }) },
        } as never);
      }}
      onOpenInPlanner={props.onOpenInPlanner}
      onNavigateBack={navigateBack}
    />
  );
}

function PlannerRoute(props: { readonly viewSwitch: ReactNode; readonly onShowTable: () => void }) {
  const navigate = useNavigate();
  const data = useTasksWorkspaceData(false);
  const navigateBack = useNavigateBack();
  return (
    <PlannerView
      viewSwitch={props.viewSwitch}
      projects={data.projects}
      taskTargets={data.taskTargets}
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

function TasksTableRoute(props: {
  readonly viewSwitch: ReactNode;
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
}) {
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
  const providersByEnvironment = useEnvironmentProviders();
  const providerEntriesByEnvironment = useMemo(
    () =>
      new Map(
        [...providersByEnvironment].map(([environmentId, providers]) => [
          environmentId,
          deriveProviderInstanceEntries(providers),
        ]),
      ),
    [providersByEnvironment],
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
      onProjectFilterReset={() => setProjectKey(null)}
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
      onOpenInPlanner={props.onOpenInPlanner}
    />
  );
}
