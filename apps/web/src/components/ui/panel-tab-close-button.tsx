import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

interface PanelTabCloseButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tooltip?: string;
  /** `md` holds a 16px icon, for tabs as tall as the header's other controls. */
  size?: "default" | "md";
}

export function PanelTabCloseButton({
  children,
  label,
  onClick,
  tooltip,
  size = "default",
}: PanelTabCloseButtonProps) {
  const button = (
    <button
      type="button"
      className={cn(
        "cursor-pointer group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted",
        size === "md" && "size-5",
      )}
      aria-label={label}
      onClick={onClick}
    >
      <span
        className={cn(
          "relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden",
          size === "md" && "size-4",
        )}
      >
        {children}
      </span>
      <X
        className={cn(
          "hidden size-3 group-hover/tab:block group-focus-visible/close:block",
          size === "md" && "size-4",
        )}
      />
    </button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
