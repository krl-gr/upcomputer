import { memo, useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleIcon,
  ListPlusIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
} from "lucide-react";
import { PERSON_DONE_STATUS, PERSON_OPEN_STATUS } from "@t3tools/tasks-contracts/v1";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { TablePill } from "../../ui/TablePill.tsx";
import type { PlannerTask } from "../data/pendingOps.ts";
import { progressLabel, type ScheduleProgressCount } from "../logic/progress.ts";
import { titleEditResult } from "../logic/titleEdit.ts";
import { IconAction } from "./IconAction.tsx";
import { ProjectChip } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { pointBelow, type MenuPoint } from "./PointMenu.tsx";
import { RunSummary } from "./RunSummary.tsx";

export function isFinished(task: PlannerTask) {
  return task.archivedAt !== null || task.status === PERSON_DONE_STATUS;
}

/** The caret nearest a viewport point, or null when the browser cannot tell. */
function caretRangeAt(x: number, y: number): Range | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  return document.caretRangeFromPoint(x, y);
}

/**
 * Wande's TitleArea: the title, edited in place; Enter saves, Escape cancels.
 * Editing turns the same element plain-text editable, so the row keeps its
 * size and the caret lands where the person clicked.
 */
function TitleArea(props: {
  readonly title: string;
  readonly done: boolean;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly onSave: (title: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clickPoint = useRef<{ x: number; y: number } | null>(null);
  const active = useRef(false);
  // The text is owned here, not by React, so the browser's edits never fight a
  // React text node; a remote rename waits until the edit ends.
  useLayoutEffect(() => {
    if (!props.editing && ref.current) ref.current.textContent = props.title;
  }, [props.editing, props.title]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!props.editing || !element) return;
    active.current = true;
    element.focus({ preventScroll: true });
    const point = clickPoint.current;
    const range = point ? caretRangeAt(point.x, point.y) : null;
    const caret = document.createRange();
    if (range && element.contains(range.startContainer)) {
      caret.setStart(range.startContainer, range.startOffset);
    } else {
      caret.selectNodeContents(element);
      caret.collapse(false);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
  }, [props.editing]);
  const finish = () => {
    active.current = false;
    props.onEditingChange(false);
  };
  const save = () => {
    if (!active.current) return;
    const result = titleEditResult(ref.current?.textContent ?? "", props.title);
    if (result.kind === "empty") {
      toastManager.add({ type: "warning", title: "Title cannot be empty" });
      return;
    }
    if (result.kind === "save") props.onSave(result.title);
    finish();
  };
  return (
    <div
      ref={ref}
      className={cn(
        "min-h-[1lh] w-full cursor-text whitespace-pre-wrap break-words text-sm font-medium text-foreground outline-none",
        props.done && "text-muted-foreground line-through",
      )}
      {...(props.editing
        ? {
            contentEditable: "plaintext-only" as const,
            role: "textbox",
            "aria-label": "Task title",
          }
        : {})}
      onClick={(event) => {
        event.stopPropagation();
        if (props.editing) return;
        clickPoint.current = { x: event.clientX, y: event.clientY };
        props.onEditingChange(true);
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (!props.editing) return;
        event.stopPropagation();
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish();
        }
      }}
      onPointerDown={(event) => {
        if (props.editing) event.stopPropagation();
      }}
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
          "mx-2 min-w-0 rounded-xl px-3 py-3 transition-colors",
          editing ? "cursor-text" : "cursor-grab",
          isDragging ? "opacity-50" : "hover:bg-accent/60",
        )}
        data-task-id={task.id}
        onContextMenu={openMenu}
      >
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
          {props.selectMode ? (
            <IconAction
              label={props.selected ? "Deselect" : "Select"}
              variant="outline"
              pressed={props.selected}
              onClick={() => props.onToggleSelected(task.id)}
            >
              {props.selected ? <CircleCheckIcon /> : <CircleIcon />}
            </IconAction>
          ) : (
            <>
              <IconAction
                label="Open details"
                variant="outline"
                onClick={() => windows.openDetail(task.id)}
              >
                <Maximize2Icon />
              </IconAction>
              <IconAction
                label="More actions"
                variant="outline"
                onClick={(event) => props.onMenu(task, pointBelow(event.currentTarget))}
              >
                <MoreHorizontalIcon />
              </IconAction>
            </>
          )}
        </div>
      </div>
      {props.indicator === "below" ? <div className="mx-4 my-1 h-px bg-border" /> : null}
    </>
  );
});
