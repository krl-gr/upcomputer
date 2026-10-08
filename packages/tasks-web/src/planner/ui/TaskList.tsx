import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TaskAutomationListItem } from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { MenuItem, MenuSeparator } from "../../../../../apps/web/src/components/ui/menu.tsx";
import type { AutomationSnapshot } from "../data/automationStore.ts";
import type { PaginatedTasks } from "../data/hooks.ts";
import { plannerListShows } from "../data/plannerStore.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { scrollMemory, type PlannerAudience, type PlannerKind } from "../data/preferences.ts";
import type { ScheduleProgressCount } from "../logic/progress.ts";
import { AutomationRow } from "./AutomationRow.tsx";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, type MenuPoint } from "./PointMenu.tsx";
import { ConfirmDeleteDialog, MoveBelowDialog } from "./TaskDialogs.tsx";
import { TaskRow } from "./TaskRow.tsx";

/** The planner creates tasks for the person; under Agents they are not listed. */
export function noteCreatedInMine(audience: PlannerAudience, kind: PlannerKind) {
  if (audience === "agent" && kind === "task")
    toastManager.add({
      type: "info",
      title: "Created in Mine",
      description: "New tasks are yours. Hand one to agents from its window.",
    });
}

export interface ListDropIndicator {
  readonly taskId: string;
  readonly position: "above" | "below";
}

/**
 * The agents' routines: automations in the person's order, below the
 * routines under All and alone under Agents. A row drags among automations.
 */
function AutomationSection(props: {
  readonly snapshot: AutomationSnapshot;
  readonly heading: boolean;
  readonly indicator: ListDropIndicator | null;
}) {
  const { automations } = usePlanner();
  const [menu, setMenu] = useState<{
    automation: TaskAutomationListItem;
    point: MenuPoint;
  } | null>(null);
  const [deleting, setDeleting] = useState<TaskAutomationListItem | null>(null);
  const { setNodeRef: setBottomNode } = useDroppable({
    id: "automation-list-bottom",
    data: { type: "automation-bottom" },
  });
  const rows = props.snapshot.automations;
  return (
    <div className={props.heading ? "mt-2 border-t pt-2" : undefined}>
      {props.heading ? (
        <div className="px-5 py-1 text-xs font-medium text-muted-foreground">Automations</div>
      ) : null}
      {props.snapshot.error ? (
        <p className="px-6 py-2 text-sm text-destructive-foreground">{props.snapshot.error}</p>
      ) : null}
      {rows.length === 0 ? (
        props.heading ? null : (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {props.snapshot.status === "loading"
              ? "Loading…"
              : "No automations yet. An automation creates a task for agents on a schedule."}
          </p>
        )
      ) : (
        rows.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            indicator={props.indicator?.taskId === automation.id ? props.indicator.position : null}
            onMenu={(target, point) => setMenu({ automation: target, point })}
          />
        ))
      )}
      <div ref={setBottomNode} className="h-6" />
      <PointMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <MenuItem
              onClick={() =>
                void automations.setStatus(
                  menu.automation.id,
                  menu.automation.status === "enabled" ? "disabled" : "enabled",
                )
              }
            >
              {menu.automation.status === "enabled" ? "Disable" : "Enable"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleting(menu.automation)}>
              Delete automation
            </MenuItem>
          </>
        ) : null}
      </PointMenu>
      <ConfirmDeleteDialog
        open={deleting !== null}
        title="Delete automation"
        description={`"${deleting?.name ?? "This automation"}" stops creating tasks. The tasks it created stay in the table. This cannot be undone.`}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void automations.remove(deleting.id);
        }}
      />
    </div>
  );
}

/**
 * Wande's EntityList below its header (`ListHeader`): the rows in their
 * order, Load more and the bottom drop zone. The move and delete dialogs are
 * shared with the header's bulk controls.
 */
