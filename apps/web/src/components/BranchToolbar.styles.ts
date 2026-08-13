import { SIDEBAR_LABEL_TEXT_CLASS, SIDEBAR_MUTED_TEXT_CLASS } from "./sidebar/sidebarTextStyles";

export const CONTEXT_BAR_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-foreground/35 dark:bg-border";

// Keep text rendered by different primitives (button, select, or plain text)
// on one explicit contract instead of inheriting each primitive's defaults.
export const CONTEXT_BAR_TEXT_CLASS = `font-sans ${SIDEBAR_LABEL_TEXT_CLASS} !text-sm sm:!text-sm !font-normal !leading-relaxed !tracking-normal`;

const CONTEXT_BAR_TEXT_TRIGGER_BASE_CLASS = `h-8 min-h-0 min-w-0 justify-start gap-1 overflow-hidden rounded-lg border-transparent !bg-transparent px-2 py-[7px] text-left ${CONTEXT_BAR_TEXT_CLASS} ${SIDEBAR_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 before:hidden [&_svg]:mx-0 [&_svg:not([class*='opacity-'])]:opacity-100`;

export const CONTEXT_BAR_TEXT_TRIGGER_CLASS = `${CONTEXT_BAR_TEXT_TRIGGER_BASE_CLASS} shrink-0`;

export const CONTEXT_BAR_BRANCH_TRIGGER_CLASS = `${CONTEXT_BAR_TEXT_TRIGGER_BASE_CLASS} w-full flex-1 shrink max-w-full`;

export const CONTEXT_BAR_ICON_TRIGGER_CLASS = `flex size-8 shrink-0 items-center justify-center rounded-lg border-transparent !bg-transparent p-2 ${SIDEBAR_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 before:hidden [&_svg]:mx-0 [&_svg:not([class*='opacity-'])]:opacity-100`;
