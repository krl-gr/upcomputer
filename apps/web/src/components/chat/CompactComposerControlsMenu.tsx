import { ProviderInteractionMode, RuntimeMode } from "@upcomputer/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import type { InteractionModePresentation } from "../../interactionModes";
import { COMPOSER_CONTROL_ICON_TRIGGER_CLASS } from "./composerControlStyles";

/** The "…" menu that holds the composer controls that no longer fit the footer. */
export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  interactionModes: ReadonlyArray<InteractionModePresentation>;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  showRuntimeMode: boolean;
  traitsMenuContent?: ReactNode;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={COMPOSER_CONTROL_ICON_TRIGGER_CLASS}
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? <>{props.traitsMenuContent}</> : null}
        {props.showInteractionModeToggle ? (
          <>
            {props.traitsMenuContent ? <MenuDivider /> : null}
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onInteractionModeChange(value as ProviderInteractionMode);
              }}
            >
              {props.interactionModes.map((mode) => (
                <MenuRadioItem key={mode.id} value={mode.id}>
                  {mode.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        ) : null}
        {props.showRuntimeMode ? (
          <>
            {props.traitsMenuContent || props.showInteractionModeToggle ? <MenuDivider /> : null}
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
            <MenuRadioGroup
              value={props.runtimeMode}
              onValueChange={(value) => {
                if (!value || value === props.runtimeMode) return;
                props.onRuntimeModeChange(value as RuntimeMode);
              }}
            >
              <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
              <MenuRadioItem value="auto-accept-edits">Auto-accept edits</MenuRadioItem>
              <MenuRadioItem value="auto">Auto</MenuRadioItem>
              <MenuRadioItem value="full-access">Full access</MenuRadioItem>
            </MenuRadioGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