export function TaskList(props: {
  readonly tasks: PaginatedTasks;
  /** The ordered active list, for "Move below another task" from the archive view too. */
  readonly activeTasks: readonly PlannerTask[];
  readonly showArchived: boolean;
  /** The automations when the list shows them (Routines, Agents or All). */
  readonly automations: AutomationSnapshot | null;
  readonly automationIndicator: ListDropIndicator | null;
  readonly progress: ReadonlyMap<string, ScheduleProgressCount>;
  readonly queueDate: string | null;
  readonly selectMode: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectModeChange: (selectMode: boolean) => void;
  readonly onToggleSelected: (taskId: string) => void;
  readonly indicator: ListDropIndicator | null;
  /** Task ids for "Move below another task", or null while the dialog is closed. */
  readonly moving: readonly string[] | null;
  readonly onMovingChange: (ids: readonly string[] | null) => void;
  /** Task ids to confirm deleting, or null while the dialog is closed. */
  readonly deleting: readonly string[] | null;
  readonly onDeletingChange: (ids: readonly string[] | null) => void;
  readonly centered: boolean;
}) {
  const { store, audience, kind } = usePlanner();
  const noun = kind === "routine" ? "routine" : "task";
  // Routines × Agents: the agents' routines are automations, and nothing else shows.
  const automationsOnly = !plannerListShows(kind, audience).tasks;
  const { results, status } = props.tasks;
  const hasMore = status === "CanLoadMore" || status === "LoadingMore";
  const hiddenActive = !props.showArchived && hasMore;
  const lastId = results.at(-1)?.id ?? null;
  const [menu, setMenu] = useState<{ task: PlannerTask; point: MenuPoint } | null>(null);
  const { moving, deleting, onMovingChange: setMoving, onDeletingChange: setDeleting } = props;
  const { setNodeRef: setBottomNode } = useDroppable({
    id: "task-list-bottom",
    data: { type: "list-bottom" },
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const memory = scrollMemory(props.showArchived ? "archive" : "active");
    element.scrollTop = memory.read() ?? 0;
    return memory.follow(element);
  }, [props.showArchived]);

  const exitSelect = () => props.onSelectModeChange(false);
  const moveCandidates = useMemo(() => {
    if (!moving) return [];
    const source = moving.length === 1 && !props.selectMode ? props.activeTasks : results;
    return source.filter(
      (task) => !moving.includes(task.id) && !(hiddenActive && task.id === lastId),
    );
  }, [moving, props.activeTasks, props.selectMode, results, hiddenActive, lastId]);
  const createNear = async (task: PlannerTask, where: "above" | "below") => {
    const created = await store.createTask({
      title: kind === "routine" ? "New routine" : "New task",
      description: "",
      projectId: task.projectId,
      kind,
      ...(where === "above" ? { beforeTaskId: task.id } : { afterTaskId: task.id }),
    });
    if (created) noteCreatedInMine(audience, kind);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={props.centered ? "mx-auto w-full max-w-3xl py-2" : "w-full py-2"}>
          {automationsOnly ? null : status === "LoadingFirstPage" && results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {props.showArchived ? `No done or archived ${noun}s.` : `No active ${noun}s yet.`}
            </p>
          ) : (
            results.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                progress={props.progress.get(task.id)}
                selectMode={props.selectMode}
                selected={props.selectedIds.has(task.id)}
                queueDate={props.showArchived ? null : props.queueDate}
                indicator={props.indicator?.taskId === task.id ? props.indicator.position : null}
                onToggleSelected={props.onToggleSelected}
                onMenu={(target, point) => setMenu({ task: target, point })}
              />
            ))
          )}
          {hasMore ? (
            <div className="flex justify-center py-4">
              <Button
                size="sm"
                variant="outline"
                disabled={status === "LoadingMore"}
                onClick={props.tasks.loadMore}
              >
                {status === "LoadingMore" ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
          {!automationsOnly && (props.showArchived || !hiddenActive) ? (
            <div ref={setBottomNode} className="h-6" />
          ) : null}
          {props.automations && !props.showArchived ? (
            <AutomationSection
              snapshot={props.automations}
              heading={!automationsOnly}
              indicator={props.automationIndicator}
            />
          ) : null}
        </div>
      </div>

      <PointMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <MenuItem onClick={() => void createNear(menu.task, "above")}>
              Create {noun} above
            </MenuItem>
            <MenuItem
              disabled={hiddenActive && menu.task.id === lastId}
              onClick={() => void createNear(menu.task, "below")}
            >
              Create {noun} below
            </MenuItem>
            <MenuItem onClick={() => void store.reorder([menu.task.id], {})}>Move to top</MenuItem>
            <MenuItem onClick={() => setMoving([menu.task.id])}>Move below another {noun}</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleting([menu.task.id])}>
              Delete {noun}
            </MenuItem>
          </>
        ) : null}
      </PointMenu>

      <MoveBelowDialog
        open={moving !== null}
        movingCount={moving?.length ?? 0}
        candidates={moveCandidates}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onPick={(targetId) => {
          const ids = moving ?? [];
          if (props.selectMode) exitSelect();
          void store.reorder(ids, { afterTaskId: targetId });
        }}
      />
      <ConfirmDeleteDialog
        open={deleting !== null}
        title={deleting?.length === 1 ? "Delete task" : `Delete ${deleting?.length ?? 0} tasks`}
        description={
          deleting?.length === 1
            ? `"${results.find((task) => task.id === deleting[0])?.title ?? "This task"}" and its schedule are deleted. This cannot be undone.`
            : "The selected tasks and their schedules are deleted. This cannot be undone."
        }
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          const ids = deleting ?? [];
          if (props.selectMode) exitSelect();
          void store.deleteTasks(ids);
        }}
      />
    </div>
  );
}
