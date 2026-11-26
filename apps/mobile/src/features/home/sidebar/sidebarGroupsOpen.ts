import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/** The desktop sidebar's groups, as the phone's Chats list shows them. */
export type SidebarGroup = "computers" | "projects" | "bots" | "pinned" | "threads";

export type SidebarGroupsOpen = Readonly<Record<SidebarGroup, boolean>>;

/** As on the desktop, except that Computers and Projects start closed on the phone. */
export const DEFAULT_SIDEBAR_GROUPS_OPEN: SidebarGroupsOpen = {
  computers: false,
  projects: false,
  bots: true,
  pinned: true,
  threads: true,
};

/** The stored open states, each group falling back to its default when missing or unreadable. */
export function decodeSidebarGroupsOpen(raw: string | null): SidebarGroupsOpen {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const record = typeof stored === "object" && stored !== null ? stored : {};
  const value = (group: SidebarGroup) => {
    const entry = (record as Record<string, unknown>)[group];
    return typeof entry === "boolean" ? entry : DEFAULT_SIDEBAR_GROUPS_OPEN[group];
  };
  return {
    computers: value("computers"),
    projects: value("projects"),
    bots: value("bots"),
    pinned: value("pinned"),
    threads: value("threads"),
  };
}

const STORAGE_KEY = "upcomputer.chats-sidebar-groups.v1";
const listeners = new Set<() => void>();
let current: SidebarGroupsOpen | null = null;

function read(): SidebarGroupsOpen {
  if (current === null) {
    try {
      current = decodeSidebarGroupsOpen(SecureStore.getItem(STORAGE_KEY));
    } catch {
      current = DEFAULT_SIDEBAR_GROUPS_OPEN;
    }
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleSidebarGroup(group: SidebarGroup) {
  const open = read();
  current = { ...open, [group]: !open[group] };
  for (const listener of listeners) listener();
  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(current)).catch(() => undefined);
}

export function useSidebarGroupsOpen(): SidebarGroupsOpen {
  return useSyncExternalStore(subscribe, read, read);
}
