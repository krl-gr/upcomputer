import type { SidebarViewMode } from "@upcomputer/contracts/settings";

/**
 * The sidebar ships a single unified view (Projects filter + one Chats list).
 * The persisted setting still decodes "nested" / "focused" / "v2" for
 * compatibility, but every stored value resolves to the unified view, which
 * reuses the "focused" literal.
 */
export const UNIFIED_SIDEBAR_VIEW_MODE: SidebarViewMode = "focused";

export function resolveAvailableSidebarViewMode(_viewMode: SidebarViewMode): SidebarViewMode {
  return UNIFIED_SIDEBAR_VIEW_MODE;
}
