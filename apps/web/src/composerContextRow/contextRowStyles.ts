// V1's context bar look (`BranchToolbar.styles.ts` there): regular text-sm,
// muted, no fills, brighter on hover or while open, in the composer's text
// tokens (`theme.upcomputer.css`).

const CONTEXT_ROW_TONE =
  "text-(--composer-muted) hover:text-(--composer-bright) aria-expanded:text-(--composer-bright)";

export const CONTEXT_ROW_ICON_BUTTON_CLASS = `inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${CONTEXT_ROW_TONE}`;

/**
 * Upstream's checkout, environment and branch controls inside the row, in
 * V1's form: text only (no icons or chevrons), text-sm at regular weight, no
 * fill. The selectors and their menus stay upstream's.
 */
export const CONTEXT_ROW_QUIET_CONTROLS_CLASS =
  "flex min-w-0 items-center [&_[data-composer-context-control]_svg]:hidden [&_button_svg]:hidden [&_[data-composer-context-control]]:text-sm [&_button]:text-sm [&_[data-composer-context-control]]:font-normal [&_button]:font-normal [&_[data-composer-context-control]]:text-(--composer-muted) [&_button]:text-(--composer-muted) [&_button:hover]:bg-transparent [&_button:hover]:text-(--composer-bright) [&_button[data-popup-open]]:bg-transparent [&_button[data-popup-open]]:text-(--composer-bright) [&_button]:h-8 [&_button]:px-2";

export const CONTEXT_ROW_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-(--composer-separator)";
