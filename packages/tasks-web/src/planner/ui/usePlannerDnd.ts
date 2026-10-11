import { useRef, useState } from "react";
import {
  defaultDropAnimation,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DropAnimation,
  type Over,
} from "@dnd-kit/core";
import type { TaskAutomationListItem, TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import type { AutomationAnchor } from "../data/automationStore.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import type { PlannerStore } from "../data/plannerStore.ts";
import {
  calendarDropTime,
  dropReturnsToSource,
  planListDrop,
  planScheduleDrop,
  queueDropTarget,
  type DragSource,
  type DropPlan,
  type DropTarget,
} from "../logic/dndPlanning.ts";
import type { ListDropIndicator } from "./TaskList.tsx";
import type { CalendarDropIndicator } from "./WeekCalendar.tsx";
import type { QueueDropIndicator, WeekSelection } from "./WeekQueue.tsx";

export type ActiveDrag =
  | { readonly kind: "task"; readonly task: PlannerTask }
  | { readonly kind: "entry"; readonly entry: TaskScheduleEntry; readonly count: number }
  | { readonly kind: "automation"; readonly automation: TaskAutomationListItem };

export interface DropIndicators {
  readonly list: ListDropIndicator | null;
  /** Between automations; `taskId` is the automation's id. */
  readonly automation: ListDropIndicator | null;
  readonly queue: QueueDropIndicator | null;
  readonly calendar: CalendarDropIndicator | null;
}

const NO_INDICATORS: DropIndicators = { list: null, automation: null, queue: null, calendar: null };

/** An automation only reorders among automations; it never lands on a day. */
type Source = DragSource | { readonly kind: "automation"; readonly automationId: string };
type Target =
  | DropTarget
  | { readonly kind: "automation-item"; readonly automationId: string }
  | { readonly kind: "automation-bottom" };
type Plan =
  | DropPlan
  | {
      readonly kind: "reorder-automation";
      readonly automationId: string;
      readonly anchor: AutomationAnchor;
    };

function clientY(event: Event | null): number | null {
  if (!event) return null;
  if ("clientY" in event && typeof event.clientY === "number") return event.clientY;
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent)
    return event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? null;
  return null;
}

/**
 * The planner's one DndContext (wande's list and week queue hooks together):
 * list rows reorder and drop onto days; entries move between days and onto
 * calendar times, as a block when selected. Decisions are in `dndPlanning.ts`.
 */
