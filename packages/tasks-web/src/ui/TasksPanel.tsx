import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";

import { deriveProviderInstanceEntries } from "../../../../apps/web/src/providerInstances.ts";
import { useEnvironmentProviders } from "../../../../apps/web/src/state/environments.ts";
import { useRightPanelStore } from "../../../../apps/web/src/rightPanelStore.ts";
import { useHiddenRightPanelSurfaces } from "../../../../apps/web/src/product/rightPanelSurfaceVisibility.ts";

import {
  type PlannerKind,
  useStoredPlannerEnvironment,
  useStoredTableSection,
  useStoredTasksView,
} from "../planner/data/preferences.ts";
import { AutomationsView } from "../planner/ui/AutomationsView.tsx";
import { PlannerView } from "../planner/ui/PlannerView.tsx";
import { TasksViewSwitch } from "../planner/ui/TasksViewSwitch.tsx";
import { windowStoreFor } from "../planner/windows/windowStore.ts";
import { setPanelTaskKey, usePanelTaskKey } from "./openTask.ts";
import { taskKey } from "./shared.ts";
import { TableSectionSwitch } from "./TableSectionSwitch.tsx";
import { useTaskList } from "./useTaskList.ts";
import { TasksView } from "./TasksView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { type TaskFiltersScope, useTasksPageFilters } from "./pageFilters.ts";
import { usePagesProjectFilter } from "./usePagesProjectFilter.ts";
import { ProjectFilterSelect } from "./ProjectFilterSelect.tsx";

/**
 * The Tasks page as a right-panel surface beside a thread: the same Me or
 * Workers side (the page's last choice) with the page's filters, whatever the
 * thread's project, and a task opened inside the panel instead of the URL.
 */
export default function TasksPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  const [storedView, setStoredView] = useStoredTasksView();
  const [storedSection, setSection] = useStoredTableSection();
  const [, setPlannerEnvironment] = useStoredPlannerEnvironment();
  // A task opened here, from the table or the planner's "Open in table", or from the chat.
  const panelRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const selectedTaskKey = usePanelTaskKey(panelRef);
  const setSelectedTaskKey = useCallback(
    (key: string | undefined) => setPanelTaskKey(panelRef, key),
    [panelRef],
  );
  const view = selectedTaskKey === undefined ? storedView : "table";
  const section = selectedTaskKey === undefined ? storedSection : "tasks";
  const openTask = useCallback(
    (environmentId: EnvironmentId, taskId: string) =>
      setSelectedTaskKey(taskKey({ environmentId, id: taskId })),
    [setSelectedTaskKey],
  );
  const openInPlanner = useCallback(
    (environmentId: EnvironmentId, taskId: string) => {
      setPlannerEnvironment(environmentId);
      windowStoreFor(environmentId, "panel").openDetail(taskId);
      setSelectedTaskKey(undefined);
      setStoredView("planner");
    },
    [setPlannerEnvironment, setSelectedTaskKey, setStoredView],
  );

  if (view === "planner")
    return (
      <PlannerPanel
        viewSwitch={<TasksViewSwitch value={view} onChange={setStoredView} />}
        onShowTable={() => setStoredView("table")}
        onOpenTask={openTask}
      />
    );
  const viewSwitch = (
    <>
      <TasksViewSwitch value={view} onChange={setStoredView} />
      <TableSectionSwitch value={section} onChange={setSection} />
    </>
  );
  return section === "automations" ? (
    <AutomationsPanel
      viewSwitch={viewSwitch}
      onOpenTask={openTask}
      onOpenInPlanner={openInPlanner}
    />
  ) : (
    <TablePanel
      viewSwitch={viewSwitch}
      filePanelRef={panelRef}
      selectedTaskKey={selectedTaskKey}
      onSelectedTaskKeyChange={setSelectedTaskKey}
      onOpenInPlanner={openInPlanner}
    />
  );
}

/** Which list a launcher entry of its own opens: one view, with no switches. */
type TasksPanelEntry = "my-tasks" | "worker-tasks" | "automations" | "routines";

/** The surface ids `feature.tsx` gives My tasks and the combined Tasks tab. */
const MY_TASKS_SURFACE_ID = "tasks.mine";
const TASKS_SURFACE_ID = "tasks";

/**
 * One Tasks view as its own right-panel surface: the list without the
 * switches' header, its buttons floating over it. A task opened from the
 * person's lists or from an automation shows its details here, with Back.
 */
