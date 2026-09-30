import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "../sidebar/sidebarTextStyles";

// The row clips instead of scrolling: hidden blocks and labels stay mounted out
// of flow for measurement and must not make the row scrollable.
export const COMPOSER_CONTROL_ROW_CLASS =
  "relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-clip";

export const COMPOSER_CONTROL_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-foreground/35 dark:bg-border";

export const COMPOSER_CONTROL_ICON_TRIGGER_CLASS = `flex size-8 shrink-0 items-center justify-center rounded-full border-transparent !bg-transparent p-2 ${SIDEBAR_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 before:hidden [&_svg]:mx-0`;

export const COMPOSER_CONTROL_TEXT_TRIGGER_CLASS = `h-8 min-h-0 min-w-0 shrink-0 justify-start gap-1 overflow-hidden rounded-lg border-transparent !bg-transparent px-2 py-[7px] text-left ${SIDEBAR_LABEL_TEXT_CLASS} ${SIDEBAR_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 before:hidden [&_svg]:mx-0 [&_[data-composer-control-chevron]]:hidden`;
