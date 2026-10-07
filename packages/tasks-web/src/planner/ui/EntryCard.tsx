import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CheckIcon, CircleCheckIcon, CircleIcon, MoreVerticalIcon, SquareIcon } from "lucide-react";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import type { CalendarPosition } from "../logic/calendarLayout.ts";
import { entryTimingLabel, minutesToPixels, resizedDuration } from "../logic/time.ts";
import { IconAction } from "./IconAction.tsx";
import { usePlanner } from "./plannerContext.ts";
import { pointBelow, type MenuPoint } from "./PointMenu.tsx";
import { isFinished } from "./TaskRow.tsx";

export interface EntryCardHandlers {
  readonly onToggleStatus: (entry: TaskScheduleEntry) => void;
  readonly onMenu: (entry: TaskScheduleEntry, point: MenuPoint) => void;
  readonly onOpen: (entry: TaskScheduleEntry) => void;
  readonly onToggleSelected: (entryId: string) => void;
}

/** Drag data of an entry card; `ids` is filled in by the drag hook from the selection. */
export interface EntryDragData {
  readonly type: "entry";
  readonly entryId: string;
  readonly date: string;
}

const handled = (entry: TaskScheduleEntry) => entry.status !== "open";

/**
 * The card's look: wande's two card styles without project colors. "modern"
 * has a stripe and mutes a handled entry; "classic" strikes it through. A
 * done or archived task is struck through in both (its entries show the
 * task's own state, doc 5.3).
 */
function EntryBody(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly compact?: boolean;
  readonly trailing?: ReactNode;
}) {
  const { preferences } = usePlanner();
  const timing = entryTimingLabel(props.entry);
  const taskFinished = props.task ? isFinished(props.task) : false;
  const muted = handled(props.entry) || taskFinished;
  return (
    <>
      {preferences.cardStyle === "modern" ? (
        <span
          className={cn(
            "absolute top-1 bottom-1 left-1 w-1 rounded-full",
            muted ? "bg-muted-foreground/30" : "bg-primary/60",
          )}
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 items-start gap-1",
          preferences.cardStyle === "modern" && "pl-2",
        )}
      >
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "break-words text-xs font-medium leading-tight",
              props.compact && "truncate",
              muted ? "text-muted-foreground" : "text-foreground",
              (taskFinished || (preferences.cardStyle === "classic" && handled(props.entry))) &&
                "line-through",
            )}
          >
            {props.task?.title ?? "Loading…"}
          </div>
          {timing && !props.compact ? (
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{timing}</div>
          ) : null}
        </div>
        {props.trailing}
      </div>
    </>
  );
}

function EntryButtons(props: {
  readonly entry: TaskScheduleEntry;
  readonly selectMode: boolean;
  readonly selected: boolean;
  readonly handlers: EntryCardHandlers;
}) {
  const { entry, handlers } = props;
  if (props.selectMode)
    return (
      <IconAction
        label={props.selected ? "Deselect" : "Select"}
        size="icon-micro"
        pressed={props.selected}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onToggleSelected(entry.id);
        }}
      >
        {props.selected ? <CheckIcon /> : <SquareIcon />}
      </IconAction>
    );
  return (
    // Always visible on touch screens; on mouse screens they overlay the card on hover
    // instead of taking width from the title.
    <span className="flex shrink-0 items-center opacity-100 transition-opacity md:absolute md:top-0.5 md:right-0.5 md:rounded-md md:bg-card md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
      <IconAction
        label={entry.status === "done" ? "Mark as not done" : "Mark as done"}
        size="icon-micro"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onToggleStatus(entry);
        }}
      >
        {entry.status === "done" ? <CircleCheckIcon /> : <CircleIcon />}
      </IconAction>
      <IconAction
        label="More options"
        size="icon-micro"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onMenu(entry, pointBelow(event.currentTarget));
        }}
      >
        <MoreVerticalIcon />
      </IconAction>
    </span>
  );
}

