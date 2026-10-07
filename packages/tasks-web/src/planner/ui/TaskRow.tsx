import { memo, useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  ListPlusIcon,
  MoreVerticalIcon,
} from "lucide-react";
import { PERSON_DONE_STATUS, PERSON_OPEN_STATUS } from "@t3tools/tasks-contracts/v1";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { TablePill } from "../../ui/TablePill.tsx";
import type { PlannerTask } from "../data/pendingOps.ts";
import { progressLabel, type ScheduleProgressCount } from "../logic/progress.ts";
import { IconAction } from "./IconAction.tsx";
import { ProjectChip } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { pointBelow, type MenuPoint } from "./PointMenu.tsx";
import { RunSummary } from "./RunSummary.tsx";

export function isFinished(task: PlannerTask) {
  return task.archivedAt !== null || task.status === PERSON_DONE_STATUS;
}

/** Wande's TitleArea: the title, edited in place; Enter saves, Escape cancels. */
function TitleArea(props: {
  readonly title: string;
  readonly done: boolean;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(props.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (props.editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [props.editing]);
  const save = () => {
    const title = value.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Title cannot be empty" });
      return;
    }
    if (title !== props.title) props.onSave(title);
    props.onEditingChange(false);
  };
  if (!props.editing)
    return (
      <div
        className={cn(
          "w-full cursor-text whitespace-pre-wrap break-words text-sm font-medium text-foreground",
          props.done && "text-muted-foreground line-through",
        )}
        onClick={(event) => {
          event.stopPropagation();
          setValue(props.title);
          props.onEditingChange(true);
        }}
      >
        {props.title}
      </div>
    );
  return (
    <textarea
      ref={ref}
      className="field-sizing-content w-full resize-none overflow-hidden bg-transparent p-0 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
      value={value}
      placeholder="Untitled"
      aria-label="Task title"
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={save}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setValue(props.title);
          props.onEditingChange(false);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

export interface TaskRowProps {
  readonly task: PlannerTask;
  readonly progress: ScheduleProgressCount | undefined;
  readonly selectMode: boolean;
  readonly selected: boolean;
  /** The day header the person marked; shows "Add to queue" in queue view. */
  readonly queueDate: string | null;
  readonly indicator: "above" | "below" | null;
  readonly onToggleSelected: (taskId: string) => void;
  readonly onMenu: (task: PlannerTask, point: MenuPoint) => void;
}

/** Wande's EntityItem: a list row that drags into the list order and onto days. */
export const TaskRow = memo(function TaskRow(props: TaskRowProps) {
  const { task } = props;
  const { store, windows, projects, preferences } = usePlanner();
  const [editing, setEditing] = useState(false);
  const finished = isFinished(task);
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragNode,
  } = useDraggable({
    id: `task-list-${task.id}`,
    data: { type: "task", taskId: task.id },
    disabled: editing,
  });
  const { setNodeRef: setDropNode } = useDroppable({
    id: `task-list-${task.id}`,
    data: { type: "task-list-item", taskId: task.id },
  });
  const setNode = useCallback(
    (node: HTMLElement | null) => {
      setDragNode(node);
      setDropNode(node);
    },
    [setDragNode, setDropNode],
  );
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    props.onMenu(task, { x: event.clientX, y: event.clientY });
  };
  const progress = progressLabel(props.progress);
  const statusLabel =
    task.status !== PERSON_OPEN_STATUS && task.status !== PERSON_DONE_STATUS ? task.status : null;
  return (
    <>
      {props.indicator === "above" ? <div className="mx-4 my-1 h-px bg-border" /> : null}
      <div
        ref={setNode}
        {...(editing ? {} : attributes)}
        {...(editing ? {} : listeners)}
        className={cn(
          "mx-2 flex min-w-0 items-start justify-between gap-2 rounded-xl px-3 py-3 transition-colors",
          editing ? "cursor-text" : "cursor-grab",
          isDragging ? "opacity-50" : "hover:bg-accent/60",
        )}
        data-task-id={task.id}
        onContextMenu={openMenu}
      >
        <div className="min-w-0 flex-1">
          <TitleArea
            title={task.title}
            done={finished}
            editing={editing}
            onEditingChange={setEditing}
            onSave={(title) => void store.updateTask(task.id, { title })}
          />
          <div className="-ml-1 mt-2 flex min-w-0 flex-wrap items-center gap-1">
            <ProjectChip
              projects={projects}
              value={task.projectId}
              onChange={(projectId) => {
                if (projectId) void store.updateTask(task.id, { projectId: projectId as never });
              }}
            />
            {finished ? (
              <IconAction
                label="Restore"
                variant="outline"
                onClick={() => void store.restore([task.id])}
              >
                <ArchiveRestoreIcon />
              </IconAction>
            ) : (
              <>
                <IconAction
                  label="Mark as done"
                  variant="outline"
                  onClick={() => void store.markDone([task.id])}
                >
                  <CircleCheckIcon />
                </IconAction>
                <IconAction
                  label="Archive"
                  variant="outline"
                  onClick={() => void store.archive([task.id])}
                >
                  <ArchiveIcon />
                </IconAction>
              </>
            )}
            {statusLabel ? <TablePill>{statusLabel}</TablePill> : null}
            <RunSummary task={task} />
            {props.queueDate && preferences.weekViewMode === "queue" ? (
              <IconAction
                label={`Add to queue for ${props.queueDate}`}
                variant="outline"
                onClick={() =>
                  void store.addEntries({ taskIds: [task.id as never], date: props.queueDate! })
                }
              >
                <ListPlusIcon />
              </IconAction>
            ) : null}
            <IconAction
              label={progress ? `Schedule (${progress})` : "Schedule"}
              variant="outline"
              size={preferences.showProgress && progress ? "xs" : "icon-xs"}
              onClick={() => windows.openDetail(task.id, "instances")}
            >
              <CalendarIcon />
              {preferences.showProgress && progress ? <span>{progress}</span> : null}
            </IconAction>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.selectMode ? (
            <IconAction
              label={props.selected ? "Deselect" : "Select"}
              pressed={props.selected}
              onClick={() => props.onToggleSelected(task.id)}
            >
              {props.selected ? <CircleCheckIcon /> : <CircleIcon />}
            </IconAction>
          ) : (
            <>
              <IconAction label="Open details" onClick={() => windows.openDetail(task.id)}>
                <ChevronRightIcon />
              </IconAction>
              <IconAction
                label="More actions"
                onClick={(event) => props.onMenu(task, pointBelow(event.currentTarget))}
              >
                <MoreVerticalIcon />
              </IconAction>
            </>
          )}
        </div>
      </div>
      {props.indicator === "below" ? <div className="mx-4 my-1 h-px bg-border" /> : null}
    </>
  );
});
