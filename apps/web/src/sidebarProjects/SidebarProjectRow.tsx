import { EllipsisIcon, SquarePenIcon } from "lucide-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { Menu, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarMenuButton } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { SIDEBAR_ACTION_BUTTON } from "../sidebarMetrics/sidebarMetrics";

/**
 * A row of the Projects section. Hover or keyboard focus reveals its actions
 * the way upstream's thread rows do: the actions sit inside the row, so the
 * row keeps its hover while the pointer is on them. A row with `menuItems`
 * also gets a "…" menu, which right-click opens too; while it is open the
 * row stays highlighted and its actions stay shown.
 */
export function SidebarProjectRow(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly isActive: boolean;
  /** Accessible name and tooltip of the new chat button. */
  readonly newChatLabel: string;
  readonly onSelect: () => void;
  readonly onNewChat: () => void;
  /** Accessible name of the "…" button. */
  readonly menuLabel?: string;
  /** `MenuItem`s of the "…" menu; without them the row has no menu. */
  readonly menuItems?: ReactNode;
}) {
  const { label, icon, isActive, newChatLabel, onSelect, onNewChat, menuLabel, menuItems } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  // The menu popup is portaled, but its React events still bubble through
  // the row; only events from the row itself, outside its buttons, select it.
  const isRowEvent = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    const target = event.target as Element;
    return event.currentTarget.contains(target) && target.closest("button") === null;
  };

  return (
    <SidebarMenuButton
      isActive={isActive}
      render={
        <div
          role="button"
          tabIndex={0}
          className={cn("group/sidebar-row", menuOpen && !isActive && "bg-sidebar-row-hover")}
        />
      }
      onClick={(event) => {
        if (isRowEvent(event)) onSelect();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      onContextMenu={(event) => {
        if (!menuItems || !event.currentTarget.contains(event.target as Element)) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span
        data-testid="sidebar-project-row-actions"
        className={cn(
          "items-center gap-0.5",
          menuOpen
            ? "flex"
            : "hidden group-focus-within/sidebar-row:flex group-any-hover/sidebar-row:flex",
        )}
      >
        {menuItems ? (
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={menuLabel}
                        className={SIDEBAR_ACTION_BUTTON}
                      />
                    }
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="top">Project actions</TooltipPopup>
            </Tooltip>
            <MenuPopup side="bottom" align="end">
              {menuItems}
            </MenuPopup>
          </Menu>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={newChatLabel}
                className={SIDEBAR_ACTION_BUTTON}
                onClick={onNewChat}
              />
            }
          >
            <SquarePenIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{newChatLabel}</TooltipPopup>
        </Tooltip>
      </span>
    </SidebarMenuButton>
  );
}
