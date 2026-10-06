// V1's context bar look (`BranchToolbar.styles.ts` there): regular text-sm,
// muted, no fills, brighter on hover or while open.

const CONTEXT_ROW_TONE =
  "text-muted-foreground dark:text-white/50 hover:text-foreground dark:hover:text-white/86 aria-expanded:text-foreground dark:aria-expanded:text-white/86";

export const CONTEXT_ROW_ICON_BUTTON_CLASS = `inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${CONTEXT_ROW_TONE}`;

/** The right-panel toggle: the icon button, bright while the panel is open. */
export const CONTEXT_ROW_TOGGLE_CLASS = `${CONTEXT_ROW_ICON_BUTTON_CLASS} aria-pressed:text-foreground dark:aria-pressed:text-white/86`;

/**
 * Upstream's checkout, environment and branch controls inside the row, in
 * V1's form: text only (no icons or chevrons), text-sm at regular weight, no
 * fill. The selectors and their menus stay upstream's.
 */
export const CONTEXT_ROW_QUIET_CONTROLS_CLASS =
  "flex min-w-0 items-center [&_[data-composer-context-control]_svg]:hidden [&_button_svg]:hidden [&_[data-composer-context-control]]:text-sm [&_button]:text-sm [&_[data-composer-context-control]]:font-normal [&_button]:font-normal [&_[data-composer-context-control]]:text-muted-foreground dark:[&_[data-composer-context-control]]:text-white/50 [&_button]:text-muted-foreground dark:[&_button]:text-white/50 [&_button:hover]:bg-transparent [&_button:hover]:text-foreground dark:[&_button:hover]:text-white/86 [&_button[data-popup-open]]:bg-transparent [&_button[data-popup-open]]:text-foreground dark:[&_button[data-popup-open]]:text-white/86 [&_button]:h-8 [&_button]:px-2";

export const CONTEXT_ROW_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-foreground/35 dark:bg-border";
