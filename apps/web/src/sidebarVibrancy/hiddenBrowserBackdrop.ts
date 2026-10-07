import { useSyncExternalStore } from "react";

import type { BrowserSurfaceRect } from "../browser/browserSurfaceStore";
import { showsSidebarVibrancy } from "./sidebarVibrancy";

/*
 * Where a hidden, capture-active browser guest waits under the `sidebarVibrancy`
 * surface. Upstream parks it at the window origin behind the app, which in a
 * vibrant window is under the translucent sidebar, so the page shows through it.
 * The chat inset is opaque on every route that mounts the sidebar, so the guest
 * waits behind it instead. Without an inset the page is opaque, and the origin
 * is fine.
 */

const INSET_SELECTOR = "main[data-slot='sidebar-inset']";

let backdrop: BrowserSurfaceRect | null = null;
const listeners = new Set<() => void>();
let stopTracking: (() => void) | null = null;

function startTracking(): () => void {
  let observed: Element | null = null;
  const measure = () => {
    const inset = document.querySelector(INSET_SELECTOR);
    if (inset !== observed) {
      if (observed) observer.unobserve(observed);
      if (inset) observer.observe(inset);
      observed = inset;
    }
    const box = inset?.getBoundingClientRect();
    const next =
      box && box.width > 0 && box.height > 0
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : null;
    if (
      next?.x === backdrop?.x &&
      next?.y === backdrop?.y &&
      next?.width === backdrop?.width &&
      next?.height === backdrop?.height
    ) {
      return;
    }
    backdrop = next;
    for (const listener of listeners) listener();
  };
  // The inset resizes whenever the sidebar or the window does, and reports a
  // zero size once a route swap detaches it, which re-queries the new one.
  const observer = new ResizeObserver(measure);
  window.addEventListener("resize", measure);
  measure();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", measure);
    backdrop = null;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stopTracking ??= startTracking();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTracking?.();
      stopTracking = null;
    }
  };
}

const subscribeNever = () => () => {};
const readBackdrop = () => backdrop;
const readNoBackdrop = () => null;

/**
 * The opaque rect a guest that renders while hidden should sit behind, or null
 * for upstream's window origin. Tracks the inset only while `hidden` is true.
 */
export function useHiddenBrowserBackdrop(hidden: boolean): BrowserSurfaceRect | null {
  const tracked = hidden && showsSidebarVibrancy(navigator.platform);
  return useSyncExternalStore(
    tracked ? subscribe : subscribeNever,
    tracked ? readBackdrop : readNoBackdrop,
    readNoBackdrop,
  );
}
