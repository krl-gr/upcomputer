import type { MouseEvent, ReactNode } from "react";

import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../../apps/web/src/components/ui/tooltip.tsx";

/** An icon button with its name in a tooltip (wande used native titles). */
export function IconAction(props: {
  readonly label: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={props.label}
            aria-pressed={props.pressed}
            className={props.className}
            disabled={props.disabled}
            size={props.size ?? "icon-xs"}
            variant={props.variant ?? "ghost"}
            onClick={props.onClick}
            data-prevent-drag
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}
