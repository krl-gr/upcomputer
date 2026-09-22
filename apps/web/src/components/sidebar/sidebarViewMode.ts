import type { SidebarViewMode } from "@upcomputer/contracts/settings";

/** Flat view remains decoded for persisted-state compatibility but is not shipping yet. */
export const FLAT_SIDEBAR_VIEW_ENABLED = false;

export function resolveAvailableSidebarViewMode(
  viewMode: SidebarViewMode,
  flatViewEnabled = FLAT_SIDEBAR_VIEW_ENABLED,
): SidebarViewMode {
  return viewMode === "v2" && !flatViewEnabled ? "nested" : viewMode;
}
