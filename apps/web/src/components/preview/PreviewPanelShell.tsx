import { type ReactNode, useCallback, useRef } from "react";

import { isElectron } from "~/env";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";
import {
  RIGHT_PANEL_CHAT_MIN_WIDTH_PX,
  RIGHT_PANEL_DEFAULT_WIDTH_PX,
  RIGHT_PANEL_MAX_WIDTH_PX,
  RIGHT_PANEL_MIN_WIDTH_PX,
  resolveInlineRightPanelMaxWidth,
} from "~/rightPanelLayout";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "local-overlay" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "upcomputer:preview-panel-width";
/** Fraction of the viewport allowed, preserving the remaining space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;

export function getPreviewPanelMaxWidth(viewportWidth: number): number {
  return Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}

/**
 * Shell for the preview panel. Inline and local-overlay modes share one
 * resizable instance so changing layout does not remount the active surface.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  onResizeStateChange?: (resizing: boolean) => void;
  children: ReactNode;
}) {
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const isLocalOverlay = props.mode === "local-overlay";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resolveMaxWidth = useCallback(() => {
    const containerWidth =
      panelRef.current?.parentElement?.getBoundingClientRect().width ??
      (typeof window === "undefined" ? 1280 : window.innerWidth);
    return isLocalOverlay
      ? Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.min(RIGHT_PANEL_MAX_WIDTH_PX, containerWidth))
      : resolveInlineRightPanelMaxWidth(containerWidth);
  }, [isLocalOverlay]);
  const { preferredWidth, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: RIGHT_PANEL_DEFAULT_WIDTH_PX,
    minWidth: RIGHT_PANEL_MIN_WIDTH_PX,
    maxWidth: resolveMaxWidth,
    edge: "left",
    ...(props.onResizeStateChange ? { onResizeStateChange: props.onResizeStateChange } : {}),
  });
  const isResizable = (isInline || isLocalOverlay) && !props.maximized;
  const panelStyle = isResizable
    ? {
        width: isLocalOverlay
          ? `min(${preferredWidth}px, 100cqw)`
          : `min(${preferredWidth}px, 70cqw, calc(100cqw - ${RIGHT_PANEL_CHAT_MIN_WIDTH_PX}px))`,
      }
    : undefined;

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch bg-background",
        isInline &&
          (props.maximized ? "flex-1 border-l border-border" : "shrink-0 border-l border-border"),
        isLocalOverlay &&
          (props.maximized
            ? "absolute inset-0 z-40"
            : "absolute inset-y-0 right-0 z-40 border-l border-border shadow-lg/5"),
        !isInline && !isLocalOverlay && "w-full",
      )}
      style={panelStyle}
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isResizable ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {props.children}
    </div>
  );
}

/**
 * Track viewport width to derive a sensible upper bound for the panel.
 * Resize-aware so dragging the OS window narrower re-clamps the stored
 * width on the next render (the hook's clamp picks this up automatically).
 */
