/**
 * The list header's controls between its gutters, as measured: Me / Workers
 * (74px), Tasks / Routines (145px), New, the list menu and hide the week
 * (92px), and their gaps.
 */
export const LIST_HEADER_WIDTH = 324;
/** The list column's least width: its header between 20px gutters, and room for rows. */
export const MIN_LIST_WIDTH = 420;
/**
 * The week pane's least width: its header's full row as measured, the
 * longest month and year (114px) and `<< < Today > >> ...` (220px) with their
 * gap, between 20px gutters, and its divider; 387px, rounded up.
 */
export const MIN_WEEK_WIDTH = 400;

/**
 * The planner's own width from which the list sits left of the week: the
 * narrowest list beside the narrowest week, so neither header is cut and the
 * planner never scrolls sideways. The page and the right panel share it.
 */
export const WIDE_PLANNER_MIN_WIDTH = MIN_LIST_WIDTH + MIN_WEEK_WIDTH;

/** List left and week right at or above the threshold, stacked below it. */
export function plannerIsWide(width: number): boolean {
  return width >= WIDE_PLANNER_MIN_WIDTH;
}
