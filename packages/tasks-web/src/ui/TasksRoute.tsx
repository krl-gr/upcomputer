import { useCallback, useMemo } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";

import { useTaskPages } from "./useTaskPages.ts";
import { TasksView } from "./TasksView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { usePagesProjectFilter } from "./usePagesProjectFilter.ts";
import { ProjectFilterSelect } from "./ProjectFilterSelect.tsx";
import { useTasksPageFilters } from "./pageFilters.ts";

export default function TasksRoute() {
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
          search: taskKey ? { task: taskKey } : {},
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
