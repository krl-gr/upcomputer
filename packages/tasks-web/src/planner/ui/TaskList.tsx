import { useGT } from "gt-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { MenuItem, MenuSeparator } from "../../../../../apps/web/src/components/ui/menu.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { ListEmptyState } from "../../ui/ListEmptyState.tsx";
import type { PaginatedTasks } from "../data/hooks.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { scrollMemory } from "../data/preferences.ts";
import type { ScheduleProgressCount } from "../logic/progress.ts";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, type MenuPoint } from "./PointMenu.tsx";
import { ConfirmDeleteDialog, MoveBelowDialog } from "./TaskDialogs.tsx";
import { TaskRow } from "./TaskRow.tsx";
import { LIST_CLASS, LIST_SCROLL_CLASS } from "./rowShell.ts";

export interface ListDropIndicator {
  readonly taskId: string;
  readonly position: "above" | "below";
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
  const gt = useGT();
  const { store, kind } = usePlanner();
  const routine = kind === "routine";
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
    await store.createTask({
      title: routine ? gt("New routine") : gt("New task"),
      description: "",
      projectId: task.projectId,
      kind,
      ...(where === "above" ? { beforeTaskId: task.id } : { afterTaskId: task.id }),
    });
  };

  // Blank, no text: the planner's own "Loading the planner…" comes just before
  // and the first page within a moment, so a second loading text would flash.
  const deletingTitle =
    deleting?.length === 1 ? results.find((task) => task.id === deleting[0])?.title : undefined;
  const firstPageLoading = status === "LoadingFirstPage" && results.length === 0;
  const empty = !firstPageLoading && results.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className={LIST_SCROLL_CLASS}>
        <div
          className={cn(
            props.centered ? `mx-auto max-w-3xl ${LIST_CLASS}` : LIST_CLASS,
            // The empty list's note sits in the middle of the pane.
            empty && "flex h-full flex-col",
          )}
        >
          {firstPageLoading ? null : empty ? (
            props.showArchived ? (
              <ListEmptyState
                title={
                  routine ? gt("No done or archived routines") : gt("No done or archived tasks")
                }
              />
            ) : routine ? (
              <ListEmptyState
                title={gt("No routines yet")}
                hint={gt("Click + to add a habit or chore that repeats on a schedule.")}
              />
            ) : (
              <ListEmptyState
                title={gt("No tasks yet")}
                hint={gt("Click + to add one, or ask any thread to plan the work for you.")}
              />
            )
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
                {status === "LoadingMore" ? gt("Loading…") : gt("Load more")}
              </Button>
            </div>
          ) : null}
          {props.showArchived || !hiddenActive ? <div ref={setBottomNode} className="h-6" /> : null}
        </div>
      </div>

      <PointMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <MenuItem onClick={() => void createNear(menu.task, "above")}>
              {routine ? gt("Create routine above") : gt("Create task above")}
            </MenuItem>
            <MenuItem
              disabled={hiddenActive && menu.task.id === lastId}
              onClick={() => void createNear(menu.task, "below")}
            >
              {routine ? gt("Create routine below") : gt("Create task below")}
            </MenuItem>
            <MenuItem onClick={() => void store.reorder([menu.task.id], {})}>
              {gt("Move to top")}
            </MenuItem>
            <MenuItem onClick={() => setMoving([menu.task.id])}>
              {routine ? gt("Move below another routine") : gt("Move below another task")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleting([menu.task.id])}>
              {routine ? gt("Delete routine") : gt("Delete task")}
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
        title={
          deleting?.length === 1
            ? gt("Delete task")
            : gt("{count, plural, one {Delete # task} other {Delete # tasks}}", {
                count: deleting?.length ?? 0,
              })
        }
        description={
          deleting?.length === 1
            ? deletingTitle !== undefined
              ? gt('"{title}" and its schedule are deleted. This cannot be undone.', {
                  title: deletingTitle,
                })
              : gt("This task and its schedule are deleted. This cannot be undone.")
            : gt("The selected tasks and their schedules are deleted. This cannot be undone.")
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