/** Wande's QueueInstance: a card in a day column, dragged within and across days. */
export const QueueEntryCard = memo(function QueueEntryCard(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly selectMode: boolean;
  readonly selected: boolean;
  readonly handlers: EntryCardHandlers;
}) {
  const { entry, handlers } = props;
  const pending = entry.id.startsWith("pending-entry-");
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragNode,
  } = useDraggable({
    id: `queue-entry:${entry.id}`,
    data: { type: "entry", entryId: entry.id, date: entry.date } satisfies EntryDragData,
    disabled: pending || (props.selectMode && !props.selected),
  });
  const { setNodeRef: setDropNode } = useDroppable({
    id: `queue-drop-entry:${entry.id}`,
    data: { type: "queue-entry", entryId: entry.id, date: entry.date },
    disabled: pending,
  });
  const setNode = useCallback(
    (node: HTMLElement | null) => {
      setDragNode(node);
      setDropNode(node);
    },
    [setDragNode, setDropNode],
  );
  return (
    <div
      ref={setNode}
      {...attributes}
      {...listeners}
      data-entry-id={entry.id}
      className={cn(
        "group relative rounded-md border bg-card px-2 py-1.5 shadow-xs/5",
        isDragging && "opacity-40",
        props.selectMode && !props.selected && "opacity-50",
        props.selectMode && !props.selected ? "cursor-not-allowed" : "cursor-grab",
      )}
      onDoubleClick={() => {
        if (!props.selectMode) handlers.onOpen(entry);
      }}
      onContextMenu={(event: MouseEvent) => {
        if (props.selectMode) return;
        event.preventDefault();
        handlers.onMenu(entry, { x: event.clientX, y: event.clientY });
      }}
    >
      <EntryBody
        entry={entry}
        task={props.task}
        trailing={
          <EntryButtons
            entry={entry}
            selectMode={props.selectMode}
            selected={props.selected}
            handlers={handlers}
          />
        }
      />
    </div>
  );
});

/** Wande's calendar DraggableEntity: a timed card, moved to another time or resized. */
export const CalendarEntryCard = memo(function CalendarEntryCard(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly position: CalendarPosition;
  readonly duration: number;
  readonly selectMode: boolean;
  readonly selected: boolean;
  readonly handlers: EntryCardHandlers;
  readonly onResize: (entry: TaskScheduleEntry, durationMinutes: number) => void;
}) {
  const { entry, position, handlers } = props;
  const { preferences } = usePlanner();
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const resizing = previewHeight !== null;
  const pending = entry.id.startsWith("pending-entry-");
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragNode,
  } = useDraggable({
    id: `calendar-entry:${entry.id}`,
    data: { type: "entry", entryId: entry.id, date: entry.date } satisfies EntryDragData,
    disabled: pending || resizing || (props.selectMode && !props.selected),
  });
  const height = previewHeight ?? position.height;
  const style: CSSProperties = {
    top: position.top,
    height,
    left: `${position.leftPct}%`,
    width: `${position.widthPct}%`,
    zIndex: 10 + position.laneIndex,
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const startY = event.clientY;
    const startHeight = position.height;
    const startDuration = props.duration;
    let duration = startDuration;
    setPreviewHeight(startHeight);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      duration = resizedDuration(startHeight, moveEvent.clientY - startY, preferences.slotHeight);
      setPreviewHeight(minutesToPixels(duration, preferences.slotHeight));
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setPreviewHeight(null);
      if (endEvent.type === "pointerup" && duration !== startDuration)
        props.onResize(entry, duration);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  return (
    <div
      ref={setDragNode}
      {...attributes}
      {...listeners}
      data-entry-id={entry.id}
      style={style}
      className={cn(
        "group absolute overflow-hidden rounded-md border bg-card px-1.5 py-1 shadow-xs/5",
        isDragging && "opacity-40",
        props.selectMode && !props.selected && "opacity-50",
        props.selectMode && !props.selected ? "cursor-not-allowed" : "cursor-grab",
      )}
      onDoubleClick={(event) => {
        if (props.selectMode) return;
        event.stopPropagation();
        handlers.onOpen(entry);
      }}
      onContextMenu={(event) => {
        if (props.selectMode) return;
        event.preventDefault();
        handlers.onMenu(entry, { x: event.clientX, y: event.clientY });
      }}
    >
      <EntryBody
        entry={entry}
        task={props.task}
        compact={height < 28}
        trailing={
          <EntryButtons
            entry={entry}
            selectMode={props.selectMode}
            selected={props.selected}
            handlers={handlers}
          />
        }
      />
      {props.selectMode ? null : (
        <div
          className="absolute right-1 bottom-0 left-1 h-2 cursor-ns-resize touch-none"
          role="separator"
          aria-label="Drag to change the duration"
          onPointerDown={startResize}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
});

/** What follows the pointer while dragging entries; a count badge for several. */
export function EntryDragPreview(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly count: number;
}) {
  return (
    <div className="relative w-40 rounded-md border bg-card px-2 py-1.5 shadow-lg">
      <EntryBody entry={props.entry} task={props.task} />
      {props.count > 1 ? (
        <span className="absolute -right-2 -bottom-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
          {props.count}
        </span>
      ) : null}
    </div>
  );
}

/** What follows the pointer while dragging a list row. */
export function TaskDragPreview(props: { readonly task: PlannerTask }) {
  return (
    <div className="w-64 rounded-xl border bg-card px-3 py-2 shadow-lg">
      <div className="truncate text-sm font-medium text-foreground">{props.task.title}</div>
    </div>
  );
}