export function usePlannerDnd(input: {
  readonly store: PlannerStore;
  readonly tasks: ReadonlyMap<string, PlannerTask>;
  readonly days: ReadonlyMap<string, readonly TaskScheduleEntry[]>;
  /** The visible list's order; null in the archive view, which does not reorder. */
  readonly listIds: readonly string[] | null;
  /** The automations' order when the list shows them. */
  readonly automations: readonly TaskAutomationListItem[] | null;
  readonly onReorderAutomation: (automationId: string, anchor: AutomationAnchor) => void;
  readonly allowBottomDrop: boolean;
  readonly selection: WeekSelection;
  readonly onBlockMoved: () => void;
  readonly slotHeight: number;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [indicators, setIndicators] = useState<DropIndicators>(NO_INDICATORS);
  // Read by DragOverlay in the render that ends the drag, so set it in onDragEnd.
  const [dropAnimation, setDropAnimation] = useState<DropAnimation | null>(defaultDropAnimation);
  const drag = useRef<{
    source: Source;
    startY: number;
    grabOffsetY: number;
    pointerY: number | null;
    stopTracking: () => void;
  } | null>(null);

  const entryIdsByDate = () =>
    new Map([...input.days].map(([date, entries]) => [date, entries.map((entry) => entry.id)]));

  const sourceOf = (activeItem: Active): Source | null => {
    const data = activeItem.data.current as
      | { type?: string; taskId?: string; entryId?: string; date?: string; automationId?: string }
      | undefined;
    if (data?.type === "task" && data.taskId) return { kind: "task", taskId: data.taskId };
    if (data?.type === "automation" && data.automationId)
      return { kind: "automation", automationId: data.automationId };
    if (data?.type === "entry" && data.entryId && data.date) {
      const { selection, days } = input;
      const ids =
        selection.active && selection.ids.has(data.entryId)
          ? [...days.keys()]
              .sort()
              .flatMap((date) => (days.get(date) ?? []).map((entry) => entry.id))
              .filter((id) => selection.ids.has(id))
          : [data.entryId];
      return { kind: "entry", entryId: data.entryId, date: data.date, ids };
    }
    return null;
  };

  const targetOf = (over: Over | null, deltaY: number): Target | null => {
    const data = over?.data.current as
      | { type?: string; taskId?: string; entryId?: string; date?: string; automationId?: string }
      | undefined;
    if (!over || !data) return null;
    switch (data.type) {
      case "automation-item":
        return data.automationId
          ? { kind: "automation-item", automationId: data.automationId }
          : null;
      case "automation-bottom":
        return { kind: "automation-bottom" };
      case "task-list-item":
        return data.taskId ? { kind: "list-item", taskId: data.taskId } : null;
      case "list-bottom":
        return { kind: "list-bottom" };
      case "queue-column": {
        const current = drag.current;
        if (!data.date || !current) return null;
        // The cards' live boxes: dnd-kit measures droppables once per drag,
        // and the drop line moves the cards below it while it shows.
        const cards = [
          ...document.querySelectorAll(`[data-queue-date="${data.date}"] [data-entry-id]`),
        ].map((node) => {
          const box = node.getBoundingClientRect();
          return { id: node.getAttribute("data-entry-id") ?? "", top: box.top, height: box.height };
        });
        return queueDropTarget(data.date, current.pointerY ?? current.startY + deltaY, cards);
      }
      case "calendar-day": {
        const current = drag.current;
        if (!data.date || !current) return null;
        // dnd-kit's rects are not plain viewport coordinates inside the
        // scrolled (and auto-scrolling) calendar; read the column itself.
        const column = document
          .querySelector(`[data-calendar-day="${data.date}"]`)
          ?.getBoundingClientRect();
        return {
          kind: "calendar-day",
          date: data.date,
          startTime: calendarDropTime({
            pointerY: current.pointerY ?? current.startY + deltaY,
            grabOffsetY: current.grabOffsetY,
            columnTop: column?.top ?? over.rect.top,
            columnHeight: column?.height ?? over.rect.height,
            slotHeight: input.slotHeight,
          }),
        };
      }
      default:
        return null;
    }
  };

  const plan = (source: Source, target: Target | null): Plan | null => {
    if (!target) return null;
    if (
      source.kind === "automation" ||
      target.kind === "automation-item" ||
      target.kind === "automation-bottom"
    ) {
      if (source.kind !== "automation" || input.automations === null) return null;
      if (target.kind !== "automation-item" && target.kind !== "automation-bottom") return null;
      // The same rules as the task list: above a row, or last at the bottom.
      const planned = planListDrop(
        input.automations.map((automation) => automation.id),
        source.automationId,
        target.kind === "automation-item"
          ? { kind: "list-item", taskId: target.automationId }
          : { kind: "list-bottom" },
        true,
      );
      if (planned?.kind !== "reorder") return null;
      return {
        kind: "reorder-automation",
        automationId: source.automationId,
        anchor: {
          ...(planned.beforeTaskId ? { beforeAutomationId: planned.beforeTaskId } : {}),
          ...(planned.afterTaskId ? { afterAutomationId: planned.afterTaskId } : {}),
        },
      };
    }
    if (target.kind === "list-item" || target.kind === "list-bottom") {
      const { listIds, allowBottomDrop } = input;
      if (source.kind !== "task" || listIds === null) return null;
      return planListDrop(listIds, source.taskId, target, allowBottomDrop);
    }
    return planScheduleDrop(source, target, entryIdsByDate());
  };

  const onDragStart = (event: DragStartEvent) => {
    setDropAnimation(defaultDropAnimation);
    const source = sourceOf(event.active);
    if (!source) return;
    const startY = clientY(event.activatorEvent) ?? 0;
    const card =
      source.kind === "entry" && String(event.active.id).startsWith("calendar-entry:")
        ? document.querySelector(`[data-calendar-day] [data-entry-id="${source.entryId}"]`)
        : null;
    const track = (moveEvent: Event) => {
      const y = clientY(moveEvent);
      if (y !== null && drag.current) drag.current.pointerY = y;
    };
    window.addEventListener("pointermove", track, { capture: true, passive: true });
    window.addEventListener("touchmove", track, { capture: true, passive: true });
    drag.current = {
      source,
      startY,
      grabOffsetY: card ? startY - card.getBoundingClientRect().top : 0,
      pointerY: null,
      stopTracking: () => {
        window.removeEventListener("pointermove", track, { capture: true });
        window.removeEventListener("touchmove", track, { capture: true });
      },
    };
    const { tasks, days } = input;
    if (source.kind === "automation") {
      const automation = input.automations?.find(({ id }) => id === source.automationId);
      if (automation) setActive({ kind: "automation", automation });
    } else if (source.kind === "task") {
      const task = tasks.get(source.taskId);
      if (task) setActive({ kind: "task", task });
    } else {
      const entry = days.get(source.date)?.find((candidate) => candidate.id === source.entryId);
      if (entry) setActive({ kind: "entry", entry, count: source.ids.length });
    }
  };

  const onDragMove = (event: DragMoveEvent) => {
    const current = drag.current;
    if (!current) return;
    const target = targetOf(event.over, event.delta.y);
    const planned = plan(current.source, target);
    let next: DropIndicators = NO_INDICATORS;
    if (planned && target) {
      if (target.kind === "automation-item")
        next = {
          ...NO_INDICATORS,
          automation: { taskId: target.automationId, position: "above" },
        };
      else if (
        target.kind === "automation-bottom" &&
        planned.kind === "reorder-automation" &&
        planned.anchor.afterAutomationId
      )
        next = {
          ...NO_INDICATORS,
          automation: { taskId: planned.anchor.afterAutomationId, position: "below" },
        };
      else if (target.kind === "list-item")
        next = { ...NO_INDICATORS, list: { taskId: target.taskId, position: "above" } };
      else if (target.kind === "list-bottom" && planned.kind === "reorder" && planned.afterTaskId)
        next = { ...NO_INDICATORS, list: { taskId: planned.afterTaskId, position: "below" } };
      else if (target.kind === "queue-entry")
        next = { ...NO_INDICATORS, queue: { date: target.date, beforeEntryId: target.entryId } };
      else if (target.kind === "queue-column")
        next = { ...NO_INDICATORS, queue: { date: target.date, beforeEntryId: null } };
      else if (target.kind === "calendar-day")
        next = { ...NO_INDICATORS, calendar: { date: target.date, startTime: target.startTime } };
    }
    setIndicators((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  };

  const reset = () => {
    drag.current?.stopTracking();
    drag.current = null;
    setActive(null);
    setIndicators(NO_INDICATORS);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const current = drag.current;
    if (!current) return;
    const planned = plan(current.source, targetOf(event.over, event.delta.y));
    if (!dropReturnsToSource(planned)) setDropAnimation(null);
    reset();
    if (!planned) return;
    const { store, onBlockMoved } = input;
    switch (planned.kind) {
      case "reorder-automation":
        input.onReorderAutomation(planned.automationId, planned.anchor);
        return;
      case "reorder":
        void store.reorder([planned.taskId], {
          ...(planned.beforeTaskId ? { beforeTaskId: planned.beforeTaskId } : {}),
          ...(planned.afterTaskId ? { afterTaskId: planned.afterTaskId } : {}),
        });
        return;
      case "add":
        void store.addEntries({
          taskIds: [planned.taskId as never],
          date: planned.date,
          ...(planned.placement ? { placement: planned.placement as never } : {}),
          ...(planned.startTime ? { startTime: planned.startTime } : {}),
        });
        return;
      case "move":
        void store.moveEntries({
          ids: planned.ids as never,
          date: planned.date,
          ...(planned.placement ? { placement: planned.placement as never } : {}),
          ...(planned.startTime ? { startTime: planned.startTime } : {}),
        });
        if (planned.ids.length > 1) onBlockMoved();
        return;
    }
  };

  return {
    sensors,
    active,
    indicators,
    dropAnimation,
    handlers: { onDragStart, onDragMove, onDragOver: onDragMove, onDragEnd, onDragCancel: reset },
  };
}
