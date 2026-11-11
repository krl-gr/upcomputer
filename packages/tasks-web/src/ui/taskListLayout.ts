/**
 * The agents' task list's least width for the table, as measured: the
 * header's inline filters fit in one row beside the view switches from about
 * 1130px, with the project select shrunk to its icon, and keep it readable from 1200px.
 */
export const TASK_TABLE_MIN_WIDTH = 1200;

/**
 * How far under its least width a table already shown stays. The table scrolls in the page,
 * so its scrollbar narrows the measured list, and the cards scroll in a box of their own;
 * without this slack a width just over the threshold flips the layouts forever. It exceeds
 * any scrollbar: ours is 6px, a classic Windows one 17px.
 */
export const TASK_TABLE_KEEP_SLACK = 24;

export type TaskListLayout = "table" | "cards";

/**
 * The page's list: the table where its columns and the header's filters fit,
 * cards below that. `shown` is the layout the width was measured in.
 */
export function taskListLayout(width: number, shown: TaskListLayout): TaskListLayout {
  const least =
    shown === "table" ? TASK_TABLE_MIN_WIDTH - TASK_TABLE_KEEP_SLACK : TASK_TABLE_MIN_WIDTH;
  return width >= least ? "table" : "cards";
}
