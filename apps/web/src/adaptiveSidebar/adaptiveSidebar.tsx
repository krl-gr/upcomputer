import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { SearchIcon, SquarePenIcon } from "lucide-react";
import {
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { openCommandPalette } from "../commandPaletteBus";
import {
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
  resolveThreadSidebarMaximumWidth,
} from "../components/threadSidebarWidth";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import { shortcutLabelForCommand } from "../keybindings";
import { productSurface } from "../product/productFlags";
import { primaryServerKeybindingsAtom } from "../state/server";
import "./adaptiveSidebar.css";
import {
  SIDEBAR_COMPACT_THRESHOLD,
  SIDEBAR_COMPACT_WIDTH,
  isCompactSidebarWidth,
  moveSidebarWidthDrag,
  resolveInitialFullSidebarWidth,
  startSidebarWidthDrag,
} from "./sidebarWidthMode";

// The adaptive sidebar (surface `sidebarLayout`): compact, the wrapper carries `data-sidebar-compact`
// and `adaptiveSidebar.css` draws the same sidebar as icons from it. A drag sets that attribute
// itself as it crosses the threshold, so nothing renders mid-drag; React state follows at commit.

const SIDEBAR_COMPACT_STORAGE_KEY = "upcomputer:sidebar-compact";
// The `max-md` breakpoint, under which the sidebar is upstream's sheet.
const MOBILE_QUERY = "(max-width: 767px)";

const isAdaptive = () => productSurface("sidebarLayout") === "upcomputer";

function logStorageError(error: unknown) {
  console.error("Could not use the stored sidebar layout.", error);
}

/** The stored mode with the viewport, read once for every row rather than once per row. */
const compactStore = (() => {
  const listeners = new Set<() => void>();
  let snapshot: boolean | null = null;
  let detach: (() => void) | null = null;
  const notify = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };
  const readPreference = () => {
    try {
      return getLocalStorageItem(SIDEBAR_COMPACT_STORAGE_KEY, Schema.Boolean) ?? false;
    } catch (error) {
      logStorageError(error);
      return false;
    }
  };
  const attach = () => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIDEBAR_COMPACT_STORAGE_KEY) notify();
    };
    media.addEventListener("change", notify);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", notify);
      window.removeEventListener("storage", onStorage);
    };
  };
  const set = (compact: boolean) => {
    try {
      setLocalStorageItem(SIDEBAR_COMPACT_STORAGE_KEY, compact, Schema.Boolean);
    } catch (error) {
      logStorageError(error);
    }
    notify();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      detach ??= attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        detach?.();
        detach = null;
      };
    },
    get: () => {
      snapshot ??= readPreference() && !window.matchMedia(MOBILE_QUERY).matches;
      return snapshot;
    },
    set,
    toggle: () => set(!readPreference()),
  };
})();

/** Whether the desktop sidebar is compact. Always false on phones and under upstream's surface. */
export function useSidebarCompact(): boolean {
  const compact = useSyncExternalStore(compactStore.subscribe, compactStore.get, () => false);
  return compact && isAdaptive();
}

function writeFullSidebarWidth(width: number) {
  try {
    setLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, width, Schema.Finite);
  } catch (error) {
    logStorageError(error);
  }
}

function readInitialFullSidebarWidth() {
  try {
    return resolveInitialFullSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
    );
  } catch (error) {
    logStorageError(error);
    return resolveInitialFullSidebarWidth(null);
  }
}

function setCompactAttribute(wrapper: HTMLElement, compact: boolean) {
  wrapper.setAttribute("data-sidebar-compact", String(compact));
}

const switchTimers = new WeakMap<HTMLElement, number>();

/** Marks a switch between full and compact for as long as `adaptiveSidebar.css` fades it in. */
function markSidebarSwitching(wrapper: HTMLElement) {
  wrapper.setAttribute("data-sidebar-switching", "");
  const duration = Number.parseFloat(
    getComputedStyle(wrapper).getPropertyValue("--sidebar-switch-duration"),
  );
  window.clearTimeout(switchTimers.get(wrapper));
  switchTimers.set(
    wrapper,
    window.setTimeout(() => wrapper.removeAttribute("data-sidebar-switching"), duration || 0),
  );
}

/**
 * The rail moves the sidebar without a transition. A snap across the threshold
 * eases like a switch by mod+b instead, then the edge follows the pointer again.
 */
function setSnapTransition(wrapper: HTMLElement, eased: boolean) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const container = wrapper.querySelector<HTMLElement>("[data-app-sidebar]");
  const gap = container?.parentElement?.querySelector<HTMLElement>("[data-slot='sidebar-gap']");
  for (const element of [container, gap]) {
    element?.style.setProperty(
      "transition-duration",
      eased ? "var(--sidebar-switch-duration)" : "0ms",
    );
  }
}

/**
 * The app layout's sidebar width, resize options and reset under the adaptive
 * surface; null under upstream's. The full sidebar's width stays in upstream's
 * width key, also while compact, so leaving compact restores it.
 */
