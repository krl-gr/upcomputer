import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import { observeResize } from "../../../../../apps/web/src/lib/observeResize.ts";
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
  useActiveTasksPaginated,
  useArchivedTasksPaginated,
  useDayQueues,
  usePlannerLive,
  usePlannerSnapshot,
  useQueueProgressByTaskIds,
} from "../data/hooks.ts";
import {
  usePlannerPreferences,
  usePlannerViewState,
  useStoredPlannerEnvironment,
  useStoredPlannerKind,
  type PlannerKind,
} from "../data/preferences.ts";
import { addDays, dateRange, todayKey, viewStartFor } from "../logic/dates.ts";
import { plannerIsWide } from "../logic/plannerWidth.ts";
import { weekRangeOf } from "../logic/progress.ts";
import { usePlannerWindows, windowStoreFor } from "../windows/windowStore.ts";
import { EntryDragPreview, TaskDragPreview, type EntryCardHandlers } from "./EntryCard.tsx";
import type { EntryMenuTarget } from "./EntryMenu.tsx";
import { PlannerContext, type PlannerContextValue } from "./plannerContext.ts";
import { ListHeader, type PlannerEnvironmentOption } from "./ListHeader.tsx";
import { PlannerLayout } from "./PlannerLayout.tsx";
import { isInboxRoot, type PlannerProject } from "./ProjectChip.tsx";
import { TaskList } from "./TaskList.tsx";
import { PlannerWindows } from "./TaskWindows.tsx";
import { usePlannerDnd } from "./usePlannerDnd.ts";
import { WeekCalendar } from "./WeekCalendar.tsx";
import { WeekHeader } from "./WeekHeader.tsx";
import { WeekQueue, type WeekSelection } from "./WeekQueue.tsx";

const NO_SELECTION: WeekSelection = { active: false, ids: new Set() };

