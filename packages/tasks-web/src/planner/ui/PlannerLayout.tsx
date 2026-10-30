import { useRef, useState, type ReactNode } from "react";

import { useSidebar } from "../../../../../apps/web/src/components/ui/sidebar.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { LIST_HEADER_WIDTH, MIN_LIST_WIDTH, MIN_WEEK_WIDTH } from "../logic/plannerWidth.ts";
import { snapStackedWeek, type StackedWeek } from "../logic/stackedWeek.ts";

/**
 * The height of the week with its header, which fold away together; the list
 * header keeps its row (about the title bar's height).
 */
const STACKED_HEIGHTS: Record<StackedWeek, string> = {
  hidden: "0px",
  split: "calc(var(--workspace-topbar-height) + (100% - var(--workspace-topbar-height)) * 0.4)",
  full: "calc(100% - var(--workspace-topbar-height))",
};

/**
 * Wande's ResizableLayout. `wide` (the planner's own width, `plannerIsWide`):
 * the list on the left at a width the person drags (kept per device) and the
 * week on the right, which the list header can hide; the two column headers
 * form one row, the page's title bar, and the week pane's `border-l` divides
 * both. Otherwise: the week header on top as the title bar, then the week,
 * a bar that snaps the week to hidden, split or full, then the list header
 * and the list.
 */
export function PlannerLayout(props: {
  readonly listHeader: ReactNode;
  readonly list: ReactNode;
  readonly weekHeader: ReactNode;
  readonly week: ReactNode;
  readonly listWidth: number;
  readonly onListWidthChange: (width: number) => void;
  readonly weekHidden: boolean;
  readonly wide: boolean;
  /** The headers are the page's title bar row, not a right-panel surface's plain row. */
  readonly titleBar: boolean;
}) {
  const { wide } = props;
  // With the sidebar collapsed the page's list header starts after the sidebar
  // toggle (and the macOS traffic lights), so the column grows to keep its controls.
  const clearsSidebar = useSidebar().state === "collapsed" && props.titleBar;
  const container = useRef<HTMLDivElement>(null);
  const listPane = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [stacked, setStacked] = useState<StackedWeek>("split");
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  if (wide)
    return (
      <div ref={container} className="absolute inset-0 flex min-h-0">
        <div
          className={cn("relative flex min-h-0 flex-col", props.weekHidden ? "flex-1" : "shrink-0")}
          style={
            props.weekHidden
              ? undefined
              : {
                  width: dragWidth ?? props.listWidth,
                  minWidth: clearsSidebar
                    ? `max(${MIN_LIST_WIDTH}px, calc(var(--workspace-titlebar-content-left) + var(--workspace-gutter-end) + ${LIST_HEADER_WIDTH}px))`
                    : MIN_LIST_WIDTH,
                  maxWidth: `calc(100% - ${MIN_WEEK_WIDTH}px)`,
                }
          }
        >
          {props.listHeader}
          <div className="relative min-h-0 flex-1">{props.list}</div>
          {props.weekHidden ? null : (
            <div
              className="absolute top-0 -right-1 z-20 h-full w-2 cursor-ew-resize touch-none"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the task list"
              onPointerDown={(event) => {
                event.preventDefault();
                const target = event.currentTarget;
                target.setPointerCapture(event.pointerId);
                const startX = event.clientX;
                const total = container.current?.clientWidth ?? 1200;
                const clamp = (value: number) =>
                  Math.max(MIN_LIST_WIDTH, Math.min(total - MIN_WEEK_WIDTH, value));
                const startWidth = clamp(target.parentElement?.clientWidth ?? props.listWidth);
                let width = startWidth;
                const move = (moveEvent: PointerEvent) => {
                  width = clamp(startWidth + moveEvent.clientX - startX);
                  setDragWidth(width);
                };
                const up = () => {
                  target.removeEventListener("pointermove", move);
                  target.removeEventListener("pointerup", up);
                  target.removeEventListener("pointercancel", up);
                  setDragWidth(null);
                  props.onListWidthChange(width);
                };
                target.addEventListener("pointermove", move);
                target.addEventListener("pointerup", up);
                target.addEventListener("pointercancel", up);
              }}
            />
          )}
        </div>
        {props.weekHidden ? null : (
          // `min-w-0`: day columns scroll inside the week instead of widening the planner.
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l">
            {props.weekHeader}
            <div className="relative min-h-0 flex-1">{props.week}</div>
          </div>
        )}
      </div>
    );

  const weekGone = stacked === "hidden" && dragHeight === null;
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
      <div ref={container} className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden"
          style={{ height: dragHeight ?? STACKED_HEIGHTS[stacked] }}
        >
          <div className="shrink-0">{props.weekHeader}</div>
          <div className="relative min-h-0 flex-1">{props.week}</div>
        </div>
        <div className="relative z-10 flex h-0 justify-center">
          <div
            className={cn(
              "h-5 w-12 cursor-ns-resize touch-none rounded-full border bg-background shadow-sm",
              weekGone ? "mt-1" : "-mt-2.5",
            )}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the week"
            onPointerDown={(event) => {
              event.preventDefault();
              const target = event.currentTarget;
              target.setPointerCapture(event.pointerId);
              const top = container.current?.getBoundingClientRect().top ?? 0;
              const listHeader = listPane.current?.firstElementChild?.clientHeight ?? 0;
              const room = (container.current?.clientHeight ?? 1) - listHeader;
              let height = 0;
              const move = (moveEvent: PointerEvent) => {
                height = Math.max(0, Math.min(room, moveEvent.clientY - top));
                setDragHeight(height);
              };
              const up = () => {
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", up);
                target.removeEventListener("pointercancel", up);
                setDragHeight(null);
                setStacked(snapStackedWeek(height, room));
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", up);
              target.addEventListener("pointercancel", up);
            }}
          />
        </div>
        <div ref={listPane} className="relative flex min-h-0 flex-1 flex-col border-t">
          {props.listHeader}
          <div
            className={cn(
              "relative min-h-0 flex-1",
              stacked === "full" && dragHeight === null && "hidden",
            )}
          >
            {props.list}
          </div>
        </div>
      </div>
    </div>
  );
}
