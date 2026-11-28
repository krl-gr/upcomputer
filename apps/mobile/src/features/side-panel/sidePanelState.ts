import { useSyncExternalStore } from "react";

/** The views the desktop's right panel offers beside a chat that the phone opens in a tab. */
export type SidePanelSurface =
  | "browser"
  | "terminal"
  | "files"
  | "diff"
  | "tasks"
  | "linkedItems"
  | "sideChat";

export interface SidePanelTab {
  /** One tab per view, so a view's id is its tab's. */
  readonly id: SidePanelSurface;
  /** The shell a Terminal tab shows; none means the chat's running one. */
  readonly terminalId?: string;
}

export interface SidePanelState {
  readonly tabs: ReadonlyArray<SidePanelTab>;
  /** The tab on screen; null is the new tab, which lists the views. */
  readonly active: SidePanelSurface | null;
}

export const EMPTY_SIDE_PANEL: SidePanelState = { tabs: [], active: null };

/** Opens a view in a tab, or shows its tab when it is already open. */
export function openSidePanelSurface(
  state: SidePanelState,
  surface: SidePanelSurface,
): SidePanelState {
  if (state.tabs.some((tab) => tab.id === surface)) return { ...state, active: surface };
  return { tabs: [...state.tabs, { id: surface }], active: surface };
}

/** Closes a tab. Closing the one on screen shows its right neighbour, else its left one. */
export function closeSidePanelTab(state: SidePanelState, id: SidePanelSurface): SidePanelState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.active !== id) return { tabs, active: state.active };
  return { tabs, active: (tabs[index] ?? tabs[index - 1])?.id ?? null };
}

export function setSidePanelTerminal(state: SidePanelState, terminalId: string): SidePanelState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === "terminal" ? { ...tab, terminalId } : tab)),
  };
}

// Tabs live for the app's session, per chat, so the side panel button reopens the last one.
const panels = new Map<string, SidePanelState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSidePanel(threadKey: string): SidePanelState {
  return panels.get(threadKey) ?? EMPTY_SIDE_PANEL;
}

export function updateSidePanel(
  threadKey: string,
  update: (state: SidePanelState) => SidePanelState,
) {
  const next = update(readSidePanel(threadKey));
  if (next === readSidePanel(threadKey)) return;
  panels.set(threadKey, next);
  for (const listener of listeners) listener();
}

export function useSidePanel(threadKey: string): SidePanelState {
  const read = () => readSidePanel(threadKey);
  return useSyncExternalStore(subscribe, read, read);
}
