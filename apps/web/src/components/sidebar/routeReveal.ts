import { useRef } from "react";

import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

// AppSidebarLayout owns this so drawer and Settings remounts preserve the chosen project scope.
// Only route changes may widen that scope; scroll position is lost on remount.
// Leaving Settings commits the router's location before its matches, briefly hiding thread params.
// Ignore null keys so the same thread does not look new during that gap.
export interface SidebarRouteReveal {
  // The route's scope was judged once its projects loaded. A scope picked after that stands,
  // though the thread has no row to complete the reveal (a bot's chat).
  scopeJudged?: boolean;
  observedKey: string | null;
  pendingKey: string | null;
}

export function pendingSidebarRouteReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
): string | null {
  if (routeKey === null) return null;
  if (reveal.observedKey !== routeKey) {
    reveal.scopeJudged = false;
    reveal.observedKey = routeKey;
    reveal.pendingKey = routeKey;
  }
  return reveal.pendingKey;
}

export function completeSidebarRouteReveal(reveal: SidebarRouteReveal): void {
  reveal.pendingKey = null;
}

// Each route change and each mount scroll to the open thread once. Render records
// the route, so a thread left before its row mounted still counts as a change.
// The row can mount after the route, once its shells arrive, so its ref scrolls.
export function useActiveRowReveal(reveal: SidebarRouteReveal, routeKey: string | null) {
  const mountRevealOwed = useRef(true);
  pendingSidebarRouteReveal(reveal, routeKey);
  return (row: HTMLElement | null, rowKey: string) => {
    if (row === null) return;
    if (reveal.pendingKey !== rowKey && !mountRevealOwed.current) return;
    completeSidebarRouteReveal(reveal);
    mountRevealOwed.current = false;
    // A row under the pointer was just clicked, so it is in view; scrolling it would force a
    // layout mid-commit. Keyboard activation can come from a focused row scrolled out of view.
    if (row.matches(":hover")) return;
    row.scrollIntoView({ block: "nearest" });
  };
}

type RevealableThread = Parameters<typeof filterSidebarV2VisibleThreads>[0][number];

// Render records the route before deciding, so the first render of a new route
// already widens the scope. Only a route reveal widens: the once-per-mount
// scroll never changes a scope the user chose.
export function resolveSidebarRouteReveal<T extends RevealableThread>(input: {
  readonly reveal: SidebarRouteReveal;
  readonly routeKey: string | null;
  readonly isSearching: boolean;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly findThread: (key: string) => T | undefined;
  /** False while project snapshots load, when a stored scope may not resolve yet. */
  readonly projectsReady?: boolean;
}): { readonly pendingKey: string | null; readonly widensScope: boolean } {
  const { reveal, routeKey, isSearching, scopedProjectKeys, delegatedUnderParent, findThread } =
    input;
  const pendingKey = pendingSidebarRouteReveal(reveal, routeKey);
  // Search results replace the thread list; the reveal waits for it to return.
  const thread = pendingKey === null || isSearching ? undefined : findThread(pendingKey);
  const widensScope =
    thread !== undefined &&
    reveal.scopeJudged !== true &&
    scopedProjectKeys !== null &&
    filterSidebarV2VisibleThreads([thread], scopedProjectKeys, delegatedUnderParent).length === 0 &&
    filterSidebarV2VisibleThreads([thread], null, delegatedUnderParent).length === 1;
  // A widening is judged on the render after it, once the scope it wrote back is read.
  if (thread !== undefined && !widensScope && input.projectsReady !== false) {
    reveal.scopeJudged = true;
  }
  return { pendingKey, widensScope };
}
