import { useMemo, type ReactNode } from "react";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../../../../apps/web/src/state/environments.ts";
import { usePlannerAvailability } from "../../environmentApi.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import { agentTriggerTags } from "../../ui/pageFilters.ts";
import type { HandOffAgent } from "../logic/handOff.ts";
import type { TasksWebProject } from "../../ui/shared.ts";
import { WorkspaceViewLayout } from "../../ui/WorkspaceViewLayout.tsx";
import {
  automationStoreFor,
  plannerStoreFor,
  useAutomations,
  usePlannerLive,
  usePlannerSnapshot,
} from "../data/hooks.ts";
import { usePlannerPreferences, useStoredPlannerEnvironment } from "../data/preferences.ts";
import { usePlannerWindows, windowStoreFor, type WindowStore } from "../windows/windowStore.ts";
import { AutomationList } from "./AutomationList.tsx";
import { AutomationDragPreview } from "./AutomationRow.tsx";
import { PlannerContext, type PlannerContextValue } from "./plannerContext.ts";
import { Notice, pickEnvironment, plannerProjectsOf } from "./PlannerView.tsx";
import type { PlannerProject } from "./ProjectChip.tsx";
import { PlannerWindows } from "./TaskWindows.tsx";
import {
  resolveTasksViewGate,
  tasksAccessPending,
  useTasksInitialWaitOver,
} from "./tasksViewGate.ts";
import { usePlannerDnd } from "./usePlannerDnd.ts";
import type { WeekSelection } from "./WeekQueue.tsx";

const NO_DAYS = new Map<string, readonly TaskScheduleEntry[]>();
const NO_SELECTION: WeekSelection = { active: false, ids: new Set() };

function AutomationsBody(props: {
  readonly environmentId: EnvironmentId;
  readonly panel: boolean;
  readonly windows: WindowStore;
  readonly projects: readonly PlannerProject[];
  readonly triggerTags: ReadonlySet<string>;
  readonly agents: readonly HandOffAgent[];
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
}) {
  const { environmentId, windows, onOpenTask, onOpenInPlanner } = props;
  const store = plannerStoreFor(environmentId);
  const automationStore = automationStoreFor(environmentId);
  // Task windows (an automation's tasks) read and follow the planner store.
  usePlannerLive(store);
  const snapshot = usePlannerSnapshot(store);
  const openWindows = usePlannerWindows(windows);
  const automations = useAutomations(automationStore);
  const [preferences] = usePlannerPreferences();
  const dnd = usePlannerDnd({
    store,
    tasks: snapshot.view.tasks,
    days: NO_DAYS,
    listIds: null,
    allowBottomDrop: false,
    automations: automations.automations,
    onReorderAutomation: (automationId, anchor) =>
      void automationStore.reorder(automationId, anchor),
    selection: NO_SELECTION,
    onBlockMoved: () => undefined,
    slotHeight: preferences.slotHeight,
  });
  const context = useMemo<PlannerContextValue>(
    () => ({
      environmentId,
      store,
      automations: automationStore,
      windows,
      projects: props.projects,
      projectById: new Map(props.projects.map((project) => [project.id, project])),
      preferences,
      kind: "task",
      triggerTags: props.triggerTags,
      agents: props.agents,
      openInTable: (taskId) => onOpenTask(environmentId, taskId),
      openInPlanner: (taskId) => onOpenInPlanner(environmentId, taskId),
    }),
    [
      environmentId,
      store,
      automationStore,
      windows,
      props.projects,
      preferences,
      props.triggerTags,
      props.agents,
      onOpenTask,
      onOpenInPlanner,
    ],
  );
  return (
    <PlannerContext value={context}>
      <DndContext sensors={dnd.sensors} collisionDetection={pointerWithin} {...dnd.handlers}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AutomationList snapshot={automations} indicator={dnd.indicators.automation} />
        </div>
        <DragOverlay dropAnimation={dnd.dropAnimation}>
          {dnd.active?.kind === "automation" ? (
            <AutomationDragPreview automation={dnd.active.automation} />
          ) : null}
        </DragOverlay>
      </DndContext>
      <PlannerWindows
        windows={openWindows}
        snapshot={snapshot}
        queueDate={null}
        defaultProjectId={null}
        docked={props.panel}
      />
    </PlannerContext>
  );
}

