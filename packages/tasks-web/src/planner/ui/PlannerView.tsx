import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useMediaQuery } from "../../../../../apps/web/src/hooks/useMediaQuery.ts";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../../../../apps/web/src/state/environments.ts";
import { usePlannerAvailability } from "../../environmentApi.ts";
import type { TasksStateTarget } from "../../state/tasksState.ts";
import { agentTriggerTags } from "../../ui/pageFilters.ts";
import type { ViewProjectFilter } from "../../ui/projectFilter.ts";
import type { TasksWebProject } from "../../ui/shared.ts";
import { WorkspaceViewLayout } from "../../ui/WorkspaceViewLayout.tsx";
import {
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
  useStoredPlannerAudience,
  useStoredPlannerEnvironment,
  type PlannerAudience,
} from "../data/preferences.ts";
import { addDays, dateRange, todayKey, viewStartFor } from "../logic/dates.ts";
import { usePlannerWindows, windowStoreFor } from "../windows/windowStore.ts";
import { AudienceSwitch } from "./AudienceSwitch.tsx";
import { EntryDragPreview, TaskDragPreview, type EntryCardHandlers } from "./EntryCard.tsx";
import type { EntryMenuTarget } from "./EntryMenu.tsx";
import { PlannerContext, type PlannerContextValue } from "./plannerContext.ts";
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
  readonly projects: readonly PlannerProject[];
  readonly projectIds: readonly string[] | null;
  readonly audience: PlannerAudience;
  readonly triggerTags: ReadonlySet<string>;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const store = plannerStoreFor(props.environmentId);
  const windows = windowStoreFor(props.environmentId);
  usePlannerLive(store);
  const snapshot = usePlannerSnapshot(store);
  const openWindows = usePlannerWindows(windows);
  const [preferences, updatePreferences] = usePlannerPreferences();
  const [viewState, updateViewState] = usePlannerViewState();
  const wide = useMediaQuery("lg");
  const [markedDate, setMarkedDate] = useState<string | null>(() => todayKey());
  const [showArchived, setShowArchived] = useState(false);
  const [listSelect, setListSelect] = useState<{ active: boolean; ids: ReadonlySet<string> }>({
    active: false,
    ids: new Set(),
  });
  const [weekSelection, setWeekSelection] = useState<WeekSelection>(NO_SELECTION);
  const [entryMenu, setEntryMenu] = useState<EntryMenuTarget | null>(null);

  useEffect(() => {
    store.setQuery({
      projectIds: props.projectIds as never,
      archiveVisible: showArchived,
      audience: props.audience,
    });
  }, [store, props.projectIds, showArchived, props.audience]);

  const active = useActiveTasksPaginated(store, snapshot);
  const archived = useArchivedTasksPaginated(store, snapshot);
  const list = showArchived ? archived : active;
  const dates = useMemo(
    () => dateRange(viewState.startDate, viewState.dayCount),
    [viewState.startDate, viewState.dayCount],
  );
  const days = useDayQueues(store, snapshot, dates);
  const progress = useQueueProgressByTaskIds(
    store,
    snapshot,
    list.results.map((task) => task.id),
    preferences.showProgress,
  );

  const exitWeekSelection = useCallback(() => setWeekSelection(NO_SELECTION), []);
  const dnd = usePlannerDnd({
    store,
    tasks: snapshot.view.tasks,
    days: snapshot.view.days,
    listIds: showArchived ? null : active.results.map((task) => task.id),
    allowBottomDrop: active.status === "Exhausted",
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
      windows,
      projects: props.projects,
      projectById: new Map(props.projects.map((project) => [project.id, project])),
      preferences,
      markdownCwd: undefined,
      audience: props.audience,
      triggerTags: props.triggerTags,
      openInTable: props.onOpenTask,
    }),
    [
      props.environmentId,
      store,
      windows,
      props.projects,
      preferences,
      props.audience,
      props.triggerTags,
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
  const weekContent = (
    <div className="flex h-full min-h-0 flex-col">
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
      />
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
          listWidth={viewState.listWidth}
          onListWidthChange={(listWidth) => updateViewState({ listWidth })}
          weekHidden={weekHidden}
          week={weekContent}
          list={
            <TaskList
              tasks={list}
              activeTasks={active.results}
              showArchived={showArchived}
              onToggleArchived={() => {
                setShowArchived((current) => !current);
                setListSelect({ active: false, ids: new Set() });
              }}
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
              canHideWeek={wide}
              weekHidden={weekHidden}
              onToggleWeek={() => updateViewState({ rightPaneHidden: !viewState.rightPaneHidden })}
              centered={weekHidden}
            />
          }
        />
        <DragOverlay>
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
        defaultProjectId={props.projectIds?.length === 1 ? props.projectIds[0]! : null}
      />
    </PlannerContext>
  );
}