function TasksEntryPanel(
  props: ExperimentalWebRightPanelSurfaceProps & { readonly entry: TasksPanelEntry },
) {
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | undefined>(undefined);
  const openTask = useCallback(
    (environmentId: EnvironmentId, taskId: string) =>
      setSelectedTaskKey(taskKey({ environmentId, id: taskId })),
    [],
  );
  const [, setPlannerEnvironment] = useStoredPlannerEnvironment();
  const [, setStoredView] = useStoredTasksView();
  const { hidden } = useHiddenRightPanelSurfaces();
  const panelRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const { entry } = props;
  // The task's window opens in the panel's planner: here in My tasks or My routines, or in
  // the My tasks tab, which opens beside this one, from Worker tasks or Automations. With
  // My tasks switched off in Settings, the combined Tasks tab takes it, on its planner.
  const plannerSurfaceId =
    hidden.includes(MY_TASKS_SURFACE_ID) && !hidden.includes(TASKS_SURFACE_ID)
      ? TASKS_SURFACE_ID
      : MY_TASKS_SURFACE_ID;
  const openInPlanner = useCallback(
    (environmentId: EnvironmentId, taskId: string) => {
      setPlannerEnvironment(environmentId);
      windowStoreFor(environmentId, "panel").openDetail(taskId);
      setSelectedTaskKey(undefined);
      if (entry !== "worker-tasks" && entry !== "automations") return;
      if (plannerSurfaceId === TASKS_SURFACE_ID) {
        setPanelTaskKey(panelRef, undefined);
        setStoredView("planner");
      }
      useRightPanelStore.getState().openFeature(panelRef, plannerSurfaceId);
    },
    [entry, panelRef, plannerSurfaceId, setPlannerEnvironment, setStoredView],
  );
  if (props.entry === "worker-tasks" || selectedTaskKey !== undefined)
    return (
      <TablePanel
        viewSwitch={null}
        floatingControls
        filtersScope="panel.workers"
        filePanelRef={panelRef}
        selectedTaskKey={selectedTaskKey}
        onSelectedTaskKeyChange={setSelectedTaskKey}
        onOpenInPlanner={openInPlanner}
      />
    );
  if (props.entry === "automations")
    return (
      <AutomationsPanel
        viewSwitch={null}
        floatingControls
        onOpenTask={openTask}
        onOpenInPlanner={openInPlanner}
      />
    );
  return (
    <PlannerPanel
      viewSwitch={null}
      fixedKind={props.entry === "routines" ? "routine" : "task"}
      onOpenTask={openTask}
    />
  );
}

export function MyTasksPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  return <TasksEntryPanel {...props} entry="my-tasks" />;
}

export function WorkerTasksPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  return <TasksEntryPanel {...props} entry="worker-tasks" />;
}

export function AutomationsEntryPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  return <TasksEntryPanel {...props} entry="automations" />;
}

export function RoutinesPanel(props: ExperimentalWebRightPanelSurfaceProps) {
  return <TasksEntryPanel {...props} entry="routines" />;
}

function AutomationsPanel(props: {
  readonly viewSwitch: ReactNode;
  readonly floatingControls?: boolean;
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
}) {
  const data = useTasksWorkspaceData(false);
  return (
    <AutomationsView
      panel
      floatingControls={props.floatingControls === true}
      viewSwitch={props.viewSwitch}
      projects={data.projects}
      taskTargets={data.taskTargets}
      agents={data.agents.agents}
      onOpenTask={props.onOpenTask}
      onOpenInPlanner={props.onOpenInPlanner}
      onNavigateBack={() => undefined}
    />
  );
}

function PlannerPanel(props: {
  readonly viewSwitch: ReactNode;
  readonly fixedKind?: PlannerKind;
  readonly onShowTable?: () => void;
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
      {...(props.fixedKind === undefined ? {} : { fixedKind: props.fixedKind })}
      {...(props.onShowTable === undefined ? {} : { onShowTable: props.onShowTable })}
      onOpenTask={props.onOpenTask}
      onNavigateBack={() => undefined}
    />
  );
}

function TablePanel(props: {
  readonly viewSwitch: ReactNode;
  readonly floatingControls?: boolean;
  /** Filters of the panel entry's own, apart from the Tasks page's. */
  readonly filtersScope?: TaskFiltersScope;
  readonly filePanelRef: ScopedThreadRef;
  readonly selectedTaskKey: string | undefined;
  readonly onSelectedTaskKeyChange: (taskKey: string | undefined) => void;
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
}) {
  const navigate = useNavigate();
  const data = useTasksWorkspaceData(false);
  const providersByEnvironment = useEnvironmentProviders();
  const { projectFilter, projectGroups, setProjectKey } = usePagesProjectFilter(props.filtersScope);
  const [filters, setFilters] = useTasksPageFilters(props.filtersScope);
  const { pages, grouping } = useTaskList(data.taskTargets, projectFilter, filters);
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

  return (
    <TasksView
      layout="panel"
      floatingControls={props.floatingControls === true}
      filePanelRef={props.filePanelRef}
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
      grouping={grouping}
      agents={data.agents.agents}
      runs={data.agents.runs}
      providerEntriesByEnvironment={providerEntriesByEnvironment}
      status={pages.status}
      offlineEnvironmentIds={pages.offlineEnvironmentIds}
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
      onOpenInPlanner={props.onOpenInPlanner}
    />
  );
}
