/**
 * The planner's own width from which the list sits left of the week. 768px is
 * the `lg` window breakpoint (1024px), where the Tasks page used to switch,
 * minus the left sidebar's default 256px, so the page switches at the same
 * window width as before. With the sidebar collapsed the planner is the whole
 * window and goes wide from 768px; the right panel follows the same rule.
 */
export const WIDE_PLANNER_MIN_WIDTH = 768;

/** List left and week right at or above the threshold, stacked below it. */
export function plannerIsWide(width: number): boolean {
  return width >= WIDE_PLANNER_MIN_WIDTH;
}