function pickEnvironment(
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

function plannerProjectsOf(
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

function filterProjectIds(
  filter: ViewProjectFilter | null,
  environmentId: EnvironmentId | null,
): readonly string[] | null {
  return filter
    ? filter.projectRefs
        .filter((ref) => ref.environmentId === environmentId)
        .map((ref) => ref.projectId)
    : null;
}

function Notice(props: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{props.children}</p>
      {props.action}
    </div>
  );
}

/**
 * The Planner mode of /tasks: wande's tasks screen for one environment at a
 * time (its schedule order lives in that environment's database).
 */
export function PlannerView(props: {
  readonly viewSwitch: ReactNode;
  readonly projectSelect: ReactNode;
  readonly projects: readonly TasksWebProject[];
  readonly taskTargets: readonly TasksStateTarget[];
  readonly projectFilter: ViewProjectFilter | null;
  /** Every environment's agents; the planner suggests and marks their trigger tags. */
  readonly agents: ReadonlyArray<{
    readonly environmentId: string;
    readonly enabled: boolean;
    readonly startTags: ReadonlyArray<string>;
  }>;
  readonly onShowTable: () => void;
  /** Opens a task in the table, where its runs are listed. */
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
  readonly onNavigateBack: () => void;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentLabel = (id: string) =>
    environments.find((environment) => environment.environmentId === id)?.label ?? id;
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
  // The filter's identity changes only with the choice (usePagesProjectFilter).
  const projectIds = useMemo(
    () => filterProjectIds(props.projectFilter, environmentId),
    [props.projectFilter, environmentId],
  );
  const availability = usePlannerAvailability(environmentId);
  const [audience, setAudience] = useStoredPlannerAudience();
  const triggerTags = useMemo(
    () => agentTriggerTags(props.agents.filter((agent) => agent.environmentId === environmentId)),
    [props.agents, environmentId],
  );
  const { onOpenTask } = props;
  const openTask = useCallback(
    (taskId: string) => {
      if (environmentId) onOpenTask(environmentId, taskId);
    },
    [environmentId, onOpenTask],
  );

  return (
    <WorkspaceViewLayout
      title="Tasks"
      navigateOnEscape={false}
      onNavigateBack={props.onNavigateBack}
      toolbar={
        <>
          {props.viewSwitch}
          <span className="min-w-0 flex-1" />
          {candidates.length > 1 && environmentId ? (
            <Select
              value={environmentId}
              onValueChange={(value) => {
                if (value) setStoredEnvironment(value);
              }}
            >
              <SelectTrigger className="w-44 shrink-0" size="sm" aria-label="Environment">
                <SelectValue>{environmentLabel(environmentId)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {candidates.map((target) => (
                  <SelectItem key={target.environmentId} value={target.environmentId}>
                    {environmentLabel(target.environmentId)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          <AudienceSwitch value={audience} onChange={setAudience} />
          {props.projectSelect}
        </>
      }
    >
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
        <div className="relative min-h-0 flex-1">
          <PlannerBody
            key={environmentId}
            environmentId={environmentId}
            projects={plannerProjects}
            projectIds={projectIds}
            audience={audience}
            triggerTags={triggerTags}
            onOpenTask={openTask}
          />
        </div>
      )}
    </WorkspaceViewLayout>
  );
}
