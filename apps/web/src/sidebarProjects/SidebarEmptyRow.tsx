import { PlusIcon } from "lucide-react";

import { SidebarCompactTooltip } from "../adaptiveSidebar/adaptiveSidebar";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";

/**
 * The one row of an empty sidebar section (Projects, Bots, Threads): what to add
 * first, as a row like the section's others. Goes in a `SidebarMenu` under `SIDEBAR_MENU_SCOPE`.
 */
export function SidebarEmptyRow(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarCompactTooltip label={props.label}>
        <SidebarMenuButton disabled={props.disabled} onClick={props.onClick}>
          <PlusIcon />
          <span className="flex-1 truncate">{props.label}</span>
        </SidebarMenuButton>
      </SidebarCompactTooltip>
    </SidebarMenuItem>
  );
}
