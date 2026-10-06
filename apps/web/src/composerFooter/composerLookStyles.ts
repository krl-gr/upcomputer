/*
 * V1's composer look, ported from V1's `components/chat/composerControlStyles.ts`,
 * `ComposerPrimaryActions.tsx` and the composer card in `ChatComposer.tsx`.
 * The UpComputer composer surface applies these over upstream's controls; the
 * controls and their logic stay upstream's.
 */

/** V1's `SIDEBAR_LABEL_TEXT_CLASS`: the controls read at the sidebar rows' text size. */
const V1_LABEL_TEXT_CLASS = "text-sm font-normal leading-relaxed tracking-normal";

/**
 * V1's `SIDEBAR_MUTED_TEXT_CLASS`, the quiet tone of every control at rest, and
 * its bright tone on hover, while open or pressed. The colors are the theme's
 * composer tokens (`theme.upcomputer.css`), as is every color in this file.
 */
const V1_MUTED_TEXT_CLASS = "text-(--composer-muted)";
const V1_BRIGHT_TEXT_CLASS =
  "hover:!text-(--composer-bright) data-pressed:!text-(--composer-bright) aria-expanded:!text-(--composer-bright)";

// The row clips instead of scrolling: hidden blocks and labels stay mounted out
// of flow for measurement and must not make the row scrollable.
export const COMPOSER_CONTROL_ROW_CLASS =
  "relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-clip";

/**
 * V1's separator. It sits the row's gap from its neighbours, whose content
 * starts 8px inside them, so it has 10px on both sides.
 */
export const COMPOSER_CONTROL_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-(--composer-separator)";

/** The paperclip and the overflow menu: an icon with no fill, bright on hover or while open. */
export const COMPOSER_CONTROL_ICON_TRIGGER_CLASS = `flex size-8 shrink-0 items-center justify-center rounded-full border-transparent !bg-transparent p-2 ${V1_MUTED_TEXT_CLASS} ${V1_BRIGHT_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent aria-expanded:!bg-transparent before:hidden [&_svg]:mx-0`;

/**
 * Mode, provider and model, effort and context, access: text with no fill and
 * no chevron, bright on hover or while open. Beyond V1: Plan is a pressed
 * toggle here (V1 had a menu), and icons follow the text tone. No border, so
 * the content starts 8px in, as in the icon triggers: upstream's control has
 * a transparent 1px one. A chevron's own wrapper goes with it, or its flex
 * gap would stay.
 */
export const COMPOSER_CONTROL_TEXT_TRIGGER_CLASS = `h-8 min-h-0 min-w-0 shrink-0 justify-start gap-1 overflow-hidden rounded-lg border-0 !bg-transparent px-2 py-[7px] text-left ${V1_LABEL_TEXT_CLASS} ${V1_MUTED_TEXT_CLASS} ${V1_BRIGHT_TEXT_CLASS} aria-pressed:!text-(--composer-bright) shadow-none transition-colors hover:!bg-transparent focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent aria-expanded:!bg-transparent aria-pressed:!bg-transparent before:hidden [&_svg]:mx-0 [&_svg:not([class*='text-'])]:text-current [&_[data-composer-control-chevron]]:hidden [&>[aria-hidden]:has(>[data-composer-control-chevron])]:hidden`;

/** V1's model picker trigger width. */
export const COMPOSER_MODEL_PICKER_TRIGGER_CLASS = `${COMPOSER_CONTROL_TEXT_TRIGGER_CLASS} max-w-52 shrink sm:max-w-60`;

/** V1's footer padding under the prompt. */
export const COMPOSER_FOOTER_PADDING_CLASS = "px-2.5 pb-2.5 sm:px-4 sm:pb-4";

/** V1's prompt padding inside the card; it overrides upstream's on the prompt body. */
export const COMPOSER_BODY_PADDING_CLASS = "sm:px-6 sm:pt-6";

/** V1's one-line prompt minimum: the card grows with the text from there. */
export const COMPOSER_EDITOR_CLASS = "min-h-8";

/**
 * V1's placeholder: its tone, on one line that ends in an ellipsis when the
 * composer is narrow, so it never wraps into the footer row. Typed text wraps.
 */
export const COMPOSER_PLACEHOLDER_CLASS = "truncate text-muted-foreground/35";

/** V1's composer card: opaque, 32px corners, a border in light and an inset highlight in dark. */
export const COMPOSER_CARD_CLASS =
  "rounded-[32px] bg-(--composer-surface) shadow-(--composer-shadow) not-dark:border not-dark:border-border";

/**
 * On upstream's composer shell: its translucent glass backdrop and the host's
 * outline and shadow give way to the card, and the frame follows its corners.
 */
export const COMPOSER_SHELL_CLASS =
  "before:hidden [&_[data-slot=composer-host]]:shadow-none [&_[data-slot=composer-host]]:after:hidden [&_[data-chat-composer-main-surface]]:rounded-[32px]";

/** V1's send button; `canSend` is whether a click would act. */
export function composerSendButtonClass(canSend: boolean): string {
  return [
    "flex size-8 shrink-0 items-center justify-center rounded-full text-(--composer-send-foreground) shadow-(--composer-send-shadow)",
    "transition-opacity duration-150 disabled:pointer-events-none [&_svg]:pointer-events-none",
    canSend
      ? "enabled:cursor-pointer bg-(--composer-send) opacity-100"
      : "bg-(--composer-send-idle) opacity-40",
  ].join(" ");
}

/**
 * V1's fade behind the docked composer and the row under it, from the
 * composer's middle down. V1 ran 80% to 100% over the whole height, which let
 * the chat show faintly between the card and the row; this is opaque from a
 * fifth of the way down, still behind the card.
 */
export const COMPOSER_BACKDROP_FADE_CLASS =
  "mx-auto h-full w-full max-w-(--chat-composer-max-width) bg-linear-to-b from-background/80 to-background to-20%";

/**
 * How much wider than the messages V1's composer was: `max-w-208` (52rem) in
 * `ChatComposer.tsx` against the timeline's `max-w-3xl` (48rem) in
 * `MessagesTimeline.tsx`. Added to upstream's chat width setting, so the
 * composer stays this much wider at every width.
 */
export const V1_COMPOSER_EXTRA_WIDTH = "4rem";

/**
 * V1's space from the bottom of the composer stack to the window
 * (`ChatView.tsx`): a quarter rem under the row, which has its own `pb-1`,
 * and 0.75rem, 1rem from `sm`, when no row is shown.
 */
export const COMPOSER_BOTTOM_SPACE_WITH_ROW_CLASS = "h-[calc(env(safe-area-inset-bottom)+0.25rem)]";
export const COMPOSER_BOTTOM_SPACE_CLASS =
  "h-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:h-[calc(env(safe-area-inset-bottom)+1rem)]";
