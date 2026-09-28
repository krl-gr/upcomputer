import { memo } from "react";

import { CONTEXT_BAR_ICON_TRIGGER_CLASS } from "../BranchToolbar.styles";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarRightIcon } from "./SidebarRightIcon";

interface ChatContextActionsProps {
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

/** Right edge of the composer context bar: the right panel toggle. */
export const ChatContextActions = memo(function ChatContextActions(props: ChatContextActionsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Toggle right panel"
              className={CONTEXT_BAR_ICON_TRIGGER_CLASS}
              onPressedChange={props.onToggleRightPanel}
              pressed={props.rightPanelOpen}
              size="xs"
              variant="outline"
            />
          }
        >
          <SidebarRightIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Toggle right panel</TooltipPopup>
      </Tooltip>
    </div>
  );
});
