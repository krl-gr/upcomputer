import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultDropAnimation,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DropAnimation,
  type Over,
} from "@dnd-kit/core";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskAutomationListItem, TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";

import {
  buildComposerTaskDragData,
  dropComposerTask,
  endComposerTaskDrag,
  moveComposerTaskDrag,
  type ComposerTaskDragData,
} from "../../../../../apps/web/src/components/chat/composerTaskDrag.ts";
import type { AutomationAnchor } from "@t3tools/tasks-client/automations/automationStore";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { PlannerStore } from "@t3tools/tasks-client/planner/plannerStore";
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

export interface PlannerComposerDragContext {
  readonly environmentId: EnvironmentId;
}

interface RectBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function pointInsideBounds(
  point: { readonly x: number; readonly y: number },
  bounds: RectBounds,
): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function isPointClippedByScrollAncestors(
  node: HTMLElement | null,
  boundaryNode: HTMLElement | null,
  point: { readonly x: number; readonly y: number },
): boolean {
  if (!node || typeof getComputedStyle !== "function") return false;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      /auto|scroll|hidden|clip/.test(style.overflowX) ||
      /auto|scroll|hidden|clip/.test(style.overflowY)
    ) {
      if (!pointInsideBounds(point, parent.getBoundingClientRect())) return true;
    }
    if (parent === boundaryNode) break;
  }
  return false;
}

/**
 * Clips `pointerWithin` to the planner root and scroll containers so scrolled-off
 * week columns extending past the panel edge never hijack drops aimed at the composer.
 */
export function makePlannerCollisionDetection(
  getBoundary: () => { readonly node: HTMLElement | null; readonly rect: RectBounds } | null,
): CollisionDetection {
  return (args) => {
    const point = args.pointerCoordinates;
    const boundary = getBoundary();
    if (point && boundary && !pointInsideBounds(point, boundary.rect)) return [];
    const collisions = pointerWithin(args);
    if (!point || collisions.length === 0) return collisions;
    return collisions.filter((collision) => {
      const container = collision.data?.droppableContainer as
        | { readonly node?: { readonly current: HTMLElement | null } }
        | undefined;
      return !isPointClippedByScrollAncestors(
        container?.node?.current ?? null,
        boundary?.node ?? null,
        point,
      );
    });
  };
}

/** Resolves the unique tasks carried by a planner drag for quoting in a chat composer. */
export function resolvePlannerComposerTasks(
  source: Source,
  context: PlannerComposerDragContext,
  tasks: ReadonlyMap<string, PlannerTask>,
  days: ReadonlyMap<string, readonly TaskScheduleEntry[]>,
): readonly ComposerTaskDragData[] {
  if (source.kind === "automation") return [];
  const toPayload = (task: PlannerTask | undefined): ComposerTaskDragData | null =>
    task
      ? buildComposerTaskDragData({
          environmentId: context.environmentId,
          taskId: task.id,
          title: task.title,
          kind: task.kind,
        })
      : null;
  if (source.kind === "task") {
    const payload = toPayload(tasks.get(source.taskId));
    return payload ? [payload] : [];
  }
  const entryById = new Map<string, TaskScheduleEntry>();
  for (const entries of days.values()) {
    for (const entry of entries) entryById.set(entry.id, entry);
  }
  const seenTaskIds = new Set<string>();
  const result: ComposerTaskDragData[] = [];
  for (const entryId of source.ids) {
    const entry = entryById.get(entryId);
    if (!entry || seenTaskIds.has(entry.taskId)) continue;
    seenTaskIds.add(entry.taskId);
    const payload = toPayload(tasks.get(entry.taskId));
    if (payload) result.push(payload);
  }
  return result;
}

