import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { Kbd } from "../ui/kbd";

export interface CompactUndoNoticeProps {
  /** What the pill says: "Archived", or "Archived 2". */
  readonly label: string;
  /** "⌘Z", or null when the command has no key. */
  readonly shortcut: string | null;
  readonly exiting: boolean;
  readonly onUndo: () => void;
}

// The footer pill's own motion: 180ms, a 6px rise on the way in, the same back out.
const MOTION =
  "transform-gpu transition-all duration-180 ease-drawer will-change-transform starting:translate-y-1.5 starting:opacity-0";

// Space between the notice and the first utility button, the footer's own gap.
const NOTICE_GAP_PX = 8;

/**
 * Floats its children over the column, their bottom edge one gap above the utility
 * buttons' resting place. Portaled to the sidebar's fixed container: the column itself
 * scrolls, clips and masks its content. Only the buttons' height is measured, so
 * nothing follows the scroll.
 */
function CompactNoticeLayer(props: { readonly children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the utility buttons' height, which only the DOM knows
  useLayoutEffect(() => {
    const footer = anchor?.closest<HTMLElement>('[data-sidebar="footer"]');
    const menu = footer?.querySelector<HTMLElement>(':scope > [data-sidebar="menu"]');
    if (!footer || !menu) return;
    const measure = () => {
      if (menu.offsetHeight === 0) return;
      const padding = Number.parseFloat(getComputedStyle(footer).paddingBottom) || 0;
      setBottom(menu.offsetHeight + padding + NOTICE_GAP_PX);
    };
    measure();
    return observeResize(menu, measure);
  }, [anchor]);
  const host =
    anchor?.closest('[data-slot="sidebar-container"]') ??
    anchor?.closest("[data-app-sidebar]") ??
    null;
  return (
    <>
      <span ref={setAnchor} hidden />
      {host && bottom !== null
        ? createPortal(
            <div
              data-sidebar-compact-notice=""
              style={{ bottom }}
              className="pointer-events-none absolute left-0 z-10 w-full px-(--sidebar-content-inset) *:pointer-events-auto"
            >
              {props.children}
            </div>,
            host,
          )
        : null}
    </>
  );
}

/**
 * The thread undo notice as the compact icon column shows it: the footer pill folded
 * into a two-line tile. CSS shows it only in the column, where the pill is hidden.
 */
export function SidebarCompactUndoNotice(props: CompactUndoNoticeProps) {
  return (
    <CompactNoticeLayer>
      <div
        data-sidebar-compact-motion=""
        aria-hidden={props.exiting || undefined}
        inert={props.exiting}
        // The sidebar's own colour under the tile, so icons it floats over do not show through.
        className={cn(
          "w-full rounded-xl bg-sidebar",
          MOTION,
          props.exiting
            ? "pointer-events-none translate-y-1.5 opacity-0"
            : "translate-y-0 opacity-100",
        )}
      >
        <div className="flex flex-col items-center gap-0.5 rounded-xl bg-sidebar-control-surface px-1 pt-1.5 pb-1 text-2xs leading-4 font-medium text-sidebar-foreground">
          <span className="max-w-full truncate">{props.label}</span>
          <button
            type="button"
            onClick={props.onUndo}
            className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            Undo
            {props.shortcut ? <Kbd>{props.shortcut}</Kbd> : null}
          </button>
        </div>
      </div>
    </CompactNoticeLayer>
  );
}