function PlannerBody(props: {
  readonly environmentId: EnvironmentId;
  readonly panel: boolean;
  /** List left and week right: the planner's own width, measured by `PlannerView`. */
  readonly wide: boolean;
  readonly projects: readonly PlannerProject[];
  readonly viewSwitch: ReactNode;
  readonly environments: readonly PlannerEnvironmentOption[];
  readonly onEnvironmentChange: (environmentId: string) => void;
  readonly kind: PlannerKind;
  readonly onKindChange: (kind: PlannerKind) => void;
  readonly triggerTags: ReadonlySet<string>;
  readonly agents: readonly HandOffAgent[];
  readonly onOpenTask: (taskId: string) => void;
}) {
  const store = plannerStoreFor(props.environmentId);
  const automationStore = automationStoreFor(props.environmentId);
  const windows = windowStoreFor(props.environmentId, props.panel ? "panel" : "page");
  usePlannerLive(store);
  const snapshot = usePlannerSnapshot(store);
  const openWindows = usePlannerWindows(windows);
  const [preferences, updatePreferences] = usePlannerPreferences();
  const [viewState, updateViewState] = usePlannerViewState();
  const { wide } = props;
  const [markedDate, setMarkedDate] = useState<string | null>(() => todayKey());
  const [showArchived, setShowArchived] = useState(false);
  const [listSelect, setListSelect] = useState<{ active: boolean; ids: ReadonlySet<string> }>({
    active: false,
    ids: new Set(),
  });
  const [moving, setMoving] = useState<readonly string[] | null>(null);
  const [deleting, setDeleting] = useState<readonly string[] | null>(null);
  // A selection belongs to one list: switching Tasks / Routines leaves select mode.
  const [selectionKind, setSelectionKind] = useState(props.kind);
  if (selectionKind !== props.kind) {
    setSelectionKind(props.kind);
    setListSelect({ active: false, ids: new Set() });
  }
  const [weekSelection, setWeekSelection] = useState<WeekSelection>(NO_SELECTION);
  const [entryMenu, setEntryMenu] = useState<EntryMenuTarget | null>(null);

  // The planner lists every project for now; rows keep their project chips.
  useEffect(() => {
    store.setQuery({
      projectIds: null,
      archiveVisible: showArchived,
      kind: props.kind,
    });
  }, [store, showArchived, props.kind]);

  const active = useActiveTasksPaginated(store, snapshot);
  const archived = useArchivedTasksPaginated(store, snapshot);
  const list = showArchived ? archived : active;
  const selectedTasks = useMemo(
    () => list.results.filter((task) => listSelect.ids.has(task.id)),
    [list.results, listSelect.ids],
  );
  const dates = useMemo(
    () => dateRange(viewState.startDate, viewState.dayCount),
    [viewState.startDate, viewState.dayCount],
  );
  const days = useDayQueues(store, snapshot, dates);
  // Routines count the current week only (wande), taken when the routines list shows.
  const progressWindow = useMemo(
    () => (props.kind === "routine" ? weekRangeOf(todayKey(), preferences.weekStartDay) : null),
    [props.kind, preferences.weekStartDay],
  );
  const progress = useQueueProgressByTaskIds(
    store,
    snapshot,
    list.results.map((task) => task.id),
    preferences.showProgress,
    progressWindow,
  );

  const exitWeekSelection = useCallback(() => setWeekSelection(NO_SELECTION), []);
  const dnd = usePlannerDnd({
    store,
    tasks: snapshot.view.tasks,
    days: snapshot.view.days,
    listIds: showArchived ? null : active.results.map((task) => task.id),
    allowBottomDrop: active.status === "Exhausted",
    automations: null,
    onReorderAutomation: () => undefined,
    selection: weekSelection,
    onBlockMoved: exitWeekSelection,
    slotHeight: preferences.slotHeight,
  });

  const handlers = useMemo<EntryCardHandlers>(
    () => ({
      onToggleStatus: (entry: TaskScheduleEntry) =>
        void store.updateEntry({
          id: entry.id,
          status: entry.status === "open" ? "done" : "open",
        }),
      onMenu: (entry, point) => setEntryMenu({ entry, point }),
      onOpen: (entry) => windows.openDetail(entry.taskId),
      onToggleSelected: (entryId) =>
        setWeekSelection((current) => {
          const ids = new Set(current.ids);
          if (ids.has(entryId)) ids.delete(entryId);
          else ids.add(entryId);
          return { active: true, ids };
        }),
    }),
    [store, windows],
  );

  const context = useMemo<PlannerContextValue>(
    () => ({
      environmentId: props.environmentId,
      store,
      automations: automationStore,
      windows,
      projects: props.projects,
      projectById: new Map(props.projects.map((project) => [project.id, project])),
      preferences,
      kind: props.kind,
      triggerTags: props.triggerTags,
      agents: props.agents,
      openInTable: props.onOpenTask,
      openInPlanner: (taskId: string) => windows.openDetail(taskId),
    }),
    [
      props.environmentId,
      store,
      automationStore,
      windows,
      props.projects,
      preferences,
      props.kind,
      props.triggerTags,
      props.agents,
      props.onOpenTask,
    ],
  );

  const navigate = (to: "previous-week" | "previous-day" | "today" | "next-day" | "next-week") => {
    const steps = {
      "previous-week": -7,
      "previous-day": -1,
      "next-day": 1,
      "next-week": 7,
    } as const;
    updateViewState({
      startDate:
        to === "today"
          ? viewStartFor(todayKey(), viewState.dayCount, preferences.weekStartDay)
          : addDays(viewState.startDate, steps[to]),
    });
  };
  const selectedWeekIds = [...weekSelection.ids];
  const weekHeader = (
    <WeekHeader
      startDate={viewState.startDate}
      dayCount={viewState.dayCount}
      onNavigate={navigate}
      onGoToDate={(date) =>
        updateViewState({
          startDate: viewStartFor(date, viewState.dayCount, preferences.weekStartDay),
        })
      }
      onDayCountChange={(dayCount) => updateViewState({ dayCount })}
      onPreferencesChange={updatePreferences}
      selectionMode={weekSelection.active}
      selectedCount={weekSelection.ids.size}
      onSelectionModeChange={(activeMode) =>
        setWeekSelection(activeMode ? { active: true, ids: new Set() } : NO_SELECTION)
      }
      onMoveSelected={(date) => {
        void store.moveEntries({
          ids: selectedWeekIds as never,
          date,
          placement: { at: "bottom" },
        });
        exitWeekSelection();
      }}
      onCopySelected={(copyDates, at) => {
        void store.copyEntries({
          ids: selectedWeekIds as never,
          dates: copyDates as string[],
          placement: { at },
        });
        exitWeekSelection();
      }}
      onDeleteSelected={() => {
        void store.deleteEntries(selectedWeekIds);
        exitWeekSelection();
      }}
      titleBar={wide && !props.panel}
    />
  );
  const weekContent = (
    <div className="flex h-full min-h-0 flex-col">
      {snapshot.rangeError ? (
        <p className="border-b px-3 py-1.5 text-xs text-destructive-foreground">
          {snapshot.rangeError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {preferences.weekViewMode === "calendar" ? (
          <WeekCalendar
            days={days}
            tasks={snapshot.view.tasks}
            markedDate={markedDate}
            onMark={setMarkedDate}
            selection={weekSelection}
            handlers={handlers}
            indicator={dnd.indicators.calendar}
            entryMenu={entryMenu}
            onEntryMenuClose={() => setEntryMenu(null)}
          />
        ) : (
          <WeekQueue
            days={days}
            tasks={snapshot.view.tasks}
            markedDate={markedDate}
            onMark={setMarkedDate}
            selection={weekSelection}
            handlers={handlers}
            indicator={dnd.indicators.queue}
            entryMenu={entryMenu}
            onEntryMenuClose={() => setEntryMenu(null)}
          />
        )}
      </div>
    </div>
  );

  const weekHidden = wide && viewState.rightPaneHidden;
  return (
    <PlannerContext value={context}>
      <DndContext sensors={dnd.sensors} collisionDetection={pointerWithin} {...dnd.handlers}>
        <PlannerLayout
          wide={wide}
          titleBar={!props.panel}
          listWidth={viewState.listWidth}
          onListWidthChange={(listWidth) => updateViewState({ listWidth })}
          weekHidden={weekHidden}
          weekHeader={weekHeader}
          week={weekContent}
          listHeader={
            <ListHeader
              viewSwitch={props.viewSwitch}
              onKindChange={props.onKindChange}
              environments={props.environments}
              onEnvironmentChange={props.onEnvironmentChange}
              showArchived={showArchived}
              onToggleArchived={() => {
                setShowArchived((current) => !current);
                setListSelect({ active: false, ids: new Set() });
              }}
              selectMode={listSelect.active}
              selected={selectedTasks}
              queueDate={markedDate}
              onSelectModeChange={(activeMode) =>
                setListSelect({ active: activeMode, ids: new Set() })
              }
              onMoveUnder={() => setMoving(selectedTasks.map((task) => task.id))}
              onDelete={() => setDeleting(selectedTasks.map((task) => task.id))}
              canHideWeek={wide}
              weekHidden={weekHidden}
              onToggleWeek={() => updateViewState({ rightPaneHidden: !viewState.rightPaneHidden })}
              titleBar={!props.panel}
            />
          }
          list={
            <TaskList
              tasks={list}
              activeTasks={active.results}
              showArchived={showArchived}
              progress={progress}
              queueDate={markedDate}
              selectMode={listSelect.active}
              selectedIds={listSelect.ids}
              onSelectModeChange={(activeMode) =>
                setListSelect({ active: activeMode, ids: new Set() })
              }
              onToggleSelected={(taskId) =>
                setListSelect((current) => {
                  const ids = new Set(current.ids);
                  if (ids.has(taskId)) ids.delete(taskId);
                  else ids.add(taskId);
                  return { active: true, ids };
                })
              }
              indicator={dnd.indicators.list}
              moving={moving}
              onMovingChange={setMoving}
              deleting={deleting}
              onDeletingChange={setDeleting}
              centered={weekHidden}
            />
          }
        />
        <DragOverlay dropAnimation={dnd.dropAnimation}>
          {dnd.active?.kind === "task" ? (
            <TaskDragPreview task={dnd.active.task} />
          ) : dnd.active?.kind === "entry" ? (
            <EntryDragPreview
              entry={dnd.active.entry}
              task={snapshot.view.tasks.get(dnd.active.entry.taskId)}
              count={dnd.active.count}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <PlannerWindows
        windows={openWindows}
        snapshot={snapshot}
        queueDate={markedDate}
        defaultProjectId={null}
        docked={props.panel}
      />
    </PlannerContext>
  );
}

/** The stored environment if it serves Tasks, else the primary one, else the first. */
export function pickEnvironment(
  candidates: readonly TasksStateTarget[],
  stored: string | null,
  primary: EnvironmentId | null,
): EnvironmentId | null {
  return (
    candidates.find((target) => target.environmentId === stored)?.environmentId ??
    candidates.find((target) => target.environmentId === primary)?.environmentId ??
    candidates[0]?.environmentId ??
    null
  );
}

export function plannerProjectsOf(
  projects: readonly TasksWebProject[],
  environmentId: EnvironmentId | null,
): readonly PlannerProject[] {
  return projects
    .filter((project) => project.environmentId === environmentId)
    .map((project) => ({
      id: project.id,
      name: project.name,
      favicon: project.favicon,
      inbox: isInboxRoot(project.workspaceRoot),
    }));
}

export function Notice(props: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{props.children}</p>
      {props.action}
    </div>
  );
}

/**
 * The Me side of /tasks, the person's tasks and routines: wande's tasks
 * screen for one environment at a time (its schedule order lives in that
 * environment's database). It has no page header: the list and week headers
 * are the title bar row.
 */
export function PlannerView(props: {
  readonly viewSwitch: ReactNode;
  readonly projects: readonly TasksWebProject[];
  readonly taskTargets: readonly TasksStateTarget[];
  /** Every environment's agents; the planner suggests and marks their trigger tags. */
  readonly agents: ReadonlyArray<HandOffAgent & { readonly environmentId: string }>;
  readonly onShowTable: () => void;
  /** Opens a task in the table, where its runs are listed. */
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onNavigateBack: () => void;
  /** The right panel's planner: the page's lists under the panel's tab bar, task windows inside it. */
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
  const plannerProjects = useMemo(
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
  const availability = usePlannerAvailability(environmentId);
  const [kind, setKind] = useStoredPlannerKind();
  const agents = useMemo(
    () => props.agents.filter((agent) => agent.environmentId === environmentId),
    [props.agents, environmentId],
  );
  const triggerTags = useMemo(() => agentTriggerTags(agents), [agents]);
  const { onOpenTask } = props;
  const openTask = useCallback(
    (taskId: string) => {
      if (environmentId) onOpenTask(environmentId, taskId);
    },
    [environmentId, onOpenTask],
  );

  const ready = environmentId !== null && availability === "enabled";
  // The layout follows the planner's own width, on the page and in the right
  // panel. The first measurement lands before paint, and the body waits for
  // it so the wrong layout never shows. This box fills the view whatever the
  // layout inside it, so switching cannot change the width that decided it.
  const [plannerElement, setPlannerElement] = useState<HTMLDivElement | null>(null);
  const [plannerWidth, setPlannerWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!plannerElement) return;
    setPlannerWidth(plannerElement.getBoundingClientRect().width);
    return observeResize(plannerElement, (entries) => {
      const entry = entries.at(-1);
      if (entry) setPlannerWidth(entry.contentRect.width);
    });
  }, [plannerElement]);
  return (
    <WorkspaceViewLayout
      variant={props.panel ? "panel" : "page"}
      title={props.panel ? "" : "Tasks"}
      // Until the planner shows, the page header keeps the title bar and the view switch.
      header={!ready}
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
      inset={false}
      onNavigateBack={props.onNavigateBack}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {environmentId === null ? (
          <Notice>No connected environment serves Tasks.</Notice>
        ) : availability === "loading" ? (
          <Notice>Loading the planner…</Notice>
        ) : availability === "unavailable" ? (
          <Notice
            action={
              <Button size="sm" variant="outline" onClick={props.onShowTable}>
                Open the table
              </Button>
            }
          >
            This environment runs an older server without the planner. The table shows its tasks.
          </Notice>
        ) : (
          <div ref={setPlannerElement} className="relative min-h-0 flex-1">
            {plannerWidth === null ? null : (
              <PlannerBody
                key={environmentId}
                environmentId={environmentId}
                panel={props.panel === true}
                wide={plannerIsWide(plannerWidth)}
                projects={plannerProjects}
                viewSwitch={props.viewSwitch}
                environments={environmentOptions}
                onEnvironmentChange={setStoredEnvironment}
                kind={kind}
                onKindChange={setKind}
                triggerTags={triggerTags}
                agents={agents}
                onOpenTask={openTask}
              />
            )}
          </div>
        )}
      </div>
    </WorkspaceViewLayout>
  );
}
