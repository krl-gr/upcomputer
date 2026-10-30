/**
 * The planner list's frame, shared by the person rows (`TaskRow`) and the
 * agents' task cards, so both lists look the same.
 */

/** The list's scroller and its column: no side padding, 8px above and below the rows. */
export const LIST_SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both";
export const LIST_CLASS = "w-full py-2";

/** A row: inset 8px from the list's sides, 12px padding, a rounded hover background. */
export const ROW_CLASS = "mx-2 min-w-0 rounded-xl px-3 py-3 transition-colors";
export const ROW_HOVER_CLASS = "hover:bg-accent/60";
export const ROW_DRAGGING_CLASS = "opacity-50";

/** The row's title type. */
export const ROW_TITLE_CLASS = "w-full break-words text-sm font-medium text-foreground";

/** The chips under the title: 8px below it, 4px apart, wrapping. */
export const ROW_CHIPS_CLASS = "-ml-1 mt-2 flex min-w-0 flex-wrap items-center gap-1";

/**
 * A label chip with the geometry of the row's `xs` buttons and select
 * triggers: their height, padding and text, 8px corners, a plain 1px border.
 */
export const ROW_LABEL_CHIP_CLASS =
  "inline-flex h-7 min-w-0 max-w-40 items-center rounded-[var(--control-radius)] border border-border px-[calc(--spacing(2)-1px)] text-sm text-muted-foreground sm:h-6 sm:text-xs";
