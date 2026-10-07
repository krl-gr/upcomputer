import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArchiveIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { MenuItem, MenuSeparator } from "../../../../../apps/web/src/components/ui/menu.tsx";
import type { PaginatedTasks } from "../data/hooks.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { scrollMemory } from "../data/preferences.ts";
import type { ScheduleProgressCount } from "../logic/progress.ts";
import { BulkActions } from "./BulkActions.tsx";
import { IconAction } from "./IconAction.tsx";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, type MenuPoint } from "./PointMenu.tsx";
import { ConfirmDeleteDialog, MoveBelowDialog } from "./TaskDialogs.tsx";
import { TaskRow } from "./TaskRow.tsx";

export interface ListDropIndicator {
  readonly taskId: string;
  readonly position: "above" | "below";
}

/**
 * Wande's EntityList: the header (New Task, Select, Archive, hide the week),
 * the rows in their order, Load more and the bottom drop zone.
 */
export function TaskList(props: {
  readonly tasks: PaginatedTasks;
  /** The ordered active list, for "Move below another task" from the archive view too. */
  readonly activeTasks: readonly PlannerTask[];
  readonly showArchived: boolean;
  readonly onToggleArchived: () => void;
  readonly progress: ReadonlyMap<string, ScheduleProgressCount>;
  readonly queueDate: string | null;
  readonly selectMode: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectModeChange: (selectMode: boolean) => void;
  readonly onToggleSelected: (taskId: string) => void;
  readonly indicator: ListDropIndicator | null;
  readonly canHideWeek: boolean;
  readonly weekHidden: boolean;
  readonly onToggleWeek: () => void;
  readonly centered: boolean;
}) {
  const { store, windows } = usePlanner();
  const { results, status } = props.tasks;
  const hasMore = status === "CanLoadMore" || status === "LoadingMore";
  const hiddenActive = !props.showArchived && hasMore;
  const lastId = results.at(-1)?.id ?? null;
  const [menu, setMenu] = useState<{ task: PlannerTask; point: MenuPoint } | null>(null);
  const [moving, setMoving] = useState<readonly string[] | null>(null);
  const [deleting, setDeleting] = useState<readonly string[] | null>(null);
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

  const selected = useMemo(
    () => results.filter((task) => props.selectedIds.has(task.id)),
    [results, props.selectedIds],
  );
  const exitSelect = () => props.onSelectModeChange(false);
  const moveCandidates = useMemo(() => {
    if (!moving) return [];
    const source = moving.length === 1 && !props.selectMode ? props.activeTasks : results;
    return source.filter(
      (task) => !moving.includes(task.id) && !(hiddenActive && task.id === lastId),
    );
  }, [moving, props.activeTasks, props.selectMode, results, hiddenActive, lastId]);
  const createNear = (task: PlannerTask, where: "above" | "below") =>
    void store.createTask({
      title: "New task",
      description: "",
      projectId: task.projectId,
      ...(where === "above" ? { beforeTaskId: task.id } : { afterTaskId: task.id }),
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        {props.selectMode ? (
          <BulkActions
            selected={selected}
            queueDate={props.queueDate}
            onExit={exitSelect}
            onMoveUnder={() => setMoving(selected.map((task) => task.id))}
            onDelete={() => setDeleting(selected.map((task) => task.id))}
          />
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => windows.openCreate()}>
              New Task
            </Button>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => props.onSelectModeChange(true)}>
                Select
              </Button>
              <IconAction
                label={props.showArchived ? "Show active tasks" : "Show done and archived tasks"}
                variant={props.showArchived ? "default" : "outline"}
                size="icon-sm"
                pressed={props.showArchived}
                onClick={props.onToggleArchived}
              >
                <ArchiveIcon />
              </IconAction>
              {props.canHideWeek ? (
                <IconAction
                  label={props.weekHidden ? "Show the week" : "Hide the week"}
                  variant="outline"
                  size="icon-sm"
                  onClick={props.onToggleWeek}
                >
                  {props.weekHidden ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
                </IconAction>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={props.centered ? "mx-auto w-full max-w-3xl py-2" : "w-full py-2"}>
          {status === "LoadingFirstPage" && results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {props.showArchived ? "No done or archived tasks." : "No active tasks yet."}
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
          {props.showArchived || !hiddenActive ? <div ref={setBottomNode} className="h-6" /> : null}
        </div>
      </div>

      <PointMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <MenuItem onClick={() => createNear(menu.task, "above")}>Create task above</MenuItem>
            <MenuItem
              disabled={hiddenActive && menu.task.id === lastId}
              onClick={() => createNear(menu.task, "below")}
            >
              Create task below
            </MenuItem>
            <MenuItem onClick={() => void store.reorder([menu.task.id], {})}>Move to top</MenuItem>
            <MenuItem onClick={() => setMoving([menu.task.id])}>Move below another task</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleting([menu.task.id])}>
              Delete task
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
