import { ChevronRightIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import {
  SIDEBAR_ACTION_BUTTON,
  SIDEBAR_DIM_TEXT,
  SIDEBAR_ROW_HEIGHT,
  SIDEBAR_ROW_INSET,
  SIDEBAR_ROW_INSET_END,
} from "../sidebarMetrics/sidebarMetrics";

/**
 * Header of a collapsible sidebar section (Projects, Threads): the title with
 * its chevron right after it, turned down while open, and an optional action
 * at the right. Everything but the action toggles the section; `accessory`
 * sits at the right of the toggle, for state the collapsed section still shows.
 */
export function SidebarSectionHeader(props: {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly accessory?: ReactNode;
  /** A `SidebarSectionHeaderAction`. */
  readonly action?: ReactNode;
  readonly testId?: string;
}) {
  const { title, open, onToggle, accessory, action, testId } = props;
  return (
    // The title starts where a row's icon does, and the action ends where a row's actions do.
    <div
      className={cn(
        "group/sidebar-section-header flex items-center gap-1",
        SIDEBAR_ROW_HEIGHT,
        SIDEBAR_ROW_INSET_END,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        data-testid={testId}
        onClick={onToggle}
        className={cn(
          "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left text-sm font-medium outline-none hover:text-sidebar-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          SIDEBAR_DIM_TEXT,
          SIDEBAR_ROW_INSET,
        )}
      >
        <span className="shrink-0">{title}</span>
        <ChevronRightIcon
          aria-hidden
          data-testid="sidebar-section-chevron"
          className={cn("size-3.5 shrink-0", open && "rotate-90")}
        />
        {accessory ? (
          <span className="ml-auto flex min-w-0 max-w-[50%] items-center gap-1.5 pl-2 text-xs">
            {accessory}
          </span>
        ) : null}
      </button>
      {action}
    </div>
  );
}

/**
 * Icon button in a section header, revealed while the header is hovered or
 * focused (always on touch). It never toggles the section.
 */
export function SidebarSectionHeaderAction(props: {
  readonly label: string;
  /** Defaults to `label`. */
  readonly tooltip?: string;
  readonly onClick: (event: ReactMouseEvent) => void;
  readonly children: ReactNode;
}) {
  const { label, tooltip = label, onClick, children } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              SIDEBAR_ACTION_BUTTON,
              "opacity-0 focus-visible:opacity-100 group-focus-within/sidebar-section-header:opacity-100 group-any-hover/sidebar-section-header:opacity-100 pointer-coarse:opacity-100",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
