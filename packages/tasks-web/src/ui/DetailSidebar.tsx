import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "../../../../apps/web/src/lib/utils.ts";

/** Max time a collapsed section waits for async child readiness before sliding open anyway. */
export const DETAIL_SECTION_READY_FALLBACK_MS = 300;

/**
 * The right Details column of the task, agent and automation views. It has no
 * surface of its own: it sits on the page background with the regular
 * foreground, separated from the main content by a hairline as upstream's
 * docked panels are. `stacked` puts it under the main content instead, for a
 * view too narrow for two columns.
 */
export function DetailColumn({
  children,
  stacked = false,
}: {
  readonly children: ReactNode;
  readonly stacked?: boolean | undefined;
}) {
  return (
    <aside
      className={
        stacked
          ? "min-w-0 text-foreground"
          : "min-h-0 w-[380px] shrink-0 overflow-y-auto border-l border-border pl-3 text-foreground"
      }
    >
      {children}
    </aside>
  );
}

export function DetailSidebarSection({
  title,
  count,
  defaultOpen = true,
  contentReady = true,
  onWarm,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly defaultOpen?: boolean | undefined;
  /** False while a lazy child (such as the description editor) is still mounting its initial DOM. */
  readonly contentReady?: boolean | undefined;
  /** Called on pointer enter or focus while unmounted to preload async assets without mounting children. */
  readonly onWarm?: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  const [settledOpen, setSettledOpen] = useState(defaultOpen);
  if (open && !mounted) setMounted(true);
  // A section that starts collapsed waits for async child DOM before its first slide open, avoiding a mid-motion height jump.
  const expanded = open && (settledOpen || contentReady);
  if (expanded && !settledOpen) setSettledOpen(true);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the first-open readiness gate after 300ms if an async child stalls
  useEffect(() => {
    if (!open || settledOpen || contentReady) return;
    const timer = setTimeout(() => setSettledOpen(true), DETAIL_SECTION_READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [open, settledOpen, contentReady]);

  const warm = !mounted ? onWarm : undefined;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        onPointerEnter={warm}
        onFocus={warm}
        className="flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left text-sm font-normal leading-relaxed tracking-normal text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="min-w-0 truncate">{title}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-drawer motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        {count === undefined ? null : <span className="ml-auto text-sm tabular-nums">{count}</span>}
      </button>
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-drawer motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        data-detail-sidebar-section-panel=""
        data-open={expanded}
        inert={!expanded}
      >
        {/* Hidden only once the closing motion ends: content-visibility switches discretely. */}
        <div
          className={cn(
            "min-h-0 min-w-0 overflow-clip transition-[content-visibility] transition-discrete duration-200 motion-reduce:transition-none",
            !expanded && "[content-visibility:hidden]",
          )}
        >
          <div className="min-w-0 pb-3">{mounted ? children : null}</div>
        </div>
      </div>
    </div>
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
              const target = event.target;
              // A pick in the control's portaled popup bubbles here through React; it would reopen it.
              if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
              onClick?.();
              if (!controlSelector) return;
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