export function useAdaptiveSidebar(viewportWidth: number) {
  const compact = useSidebarCompact();
  const [fullWidth, setFullWidth] = useState(readInitialFullSidebarWidth);
  if (!isAdaptive()) return null;
  const maxWidth = resolveThreadSidebarMaximumWidth(viewportWidth, SIDEBAR_COMPACT_THRESHOLD);
  const shownFullWidth = Math.min(maxWidth, Math.max(SIDEBAR_COMPACT_THRESHOLD, fullWidth));
  return {
    compact,
    cssWidth: `${compact ? SIDEBAR_COMPACT_WIDTH : shownFullWidth}px`,
    resizable: {
      // The pointer may go down to the column's width; `dragWidth` snaps what lies between.
      minWidth: SIDEBAR_COMPACT_WIDTH,
      maxWidth,
      dragWidth: (wrapper: HTMLElement) => {
        let drag = startSidebarWidthDrag({ compact, width: shownFullWidth });
        return {
          resolve: (pointerWidth: number) => {
            const previous = drag;
            drag = moveSidebarWidthDrag(drag, pointerWidth);
            if (drag.compact !== previous.compact) {
              setCompactAttribute(wrapper, drag.compact);
              markSidebarSwitching(wrapper);
              setSnapTransition(wrapper, true);
            } else if (previous.holding && !drag.holding) {
              setSnapTransition(wrapper, false);
            }
            return drag.width;
          },
          end: (committed: boolean) => {
            if (!committed) setCompactAttribute(wrapper, compact);
          },
        };
      },
      onResize: (width: number) => {
        if (isCompactSidebarWidth(width)) {
          // The rail stored the column's width; the full width is the one to come back to.
          writeFullSidebarWidth(shownFullWidth);
          compactStore.set(true);
          return;
        }
        setFullWidth(width);
        compactStore.set(false);
      },
    },
    reset: () => {
      try {
        removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
      } catch (error) {
        logStorageError(error);
      }
      setFullWidth(resolveInitialFullSidebarWidth(null));
      compactStore.set(false);
    },
  };
}

/**
 * What `sidebar.toggle` runs: under the adaptive surface it switches the
 * desktop sidebar between full and compact, and phones keep their sheet.
 */
export function useSidebarToggle(toggleSidebar: () => void): () => void {
  const [toggle] = useState(() =>
    isAdaptive()
      ? () => {
          if (window.matchMedia(MOBILE_QUERY).matches) return toggleSidebar();
          const wrapper = document.querySelector<HTMLElement>(
            "[data-slot='sidebar-wrapper'][data-sidebar-compact]",
          );
          if (wrapper) markSidebarSwitching(wrapper);
          compactStore.toggle();
        }
      : toggleSidebar,
  );
  return toggle;
}

/** Whether the layout shows upstream's sidebar toggle: always on phones, never on desktop here. */
export function sidebarTriggerShown(isMobile: boolean): boolean {
  return isMobile || !isAdaptive();
}

/** Footer buttons stack in the compact sidebar, so their tooltips move beside them. */
export function useSidebarFooterTooltipSide(): "top" | "right" {
  return useSidebarCompact() ? "right" : "top";
}

/**
 * Gives a sidebar row its name as a tooltip while the sidebar is compact,
 * where the row shows only its icon. `children` is the row element.
 */
export function SidebarCompactTooltip(props: {
  readonly label: string;
  readonly children: ReactElement<Record<string, unknown>>;
}) {
  const compact = useSidebarCompact();
  return (
    <Tooltip disabled={!compact}>
      {/* The tooltip names nothing, and compact rows hide their text. A row's own aria-label wins. */}
      <TooltipTrigger render={props.children} aria-label={compact ? props.label : undefined} />
      <TooltipPopup side="right">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The sidebar's sections between Tasks and the Threads header. The full sidebar
 * lays them out as if this element were not there; the compact one scrolls
 * them as one column between the pinned top and footer (`adaptiveSidebar.css`).
 */
export function SidebarCompactScroll(props: { readonly children: ReactNode }) {
  if (!isAdaptive()) return props.children;
  return (
    <div data-sidebar-compact-scroll="" className="contents">
      {props.children}
    </div>
  );
}

const COMPACT_BUTTON_CLASS =
  "hidden cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * The search row of the compact sidebar, rendered beside the search field and
 * shown in its place by `adaptiveSidebar.css`: the field needs the full width,
 * and the command palette searches without it, as upstream's compact sidebar did.
 */
export function SidebarCompactSearch() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (!isAdaptive()) return null;
  const shortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <SidebarCompactTooltip label={shortcutLabel ? `Search (${shortcutLabel})` : "Search"}>
      <button
        type="button"
        aria-label="Search"
        data-sidebar-compact-search=""
        data-track="sidebar.search"
        onClick={() => openCommandPalette()}
        className={COMPACT_BUTTON_CLASS}
      >
        <SearchIcon className="size-4 text-(--sidebar-icon-color)" />
      </button>
    </SidebarCompactTooltip>
  );
}

/**
 * New thread in the compact sidebar, which leaves the thread list out: rendered
 * in the Threads header and shown in its place by `adaptiveSidebar.css`.
 */
export function SidebarCompactNewThread(props: {
  readonly tooltip: string;
  readonly onClick: (event: ReactMouseEvent) => void;
}) {
  if (!isAdaptive()) return null;
  return (
    <SidebarCompactTooltip label={props.tooltip}>
      <button
        type="button"
        aria-label="New thread"
        data-sidebar-compact-new-thread=""
        data-track="sidebar.new_thread"
        onClick={props.onClick}
        className={COMPACT_BUTTON_CLASS}
      >
        <SquarePenIcon className="size-4 text-(--sidebar-icon-color)" />
      </button>
    </SidebarCompactTooltip>
  );
}
