/*
 * V1's composer look, ported from V1's `components/chat/composerControlStyles.ts`,
 * `ComposerPrimaryActions.tsx` and the composer card in `ChatComposer.tsx`.
 * The UpComputer composer surface applies these over upstream's controls; the
 * controls and their logic stay upstream's.
 */

/** V1's `SIDEBAR_LABEL_TEXT_CLASS`: the controls read at the sidebar rows' text size. */
const V1_LABEL_TEXT_CLASS = "text-sm font-normal leading-relaxed tracking-normal";

/** V1's `SIDEBAR_MUTED_TEXT_CLASS`, the quiet tone of every control at rest. */
const V1_MUTED_TEXT_CLASS = "text-muted-foreground dark:text-white/50";

// The row clips instead of scrolling: hidden blocks and labels stay mounted out
// of flow for measurement and must not make the row scrollable.
export const COMPOSER_CONTROL_ROW_CLASS =
  "relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-clip";

export const COMPOSER_CONTROL_SEPARATOR_CLASS = "h-3 w-px shrink-0 bg-foreground/35 dark:bg-border";

/** The paperclip and the overflow menu: an icon with no fill, bright on hover or while open. */
export const COMPOSER_CONTROL_ICON_TRIGGER_CLASS = `flex size-8 shrink-0 items-center justify-center rounded-full border-transparent !bg-transparent p-2 ${V1_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 before:hidden [&_svg]:mx-0`;

/**
 * Mode, provider and model, effort and context, access: text with no fill and
 * no chevron, bright on hover or while open. Beyond V1: Plan is a pressed
 * toggle here (V1 had a menu), and icons follow the text tone.
 */
export const COMPOSER_CONTROL_TEXT_TRIGGER_CLASS = `h-8 min-h-0 min-w-0 shrink-0 justify-start gap-1 overflow-hidden rounded-lg border-transparent !bg-transparent px-2 py-[7px] text-left ${V1_LABEL_TEXT_CLASS} ${V1_MUTED_TEXT_CLASS} shadow-none transition-colors hover:!bg-transparent hover:!text-foreground dark:hover:!text-white/86 focus-visible:!ring-0 focus-visible:ring-offset-0 data-pressed:!bg-transparent data-pressed:!text-foreground dark:data-pressed:!text-white/86 aria-expanded:!bg-transparent aria-expanded:!text-foreground dark:aria-expanded:!text-white/86 aria-pressed:!bg-transparent aria-pressed:!text-foreground dark:aria-pressed:!text-white/86 before:hidden [&_svg]:mx-0 [&_svg:not([class*='text-'])]:text-current [&_[data-composer-control-chevron]]:hidden`;

/** V1's model picker trigger width. */
export const COMPOSER_MODEL_PICKER_TRIGGER_CLASS = `${COMPOSER_CONTROL_TEXT_TRIGGER_CLASS} max-w-52 shrink sm:max-w-60`;

/** V1's footer padding under the prompt. */
export const COMPOSER_FOOTER_PADDING_CLASS = "px-2.5 pb-2.5 sm:px-4 sm:pb-4";

/** V1's prompt padding inside the card; it overrides upstream's on the prompt body. */
export const COMPOSER_BODY_PADDING_CLASS = "sm:px-6 sm:pt-6";

/** V1's one-line prompt minimum: the card grows with the text from there. */
export const COMPOSER_EDITOR_CLASS = "min-h-8";

/** V1's placeholder tone. */
export const COMPOSER_PLACEHOLDER_CLASS = "text-muted-foreground/35";

/** V1's composer card: opaque, 32px corners, a border in light and an inset highlight in dark. */
export const COMPOSER_CARD_CLASS =
  "rounded-[32px] bg-card shadow-[0_4px_14.4px_rgba(9,9,9,0.035)] not-dark:border not-dark:border-border dark:bg-[#1e1e1e] dark:shadow-[inset_-1px_-1px_1px_rgba(255,255,255,0.06),inset_1px_1px_1px_rgba(255,255,255,0.12),0_4px_14.4px_rgba(9,9,9,0.08)]";

/**
 * On upstream's composer shell: its translucent glass backdrop and the host's
 * outline and shadow give way to the card, and the frame follows its corners.
 */
export const COMPOSER_SHELL_CLASS =
  "before:hidden [&_[data-slot=composer-host]]:shadow-none [&_[data-slot=composer-host]]:after:hidden [&_[data-chat-composer-main-surface]]:rounded-[32px]";

/** V1's send button; `canSend` is whether a click would act. */
export function composerSendButtonClass(canSend: boolean): string {
  return [
    "flex size-8 shrink-0 items-center justify-center rounded-full bg-[#d4d4d4] text-[#171717] not-dark:bg-[#c4c4c4] not-dark:text-white",
    "shadow-[inset_0_-1px_1px_rgba(0,0,0,0.17),inset_0_1px_1px_white] not-dark:shadow-[inset_0_-1px_1px_rgba(255,255,255,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]",
    "transition-opacity duration-150 disabled:pointer-events-none [&_svg]:pointer-events-none",
    canSend ? "enabled:cursor-pointer opacity-100 not-dark:bg-[#222222]" : "opacity-40",
  ].join(" ");
}

/**
 * V1's fade behind the docked composer and the row under it, from the
 * composer's middle down. V1 ran 80% to 100% over the whole height, which let
 * the chat show faintly between the card and the row; this is opaque from a
 * fifth of the way down, still behind the card.
 */
export const COMPOSER_BACKDROP_FADE_CLASS =
  "mx-auto h-full w-full max-w-(--chat-content-max-width) bg-linear-to-b from-background/80 to-background to-20%";
