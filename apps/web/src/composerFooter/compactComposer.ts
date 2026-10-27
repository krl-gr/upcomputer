import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

import { isInsideRestingComposerControlScope } from "../components/chat/composerEventScope";
import { observeResize } from "../lib/observeResize";
import { productSurface } from "../product/productFlags";

/*
 * The UpComputer composer's compact form: one row of paperclip, prompt and
 * send while the composer is idle. It only restyles the composer, so the
 * prompt editor stays the same element in both forms and keeps its draft,
 * selection and IME state.
 */

export interface CompactComposerInput {
  /** The "Compact composer" setting. */
  enabled: boolean;
  /** Focus is in the composer or in one of its menus, popovers or drawers. */
  isFocusWithin: boolean;
  hasMultilinePrompt: boolean;
  /** Images, files, terminal contexts or pending snapshots in the draft. */
  hasAttachments: boolean;
  /** An approval, a question or a plan waits for the user. */
  hasPendingRequest: boolean;
  /** A menu, drawer, drag-over, error or banner that needs the full composer. */
  hasExpandedChrome: boolean;
}

export function isComposerCompact(input: CompactComposerInput): boolean {
  return (
    input.enabled &&
    productSurface("composerFooter") === "upcomputer" &&
    !input.isFocusWithin &&
    !input.hasMultilinePrompt &&
    !input.hasAttachments &&
    !input.hasPendingRequest &&
    !input.hasExpandedChrome
  );
}

export function isFocusWithinComposer(
  form: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!form || !(target instanceof Node)) return false;
  return form.contains(target) || isInsideRestingComposerControlScope(target);
}

/**
 * Whether focus is in the composer form or a menu it portaled out of it.
 * Checked a frame after focus moves: closing a menu briefly leaves focus on
 * the body before the menu hands it back to the prompt.
 */
export function useComposerFocusWithin(formRef: RefObject<HTMLFormElement | null>): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    let frame: number | null = null;
    const check = () => {
      frame = null;
      setFocused(isFocusWithinComposer(formRef.current, document.activeElement));
    };
    const onFocusChange = (event: FocusEvent) => {
      // Entering is immediate, so the full composer is there before the first key lands.
      if (event.type === "focusin" && isFocusWithinComposer(formRef.current, event.target)) {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        setFocused(true);
        return;
      }
      if (frame === null) frame = window.requestAnimationFrame(check);
    };
    check();
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
    };
  }, [formRef]);
  return focused;
}

/**
 * Publishes the width of the footer's actions on the composer card as
 * `--composer-compact-actions-width`, so the prompt in the compact row ends
 * before the send, stop or queue actions overlaid on it.
 */
export function useCompactComposerActionsWidth(
  actions: HTMLElement | null,
  compact: boolean,
): void {
  useLayoutEffect(() => {
    const card = actions?.closest<HTMLElement>('[data-chat-composer-surface="true"]');
    if (!actions || !card || !compact) return;
    const publish = () =>
      card.style.setProperty("--composer-compact-actions-width", `${actions.offsetWidth}px`);
    publish();
    const stop = observeResize(actions, publish);
    return () => {
      stop();
      card.style.removeProperty("--composer-compact-actions-width");
    };
  }, [actions, compact]);
}

/*
 * The compact row's geometry. The footer overlays the card, centred on the
 * prompt, with only the paperclip and the actions visible; the prompt keeps
 * its horizontal padding so wrapping is measured against the full width
 * (`measureComposerMultilinePrompt`) and the two forms cannot flip each other.
 * Its inner row makes room for the paperclip and actions instead.
 */
const COMPACT_COMPOSER_CLASSES = {
  /**
   * One 24px prompt line in a 50px row, twice the card's corner radius, so
   * the row is a pill and the 32px paperclip and send sit 9px from its edge on
   * every side. The light card's 1px border counts towards the 50px; `!`
   * outranks the expanded body's `sm:` padding.
   */
  body: "py-3! dark:py-3.25!",
  /**
   * The paperclip ends 9px plus 32px into the card and the prompt body starts
   * 16px inside it (17px with the light border). The text keeps 4px from the
   * paperclip, whose icon has its own padding, and 10px from the filled send.
   */
  prompt: "ps-7 pe-[calc(var(--composer-compact-actions-width,2rem)+2px)]",
  /**
   * One line, fading out at the end: Chrome drops `text-overflow` on an
   * editable line once it is laid out again, so an ellipsis would come and go.
   */
  editor:
    "max-h-8 overflow-hidden whitespace-pre! leading-6 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)]",
  placeholder: "leading-6",
} as const;

export function compactComposerClass(
  part: keyof typeof COMPACT_COMPOSER_CLASSES,
  compact: boolean,
): string | undefined {
  return compact ? COMPACT_COMPOSER_CLASSES[part] : undefined;
}
