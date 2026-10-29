import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import {
  SIDEBAR_ACTION_BUTTON,
  SIDEBAR_ICON_GAP,
  SIDEBAR_ROW_HEIGHT,
  SIDEBAR_ROW_INSET,
  SIDEBAR_ROW_TEXT,
} from "../sidebarMetrics/sidebarMetrics";

/**
 * The one-line row of the compact thread list, shared with the rows that must
 * look like it (a bot's row), so the two cannot drift apart. Each row adds its
 * own background state: `SIDEBAR_LIST_ROW_ACTIVE` or `SIDEBAR_LIST_ROW_REST`
 * unless it has a state of its own.
 */
export const SIDEBAR_LIST_ROW = cn(
  "group/sidebar-row relative flex w-full cursor-pointer items-center overflow-hidden rounded-md text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  SIDEBAR_ROW_HEIGHT,
  SIDEBAR_ICON_GAP,
  SIDEBAR_ROW_INSET,
);
export const SIDEBAR_LIST_ROW_ACTIVE = "bg-sidebar-row-active text-sidebar-foreground";
export const SIDEBAR_LIST_ROW_REST = "text-sidebar-foreground hover:bg-sidebar-row-hover";

/** The title: one tone for every row, as V1; statuses show only through the status label. */
export function sidebarListRowTitleClassName(isActive: boolean) {
  return cn(
    "min-w-0 flex-1 truncate text-sm",
    isActive ? "text-foreground" : cn(SIDEBAR_ROW_TEXT, "group-hover/sidebar-row:text-foreground"),
  );
}

// Hover, or keyboard focus on the row or on its button, swaps the time for the
// row's action button. Keyboard focus only: a clicked row keeps focus and would pin it.
const FADE_WHEN_REVEALED =
  "group-any-hover/sidebar-row:opacity-0 group-focus-visible/sidebar-row:opacity-0 group-has-[:focus-visible]/sidebar-row:opacity-0";
const MAKE_ROOM_WHEN_REVEALED =
  "group-any-hover/sidebar-row:not-has-[[data-fading-label]]:pr-6 group-focus-visible/sidebar-row:not-has-[[data-fading-label]]:pr-6 group-has-[:focus-visible]/sidebar-row:not-has-[[data-fading-label]]:pr-6";
const SHOW_WHEN_REVEALED =
  "pointer-events-none opacity-0 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100 group-focus-visible/sidebar-row:pointer-events-auto group-focus-visible/sidebar-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";

/** A label that fades under the action button; mark it `data-fading-label`. */
export function sidebarListRowFadingLabelClassName(pinned: boolean) {
  return pinned ? "opacity-0" : FADE_WHEN_REVEALED;
}

/** The action button at the row's end; `pinned` keeps it shown, as while its menu is open. */
export function sidebarListRowActionClassName(pinned: boolean) {
  return cn(
    "absolute inset-y-0 right-0 my-auto",
    SIDEBAR_ACTION_BUTTON,
    pinned ? "opacity-100" : SHOW_WHEN_REVEALED,
  );
}

/**
 * A second action button, among the row's end labels right before the action button: laid
 * out only while the action button shows, so the row's labels keep their room otherwise.
 */
export function sidebarListRowExtraActionClassName(pinned: boolean) {
  return cn(
    SIDEBAR_ACTION_BUTTON,
    !pinned &&
      "hidden group-any-hover/sidebar-row:inline-flex group-focus-visible/sidebar-row:inline-flex group-has-[:focus-visible]/sidebar-row:inline-flex",
  );
}

/**
 * The row's end: its labels (time, task runs) and the action button hover or
 * keyboard focus reveals over them. A fading label hides under the button; any
 * other label (task runs) stays, and the block moves left to make room.
 */
export function SidebarListRowEnd(props: {
  readonly pinned: boolean;
  readonly children: ReactNode;
  readonly action: ReactNode;
}) {
  return (
    <span className="relative ml-auto flex h-6 shrink-0 items-center">
      <span
        className={cn(
          "inline-flex items-center gap-1 text-sm tabular-nums text-secondary-label",
          props.pinned ? "pr-6" : MAKE_ROOM_WHEN_REVEALED,
        )}
      >
        {props.children}
      </span>
      {props.action}
    </span>
  );
}
