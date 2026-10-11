/**
 * What a drop means, decided without React or dnd-kit: the planner's drag
 * handlers translate dnd-kit events into a source and a target, and these
 * functions turn them into one write. Behavior follows wande's list and week
 * queue drag hooks, except that a calendar drop leaves untimed entries where
 * the person put them (the server inserts by time).
 */
import type { PlannerPlacement } from "./placement.ts";
import { slotAtOffset, slotToTime } from "./time.ts";

export type DragSource =
  | { readonly kind: "task"; readonly taskId: string }
  /** `ids` is the selected block when the dragged entry is selected, else just the entry. */
  | {
      readonly kind: "entry";
      readonly entryId: string;
      readonly date: string;
      readonly ids: readonly string[];
    };

export type DropTarget =
  | { readonly kind: "list-item"; readonly taskId: string }
  | { readonly kind: "list-bottom" }
  | { readonly kind: "queue-column"; readonly date: string }
  | { readonly kind: "queue-entry"; readonly entryId: string; readonly date: string }
  | { readonly kind: "calendar-day"; readonly date: string; readonly startTime: string };

export type DropPlan =
  | {
      readonly kind: "reorder";
      readonly taskId: string;
      readonly beforeTaskId?: string;
      readonly afterTaskId?: string;
    }
  | {
      readonly kind: "add";
      readonly taskId: string;
      readonly date: string;
      readonly placement?: PlannerPlacement;
      readonly startTime?: string;
    }
  | {
      readonly kind: "move";
      readonly ids: readonly string[];
      readonly date: string;
      readonly placement?: PlannerPlacement;
      readonly startTime?: string;
    };

/**
 * A list row dropped on another row goes above it; dropped on the bottom zone
 * it goes last. `allowBottom` is false while more rows are not loaded yet,
 * because "last loaded" is not "last".
 */
export function planListDrop(
  orderedIds: readonly string[],
  taskId: string,
  target: DropTarget,
  allowBottom: boolean,
): DropPlan | null {
  const index = orderedIds.indexOf(taskId);
  if (index < 0) return null;
  if (target.kind === "list-item") {
    if (target.taskId === taskId || orderedIds[index + 1] === target.taskId) return null;
    if (!orderedIds.includes(target.taskId)) return null;
    return { kind: "reorder", taskId, beforeTaskId: target.taskId };
  }
  if (target.kind === "list-bottom") {
    const last = orderedIds.at(-1);
    if (!allowBottom || last === undefined || last === taskId) return null;
    return { kind: "reorder", taskId, afterTaskId: last };
  }
  return null;
}

/**
 * A task or entries dropped on the week: a queue column appends, a queue entry
 * inserts above it, a calendar day schedules at the slot's time.
 */
export function planScheduleDrop(
  source: DragSource,
  target: DropTarget,
  entryIdsByDate: ReadonlyMap<string, readonly string[]>,
): DropPlan | null {
  if (source.kind === "task") {
    switch (target.kind) {
      case "queue-column":
        return { kind: "add", taskId: source.taskId, date: target.date };
      case "queue-entry":
        return {
          kind: "add",
          taskId: source.taskId,
          date: target.date,
          placement: { before: target.entryId },
        };
      case "calendar-day":
        return {
          kind: "add",
          taskId: source.taskId,
          date: target.date,
          startTime: target.startTime,
        };
      default:
        return null;
    }
  }
  switch (target.kind) {
    case "calendar-day":
      return { kind: "move", ids: source.ids, date: target.date, startTime: target.startTime };
    case "queue-column": {
      const onDate = entryIdsByDate.get(target.date) ?? [];
      if (source.ids.length === 1 && onDate.at(-1) === source.entryId) return null;
      return { kind: "move", ids: source.ids, date: target.date, placement: { at: "bottom" } };
    }
    case "queue-entry": {
      if (source.ids.includes(target.entryId)) return null;
      const onDate = entryIdsByDate.get(target.date) ?? [];
      const at = onDate.indexOf(source.entryId);
      // Only an entry already on this date can be just above the target.
      if (source.ids.length === 1 && at >= 0 && onDate[at + 1] === target.entryId) return null;
      return {
        kind: "move",
        ids: source.ids,
        date: target.date,
        placement: { before: target.entryId },
      };
    }
    default:
      return null;
  }
}

/**
 * Where a drop on a day column lands: above the first card whose middle is
 * below the pointer, else last. The header, the padding and the gaps between
 * cards count too, so the first and the last place are as easy to hit as any.
 */
export function queueDropTarget(
  date: string,
  pointerY: number,
  cards: ReadonlyArray<{ readonly id: string; readonly top: number; readonly height: number }>,
): DropTarget {
  const before = cards.find((card) => pointerY < card.top + card.height / 2);
  return before
    ? { kind: "queue-entry", entryId: before.id, date }
    : { kind: "queue-column", date };
}

/**
 * The start time for a calendar drop. `grabOffsetY` is where the pointer held
 * the dragged card, so the card's top, not the pointer, lands on the slot.
 */
export function calendarDropTime(input: {
  readonly pointerY: number;
  readonly grabOffsetY: number;
  readonly columnTop: number;
  readonly columnHeight: number;
  readonly slotHeight: number;
}): string {
  return slotToTime(
    slotAtOffset(
      input.pointerY - input.grabOffsetY - input.columnTop,
      input.columnHeight,
      input.slotHeight,
    ),
  );
}
