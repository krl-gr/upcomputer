import {
  memo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useDraggable, type DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleIcon,
  MoreHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import type { CalendarPosition } from "../logic/calendarLayout.ts";
import { entryTimingLabel, minutesToPixels, resizedDuration } from "../logic/time.ts";
import { IconAction } from "./IconAction.tsx";
import { usePlanner } from "./plannerContext.ts";
import { pointBelow, type MenuPoint } from "./PointMenu.tsx";
import { projectStripeClassName, projectTintClassName } from "./projectStripe.ts";
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
 * A click or Enter on the card opens its task; dnd-kit swallows the click that
 * ends a drag. Space still starts a keyboard drag, and Enter drops one.
 */
function openHandlers(open: (() => void) | null, listeners: DraggableSyntheticListeners) {
  return {
    onClick: () => open?.(),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (open && event.key === "Enter" && event.target === event.currentTarget) {
        event.preventDefault();
        open();
        return;
      }
      listeners?.onKeyDown?.(event);
    },
  };
}

/**
 * A card's surface and its hover actions' backing. "modern" tints the card
 * with its project's color, neutral when handled or finished, and has no
 * border; "classic" keeps the bordered white card.
 */
function useEntrySurface(entry: TaskScheduleEntry, task: PlannerTask | undefined) {
  const { preferences, projectById } = usePlanner();
  if (preferences.cardStyle === "classic")
    return { card: "border bg-card shadow-xs/5", actions: "bg-card" };
  const muted = !task || handled(entry) || isFinished(task);
  const tint = projectTintClassName(muted ? null : (projectById.get(task.projectId) ?? null));
  return { card: tint, actions: tint };
}

/**
 * The card's look: wande's two card styles. "modern" has a stripe in the
 * project's color and mutes a handled entry; "classic" strikes it through. A
 * done or archived task is struck through in both (its entries show the
 * task's own state, doc 5.3).
 */
function EntryBody(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly compact?: boolean;
  readonly trailing?: ReactNode;
}) {
  const { preferences, projectById } = usePlanner();
  const timing = entryTimingLabel(props.entry);
  const taskFinished = props.task ? isFinished(props.task) : false;
  const muted = handled(props.entry) || taskFinished;
  return (
    <>
      {preferences.cardStyle === "modern" ? (
        <span
          className={cn(
            "absolute top-1 bottom-1 left-1 w-1 rounded-full",
            muted
              ? "bg-muted-foreground/30"
              : projectStripeClassName(
                  (props.task && projectById.get(props.task.projectId)) ?? null,
                ),
          )}
        />
      ) : null}
      <div
        className={cn(
          "relative flex min-w-0 items-center gap-1",
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
  /** The card's surface, so the actions hide the title they cover. */
  readonly surface: string;
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
    // Always visible on touch screens; on mouse screens they overlay the title's end on
    // hover instead of taking width from it. Centered on the text, not a tall block.
    <span
      className={cn(
        "flex shrink-0 items-center rounded-md opacity-100 transition-opacity md:absolute md:top-1/2 md:right-0 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        props.surface,
      )}
    >
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
        <MoreHorizontalIcon />
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
  const surface = useEntrySurface(entry, props.task);
  const pending = entry.id.startsWith("pending-entry-");
  // Its day column is the drop target; where in the column follows the pointer.
  const { attributes, listeners, isDragging, setNodeRef } = useDraggable({
    id: `queue-entry:${entry.id}`,
    data: { type: "entry", entryId: entry.id, date: entry.date } satisfies EntryDragData,
    disabled: pending || (props.selectMode && !props.selected),
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-entry-id={entry.id}
      className={cn(
        "group relative rounded-md px-2 py-1.5",
        surface.card,
        isDragging && "opacity-40",
        props.selectMode && !props.selected && "opacity-50",
        props.selectMode && !props.selected ? "cursor-not-allowed" : "cursor-grab",
      )}
      {...openHandlers(
        props.selectMode || isDragging ? null : () => handlers.onOpen(entry),
        listeners,
      )}
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
            surface={surface.actions}
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
  const surface = useEntrySurface(entry, props.task);
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
        "group absolute overflow-hidden rounded-md px-1.5 py-1",
        surface.card,
        isDragging && "opacity-40",
        props.selectMode && !props.selected && "opacity-50",
        props.selectMode && !props.selected ? "cursor-not-allowed" : "cursor-grab",
      )}
      {...openHandlers(
        props.selectMode || isDragging ? null : () => handlers.onOpen(entry),
        listeners,
      )}
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
            surface={surface.actions}
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
          // Pointer capture sends the click that ends a resize here; it must not open the card.
          onClick={(event) => event.stopPropagation()}
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
  const surface = useEntrySurface(props.entry, props.task);
  return (
    <div className={cn("relative w-40 rounded-md border px-2 py-1.5 shadow-lg", surface.actions)}>
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
