import { ContextMenu } from "@base-ui/react/context-menu";

/**
 * A sidebar row's right-click menu. The root goes around the row, whose element `Trigger`
 * renders; fill it with `MenuPopup` and items from `components/ui/menu`, which share its parts.
 */
export const SidebarRowContextMenu = ContextMenu.Root;
export const SidebarRowContextMenuTrigger = ContextMenu.Trigger;
