import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/*
 * Building blocks of the compact sidebar, shared with features that add a
 * section to it. Each full sidebar section becomes one pill of icon buttons,
 * on the sidebar's own surface and row colors, so every theme carries over.
 */

/** One sidebar section: a vertical rounded pill of icon buttons. */
export function CompactSidebarPill(props: {
  /** The section's name for assistive tech; the pill shows no title. */
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="flex shrink-0 flex-col items-center gap-0.5 rounded-full border border-sidebar-border bg-sidebar p-1 text-sidebar-foreground shadow-xs/5"
    >
      {props.children}
    </div>
  );
}

/**
 * An icon-only sidebar item: the item's name shows as a tooltip, and an active
 * item gets the full sidebar's selected row color. Like the sidebar's header
 * buttons it passes its props through, so it can render a menu trigger.
 */
export function CompactSidebarButton({
  label,
  tooltip = label,
  isActive = false,
  className,
  children,
  ...rest
}: {
  readonly label: string;
  readonly tooltip?: ReactNode;
  readonly isActive?: boolean;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label" | "size"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon-round"
            type="button"
            aria-label={label}
            aria-current={isActive ? "true" : undefined}
            isActive={isActive}
            {...rest}
            className={cn("shrink-0", className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
