import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { memo } from "react";

import { SidebarRightIcon } from "./SidebarRightIcon";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  onToggleRightPanel: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  onToggleRightPanel,
}: PanelLayoutControlsProps) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      <RightPanelVisibilityControl
        available={rightPanelAvailable}
        open={rightPanelOpen}
        shortcutLabel={rightPanelShortcutLabel}
        onToggle={onToggleRightPanel}
      />
    </div>
  );
});

export const RightPanelVisibilityControl = memo(function RightPanelVisibilityControl({
  available,
  open,
  shortcutLabel,
  onToggle,
}: {
  available: boolean;
  open: boolean;
  shortcutLabel: string | null;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={open}
            onPressedChange={onToggle}
            aria-label="Toggle right panel"
            variant="ghost"
            size="sm"
            disabled={!available}
          >
            <SidebarRightIcon className="size-3.5" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {available
          ? `Toggle right panel${shortcutLabel ? ` (${shortcutLabel})` : ""}`
          : "Right panel is unavailable"}
      </TooltipPopup>
    </Tooltip>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});
