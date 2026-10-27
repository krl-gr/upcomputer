import {
  UI_TRACK_TARGET_PATTERN,
  UI_UNTRACKED_TARGET,
  type AppView,
  type ClientTelemetryEvent,
} from "@t3tools/contracts";
import { useEffect, useSyncExternalStore } from "react";

type UiClickEvent = Extract<ClientTelemetryEvent, { event: "ui.click" }>;

const SECTION_VIEWS: Readonly<Record<string, AppView>> = {
  new: "new_thread",
  draft: "new_thread",
  tasks: "tasks",
  agents: "agents",
  automations: "automations",
  bots: "bots",
  settings: "settings",
  usage: "usage",
  projects: "projects",
  "pull-requests": "pull_requests",
  welcome: "onboarding",
  connect: "onboarding",
  "connect-agent": "onboarding",
  pair: "onboarding",
};

/** Only the route's shape decides the view; its params never leave this function. */
export function appViewForPathname(pathname: string): AppView {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first === undefined) return "home";
  const section = SECTION_VIEWS[first];
  if (section !== undefined) return section;
  // A thread's route is `/$environmentId/$threadId`.
  return segments.length === 2 ? "threads" : "other";
}

let viewOverrides: ReadonlyArray<{ readonly view: AppView }> = [];
const viewOverrideListeners = new Set<() => void>();

function setViewOverrides(next: ReadonlyArray<{ readonly view: AppView }>) {
  viewOverrides = next;
  for (const listener of viewOverrideListeners) listener();
}

/**
 * Names the view for a section the URL does not tell apart, such as the
 * planner and automations inside `/tasks`. The latest mounted caller wins.
 */
export function useAnalyticsView(view: AppView) {
  useEffect(() => {
    const entry = { view };
    setViewOverrides([...viewOverrides, entry]);
    return () => setViewOverrides(viewOverrides.filter((candidate) => candidate !== entry));
  }, [view]);
}

export function useAnalyticsViewOverride(): AppView | null {
  return useSyncExternalStore(
    (listener) => {
      viewOverrideListeners.add(listener);
      return () => viewOverrideListeners.delete(listener);
    },
    () => viewOverrides.at(-1)?.view ?? null,
  );
}

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(",");

function clickRole(element: Element): UiClickEvent["role"] {
  const role = element.getAttribute("role");
  if (role === "tab") return "tab";
  if (role?.startsWith("menuitem")) return "menuitem";
  if (role === "link" || (role === null && element.tagName === "A")) return "link";
  return "button";
}

/**
 * The clicked control's role and its `data-track` name. Nothing else is read
 * from the element: in this app, labels and titles are thread, task and
 * project names, and hrefs carry their ids.
 */
function describeUiClick(target: EventTarget | null): Pick<UiClickEvent, "role" | "target"> | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(INTERACTIVE_SELECTOR);
  if (control === null) return null;
  const name = control.getAttribute("data-track");
  return {
    role: clickRole(control),
    target: name !== null && UI_TRACK_TARGET_PATTERN.test(name) ? name : UI_UNTRACKED_TARGET,
  };
}

// The same control clicked again within this window is one click: double
// clicks and impatient repeats would otherwise multiply the count.
const REPEAT_WINDOW_MS = 1_000;
const MAX_CLICKS_PER_MINUTE = 60;

/**
 * Sends a `ui.click` for every click on a button, link, tab or menu item in
 * `root`. Capture phase, so controls that stop propagation are still counted.
 */
export function installUiClickTracking(
  root: Document,
  options: {
    readonly view: () => AppView;
    readonly send: (event: UiClickEvent) => void;
    readonly now?: () => number;
  },
): () => void {
  const now = options.now ?? Date.now;
  let last: { readonly key: string; readonly at: number } | null = null;
  let windowStart = 0;
  let windowCount = 0;
  const onClick = (event: MouseEvent) => {
    const click = describeUiClick(event.target);
    if (click === null) return;
    const view = options.view();
    const at = now();
    const key = `${view} ${click.role} ${click.target}`;
    if (last !== null && last.key === key && at - last.at < REPEAT_WINDOW_MS) return;
    last = { key, at };
    if (at - windowStart >= 60_000) {
      windowStart = at;
      windowCount = 0;
    }
    if (windowCount >= MAX_CLICKS_PER_MINUTE) return;
    windowCount += 1;
    options.send({ event: "ui.click", view, ...click });
  };
  root.addEventListener("click", onClick, { capture: true });
  return () => root.removeEventListener("click", onClick, { capture: true });
}
