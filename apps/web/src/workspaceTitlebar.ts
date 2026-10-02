export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[var(--workspace-titlebar-content-left)]";

/**
 * The collapsed-sidebar inset for a header that starts at the window's left
 * edge. Desktop windows keep it at every width: the narrow layout closes the
 * sidebar into a sheet, which reads as collapsed, while the macOS traffic
 * lights stay over the header. Browser phones have no window controls and no
 * sidebar toggle to make room for, so their header starts at the edge.
 */
export function resolveLeftEdgeTitlebarInsetClass(input: {
  readonly isElectron: boolean;
  readonly isMobile: boolean;
}): string | null {
  return input.isElectron || !input.isMobile ? COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS : null;
}