function clientPoint(event: Event | null): { readonly x: number; readonly y: number } | null {
  if (!event) return null;
  if (
    "clientX" in event &&
    typeof event.clientX === "number" &&
    "clientY" in event &&
    typeof event.clientY === "number"
  ) {
    return { x: event.clientX, y: event.clientY };
  }
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
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
  /** Clips planner droppable hit-testing so scrolled columns cannot swallow outside drops. */
  readonly plannerRoot?: HTMLElement | null;
  /** Set in the right panel so dragging a task or day entry onto the composer quotes it. */
  readonly composerDrag?: PlannerComposerDragContext | undefined;
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
    isPointerDrag: boolean;
    startX: number | null;
    startY: number;
    grabOffsetY: number;
    pointerX: number | null;
    pointerY: number | null;
    stopTracking: () => void;
  } | null>(null);

  const plannerRoot = input.plannerRoot ?? null;
  const collisionDetection = useCallback<CollisionDetection>(
    (args) =>
      makePlannerCollisionDetection(() =>
        plannerRoot ? { node: plannerRoot, rect: plannerRoot.getBoundingClientRect() } : null,
      )(args),
    [plannerRoot],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases window drag listeners and composer highlight if unmounted mid-drag
  useEffect(
    () => () => {
      drag.current?.stopTracking();
      drag.current = null;
      endComposerTaskDrag();
    },
    [],
  );

  const pointerOf = (
    current: NonNullable<typeof drag.current>,
    delta: { readonly x: number; readonly y: number },
  ): { readonly x: number; readonly y: number } | null => {
    if (!current.isPointerDrag) return null;
    if (current.pointerX !== null && current.pointerY !== null) {
      return { x: current.pointerX, y: current.pointerY };
    }
    if (current.startX !== null) {
      return { x: current.startX + delta.x, y: current.startY + delta.y };
    }
    return null;
  };

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
    const start = clientPoint(event.activatorEvent);
    const isPointerDrag = start !== null;
    const startY = start?.y ?? 0;
    const card =
      source.kind === "entry" && String(event.active.id).startsWith("calendar-entry:")
        ? document.querySelector(`[data-calendar-day] [data-entry-id="${source.entryId}"]`)
        : null;
    const track = (moveEvent: Event) => {
      const point = clientPoint(moveEvent);
      if (point && drag.current) {
        drag.current.pointerX = point.x;
        drag.current.pointerY = point.y;
      }
    };
    if (isPointerDrag) {
      window.addEventListener("pointermove", track, { capture: true, passive: true });
      window.addEventListener("touchmove", track, { capture: true, passive: true });
    }
    drag.current = {
      source,
      isPointerDrag,
      startX: start?.x ?? null,
      startY,
      grabOffsetY: card ? startY - card.getBoundingClientRect().top : 0,
      pointerX: null,
      pointerY: null,
      stopTracking: () => {
        if (!isPointerDrag) return;
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
    const point = pointerOf(current, event.delta);
    if (
      planned === null &&
      event.over === null &&
      input.composerDrag &&
      current.source.kind !== "automation" &&
      point
    ) {
      moveComposerTaskDrag(point);
    } else {
      endComposerTaskDrag();
    }
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
    endComposerTaskDrag();
    setActive(null);
    setIndicators(NO_INDICATORS);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const current = drag.current;
    if (!current) return;
    const planned = plan(current.source, targetOf(event.over, event.delta.y));
    const point = pointerOf(current, event.delta);
    if (
      planned === null &&
      event.over === null &&
      input.composerDrag &&
      current.source.kind !== "automation" &&
      point
    ) {
      const payloads = resolvePlannerComposerTasks(
        current.source,
        input.composerDrag,
        input.tasks,
        input.days,
      );
      if (payloads.length > 0 && dropComposerTask(point, payloads)) {
        setDropAnimation(null);
        reset();
        return;
      }
    }
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
    collisionDetection,
    active,
    indicators,
    dropAnimation,
    handlers: { onDragStart, onDragMove, onDragOver: onDragMove, onDragEnd, onDragCancel: reset },
  };
}
