import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../../apps/web/src/components/ui/collapsible.tsx";

export function DetailSidebarSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left text-sm font-normal leading-relaxed tracking-normal text-muted-foreground transition-colors hover:text-foreground">
        <span className="min-w-0 truncate">{title}</span>
        <ChevronRightIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {count === undefined ? null : <span className="ml-auto text-sm tabular-nums">{count}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function DetailSidebarRow({
  label,
  children,
  interactive = false,
  emphasizeLabel = false,
  controlSelector,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly interactive?: boolean | undefined;
  readonly emphasizeLabel?: boolean | undefined;
  readonly controlSelector?: "button" | "input" | undefined;
  readonly onClick?: (() => void) | undefined;
}) {
  const rowIsInteractive = interactive || controlSelector !== undefined;

  return (
    <div
      className={`flex min-h-8 w-full items-center gap-3 overflow-hidden rounded-lg px-2 text-sm text-foreground/72 select-none dark:text-white/82 ${rowIsInteractive ? "cursor-pointer hover:bg-accent hover:text-foreground dark:hover:text-white/92" : "cursor-default"}`}
      onClick={
        rowIsInteractive
          ? (event) => {
              onClick?.();
              if (!controlSelector) return;
              const target = event.target;
              if (target instanceof Element && target.closest(controlSelector)) return;
              const control = event.currentTarget.querySelector(controlSelector);
              if (control instanceof HTMLButtonElement) control.click();
              if (control instanceof HTMLInputElement) control.focus();
            }
          : undefined
      }
      onKeyDown={
        interactive && !controlSelector
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onClick?.();
            }
          : undefined
      }
      role={interactive && !controlSelector ? "button" : undefined}
      tabIndex={interactive && !controlSelector ? 0 : undefined}
    >
      <dt
        className={`min-w-0 flex-1 truncate ${emphasizeLabel ? "text-foreground dark:text-white/82" : "text-muted-foreground"}`}
      >
        {label}
      </dt>
      <dd className="flex min-w-0 max-w-[65%] items-center justify-end text-right text-foreground">
        {children}
      </dd>
    </div>
  );
}

export const DETAIL_SELECT_TRIGGER_CLASS =
  "h-8 min-h-8 w-auto max-w-full justify-end gap-0 border-0 !bg-transparent p-0 text-right text-sm font-normal leading-relaxed tracking-normal text-foreground [&_[data-slot=select-icon]]:hidden";

export const DETAIL_INPUT_CLASS =
  "h-8 w-48 max-w-full border-0 bg-transparent p-0 text-right text-sm font-normal leading-relaxed tracking-normal text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0";