/**
 * The Agents side's Automations section: the automations of one environment
 * (the planner's choice), each creating agent tasks on a schedule. New
 * Automation, a double-click or a row's arrow opens the automation's window,
 * which also lists the tasks it created.
 */
export function AutomationsView(props: {
  readonly viewSwitch: ReactNode;
  readonly projects: readonly TasksWebProject[];
  readonly taskTargets: readonly TasksStateTarget[];
  readonly agents: ReadonlyArray<HandOffAgent & { readonly environmentId: string }>;
  /** Opens a task in the table, where its runs are listed. */
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  /** Opens a task's window in the planner, after it was taken back from agents. */
  readonly onOpenInPlanner: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onNavigateBack: () => void;
  readonly panel?: boolean;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [storedEnvironment, setStoredEnvironment] = useStoredPlannerEnvironment();
  const candidates = useMemo(
    () => props.taskTargets.filter((target) => target.access.canReadTasks),
    [props.taskTargets],
  );
  const environmentId = useMemo(
    () => pickEnvironment(candidates, storedEnvironment, primaryEnvironmentId),
    [candidates, storedEnvironment, primaryEnvironmentId],
  );
  const projects = useMemo(
    () => plannerProjectsOf(props.projects, environmentId),
    [props.projects, environmentId],
  );
  const environmentOptions = useMemo(
    () =>
      candidates.map((target) => ({
        id: target.environmentId,
        label:
          environments.find((environment) => environment.environmentId === target.environmentId)
            ?.label ?? target.environmentId,
      })),
    [candidates, environments],
  );
  const agents = useMemo(
    () => props.agents.filter((agent) => agent.environmentId === environmentId),
    [props.agents, environmentId],
  );
  const triggerTags = useMemo(() => agentTriggerTags(agents), [agents]);
  const availability = usePlannerAvailability(environmentId);
  const gate = resolveTasksViewGate({
    environmentId,
    availability,
    accessPending: tasksAccessPending(props.taskTargets),
    initialWaitOver: useTasksInitialWaitOver(),
  });
  const ready = environmentId !== null && availability === "enabled";
  const windows =
    environmentId === null
      ? null
      : windowStoreFor(environmentId, props.panel ? "automations-panel" : "automations-page");
  return (
    <WorkspaceViewLayout
      variant={props.panel ? "panel" : "page"}
      title={props.panel ? "" : "Tasks"}
      action={
        ready && windows
          ? { ariaLabel: "New automation", onClick: () => windows.openCreateAutomation() }
          : undefined
      }
      toolbar={
        <>
          {props.viewSwitch}
          <span className="min-w-0 flex-1" />
          {environmentOptions.length > 1 && environmentId ? (
            <Select
              value={environmentId}
              onValueChange={(value) => {
                if (value) setStoredEnvironment(value);
              }}
            >
              <SelectTrigger className="w-44 shrink-0" size="sm" aria-label="Environment">
                <SelectValue>
                  {environmentOptions.find((option) => option.id === environmentId)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {environmentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </>
      }
      navigateOnEscape={false}
      onNavigateBack={props.onNavigateBack}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {gate === "none" ? (
          <Notice>No connected environment serves Tasks.</Notice>
        ) : gate === "loading" ? (
          <Notice>Loading the automations…</Notice>
        ) : gate === "offline" || environmentId === null || windows === null ? (
          <Notice>
            The environment with Tasks is not reachable right now. Automations open when it
            connects.
          </Notice>
        ) : availability === "unavailable" ? (
          <Notice>This environment runs an older server without automations here.</Notice>
        ) : (
          <AutomationsBody
            key={environmentId}
            environmentId={environmentId}
            panel={props.panel === true}
            windows={windows}
            projects={projects}
            triggerTags={triggerTags}
            agents={agents}
            onOpenTask={props.onOpenTask}
            onOpenInPlanner={props.onOpenInPlanner}
          />
        )}
      </div>
    </WorkspaceViewLayout>
  );
}
