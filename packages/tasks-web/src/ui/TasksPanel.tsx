import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";

import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/extensionApi.ts";
import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";

import { useStoredTasksView } from "../planner/data/preferences.ts";
import { PlannerView } from "../planner/ui/PlannerView.tsx";
import { TasksViewSwitch } from "../planner/ui/TasksViewSwitch.tsx";
import { taskKey } from "./shared.ts";
import { useTaskPages } from "./useTaskPages.ts";
import { TasksView } from "./TasksView.tsx";
import { useSidebarProjectSnapshots, useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { useTasksPageFilters } from "./pageFilters.ts";
import { threadProjectFilter, type ViewProjectFilter } from "./projectFilter.ts";

/**
 * The Tasks page as a right-panel surface beside a thread: the same Planner or
 * Table (the page's last choice), limited to the thread's project, with a
 * task opened inside the panel instead of the URL.
 */
export default function TasksPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  const [storedView, setStoredView] = useStoredTasksView();
  // A task opened here, from the table or the planner's "Open in table".
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | undefined>(undefined);
  const view = selectedTaskKey === undefined ? storedView : "table";
  const projectFilter = useThreadProjectFilter(props);
  const openTask = useCallback(
    (environmentId: EnvironmentId, taskId: string) =>
      setSelectedTaskKey(taskKey({ environmentId, id: taskId })),
    [],
  );

  return view === "planner" ? (
    <PlannerPanel
      {...props}
      projectFilter={projectFilter}
      viewSwitch={<TasksViewSwitch value={view} onChange={setStoredView} icons />}
      onShowTable={() => setStoredView("table")}
      onOpenTask={openTask}
    />
  ) : (
    <TablePanel
      projectFilter={projectFilter}
      viewSwitch={<TasksViewSwitch value={view} onChange={setStoredView} />}
      selectedTaskKey={selectedTaskKey}
      onSelectedTaskKeyChange={setSelectedTaskKey}
    />
  );
}

/** The thread's logical project, kept by value: the snapshots change whenever any project does. */
function useThreadProjectFilter(props: ExperimentalWebRightPanelSurfaceProps) {
  const projectGroups = useSidebarProjectSnapshots();
  const serverConfigs = useServerConfigs();
  const candidate = threadProjectFilter(
    projectGroups,
    props.projectId === null
      ? null
      : { environmentId: props.environmentId, projectId: props.projectId },
    (group) =>
      group.memberProjects.some((member) =>
        isScratchProject(member, serverConfigs.get(member.environmentId)?.scratchWorkspaceRoot),
      ),
  );
  const signature = candidate
    ? JSON.stringify([
        candidate.key,
        candidate.label,
        candidate.projectRefs.map((ref) => [ref.environmentId, ref.projectId]),
      ])
    : null;
  return useMemo<ViewProjectFilter | null>(() => candidate, [signature]);
}

function PlannerPanel(
  props: ExperimentalWebRightPanelSurfaceProps & {
    readonly projectFilter: ViewProjectFilter | null;
    readonly viewSwitch: ReactNode;
    readonly onShowTable: () => void;
    readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  },
) {
  const data = useTasksWorkspaceData(false);
  const { environmentId, projectId, projectFilter } = props;
  // The planner shows one environment: the thread's members of its project, its own first.
  const panel = useMemo(() => {
    const projectIds =
      projectFilter?.projectRefs
        .filter((ref) => ref.environmentId === environmentId)
        .map((ref) => ref.projectId)
        .sort((left, right) => Number(right === projectId) - Number(left === projectId)) ?? null;
    return { environmentId, projectIds };
  }, [environmentId, projectId, projectFilter]);
  return (
    <PlannerView
      panel={panel}
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
  readonly projectFilter: ViewProjectFilter | null;
  readonly viewSwitch: ReactNode;
  readonly selectedTaskKey: string | undefined;
  readonly onSelectedTaskKeyChange: (taskKey: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const data = useTasksWorkspaceData(false);
  const serverConfigs = useServerConfigs();
  const [filters, setFilters] = useTasksPageFilters();
  const pages = useTaskPages(
    data.taskTargets,
    props.projectFilter,
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
      projectFilter={props.projectFilter}
      viewSwitch={props.viewSwitch}
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
