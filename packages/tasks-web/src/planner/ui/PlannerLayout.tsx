import { useRef, useState, type ReactNode } from "react";

import { useSidebar } from "../../../../../apps/web/src/components/ui/sidebar.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { LIST_HEADER_WIDTH, MIN_LIST_WIDTH } from "../data/preferences.ts";

/** Stacked layout's week height: hidden, split, or the whole pane (wande's three modes). */
type StackedMode = 0 | 1 | 2;
const STACKED_HEIGHTS: Record<StackedMode, string> = { 0: "0px", 1: "40%", 2: "100%" };

/**
 * Wande's ResizableLayout. `wide` (the planner's own width, `plannerIsWide`):
 * the list on the left at a width the person drags (kept per device) and the
 * week on the right, which the list header can hide; the two column headers
 * form one row, the page's title bar, and the week pane's `border-l` divides
 * both. Otherwise: the list header on top, then the week above the list, with
 * a bar that snaps the week to hidden, split or full.
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
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [mode, setMode] = useState<StackedMode>(1);
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
                  // The week keeps at least 320px, as wande's dynamic maximum.
                  maxWidth: "calc(100% - 320px)",
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
                  Math.max(MIN_LIST_WIDTH, Math.min(total - 320, value));
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
          <div className="relative flex min-h-0 flex-1 flex-col border-l">
            {props.weekHeader}
            <div className="relative min-h-0 flex-1">{props.week}</div>
          </div>
        )}
      </div>
    );

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col">
      {props.listHeader}
      <div ref={container} className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden"
          style={{ height: dragHeight ?? STACKED_HEIGHTS[mode] }}
        >
          {props.weekHeader}
          <div className="relative min-h-0 flex-1">{props.week}</div>
        </div>
        <div className="relative z-10 flex h-0 justify-center">
          <div
            className="-mt-2.5 h-5 w-12 cursor-ns-resize touch-none rounded-full border bg-background shadow-sm"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the week"
            onPointerDown={(event) => {
              event.preventDefault();
              const target = event.currentTarget;
              target.setPointerCapture(event.pointerId);
              const top = container.current?.getBoundingClientRect().top ?? 0;
              const total = container.current?.clientHeight ?? 1;
              let height = 0;
              const move = (moveEvent: PointerEvent) => {
                height = Math.max(0, Math.min(total, moveEvent.clientY - top));
                setDragHeight(height);
              };
              const up = () => {
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", up);
                target.removeEventListener("pointercancel", up);
                setDragHeight(null);
                const share = height / total;
                setMode(share < 0.2 ? 0 : share < 0.6 ? 1 : 2);
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", up);
              target.addEventListener("pointercancel", up);
            }}
          />
        </div>
        <div
          className={cn(
            "relative min-h-0 flex-1 border-t",
            mode === 2 && dragHeight === null && "hidden",
          )}
        >
          {props.list}
        </div>
      </div>
    </div>
  );
}
