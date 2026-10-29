/**
 * The stacked layout's week: hidden, split, or full. The list never goes
 * below its header, so full leaves the list header under the week.
 */
export type StackedWeek = "hidden" | "split" | "full";

/**
 * Where a dragged week settles, from its height and `room`, the height it
 * can take: the pane under the week header minus the list header.
 */
export function snapStackedWeek(height: number, room: number): StackedWeek {
  const share = room > 0 ? height / room : 0;
  return share < 0.2 ? "hidden" : share < 0.6 ? "split" : "full";
}
