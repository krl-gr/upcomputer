import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export interface HostedBrowserWebviewSize {
  readonly width: number;
  readonly height: number;
}

export interface HostedBrowserWebviewWrapperStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
  readonly pointerEvents: "auto" | "none";
  readonly borderRadius?: number;
  readonly visibility?: "hidden" | "visible";
}

export const HIDDEN_BROWSER_WEBVIEW_OFFSET = -100_000;

export function resolveHostedBrowserWebviewWrapperStyle(input: {
  readonly active: boolean;
  readonly renderingActive: boolean;
  readonly keepPaintableWhenInactive?: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly rect: BrowserSurfaceRect | null;
  readonly hiddenSize: HostedBrowserWebviewSize;
  /** An opaque region to keep a capture-active guest behind, instead of the window origin. */
  readonly hiddenBackdrop?: BrowserSurfaceRect | null;
}): HostedBrowserWebviewWrapperStyle {
  const {
    active,
    cornerRadius = 0,
    hiddenBackdrop = null,
    hiddenSize,
    keepPaintableWhenInactive = false,
    rect,
    renderingActive,
    zIndex = 30,
  } = input;
  if (active && rect) {
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      zIndex,
      pointerEvents: "auto",
      ...(cornerRadius > 0 ? { borderRadius: cornerRadius } : {}),
    };
  }

  if (renderingActive) {
    // Electron stops compositing a guest that is fully outside the window, even
    // when background throttling is disabled. Keep capture-active guests inside
    // the viewport but behind the app so recordings receive complete frames.
    // With a backdrop, the wrapper is clipped to it; the guest keeps `hiddenSize`.
    return {
      left: hiddenBackdrop?.x ?? 0,
      top: hiddenBackdrop?.y ?? 0,
      width: Math.min(hiddenSize.width, hiddenBackdrop?.width ?? Infinity),
      height: Math.min(hiddenSize.height, hiddenBackdrop?.height ?? Infinity),
      zIndex: -1,
      pointerEvents: "none",
      visibility: "visible",
    };
  }

  return {
    left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    width: hiddenSize.width,
    height: hiddenSize.height,
    zIndex: -1,
    pointerEvents: "none",
    visibility: keepPaintableWhenInactive ? "visible" : "hidden",
  };
}
