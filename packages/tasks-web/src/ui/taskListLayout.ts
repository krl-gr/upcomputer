/**
 * The agents' task list's least width for the table, as measured: the
 * header's inline filters fit in one row beside the view switches from about
 * 1130px, with the project select shrunk to its icon, and keep it readable from 1200px.
 */
export const TASK_TABLE_MIN_WIDTH = 1200;

/**
 * The table where its columns and the header's filters fit, cards below that
 * and always in the right panel. Before the list is measured the page shows
 * the table.
 */
export function taskListLayout(input: {
  readonly panel: boolean;
  readonly width: number | null;
}): "table" | "cards" {
  if (input.panel) return "cards";
  return input.width === null || input.width >= TASK_TABLE_MIN_WIDTH ? "table" : "cards";
}
