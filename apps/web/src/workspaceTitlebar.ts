// From md up, the collapsed sidebar leaves the compact sidebar's column at the
// main area's left edge, which already clears part of the fixed toggle.
// UpComputer: beside the compact sidebar (surface `sidebarLayout`) it clears the macOS window controls.
export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "md:[[data-sidebar-compact=true]_&]:pl-[max(0px,calc(var(--workspace-controls-left)-var(--sidebar-width)))] [[data-sidebar-state=collapsed]_&]:pl-[var(--workspace-titlebar-content-left)] md:[[data-sidebar-state=collapsed]_&]:pl-[max(0px,calc(var(--workspace-titlebar-content-left)-var(--compact-sidebar-width,0px)))] max-md:[[data-sidebar-state=expanded]_&]:pl-[var(--workspace-titlebar-content-left)]";
