import { type RefObject, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { isInsideRestingComposerControlScope } from "../components/chat/composerEventScope";
import { observeResize } from "../lib/observeResize";
import { productSurface } from "../product/productFlags";

/*
 * The UpComputer composer's compact form in bot chats: one row of paperclip,
 * prompt and send, typed in for as long as the content fits it. It only
 * restyles the composer, so the prompt editor stays the same element in both
 * forms and keeps its draft, selection and IME state.
 */

export interface CompactComposerInput {
  /** The chat is a bot's (`useCompactComposerChat`); other threads always get the full composer. */
  isBotChat: boolean;
  /** The stored `composerCompact` setting, drawn as "Full composer in bot chats" turned off. */
  enabled: boolean;
  hasMultilinePrompt: boolean;
  /** Images, files, terminal contexts or pending snapshots in the draft. */
  hasAttachments: boolean;
  /** An approval, a question or a plan waits for the user. */
  hasPendingRequest: boolean;
  /** Its controls were asked for, or a menu, drag-over or error needs the full composer. */
  hasExpandedChrome: boolean;
}

export function isComposerCompact(input: CompactComposerInput): boolean {
  return (
    input.isBotChat &&
    input.enabled &&
    productSurface("composerFooter") === "upcomputer" &&
    !input.hasMultilinePrompt &&
    !input.hasAttachments &&
    !input.hasPendingRequest &&
    !input.hasExpandedChrome
  );
}

/* Chats whose composer can rest as the compact row, by scoped thread key: bot chats, marked by their header. */
const compactChats = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setCompactChat(threadKey: string, delta: 1 | -1) {
  const count = (compactChats.get(threadKey) ?? 0) + delta;
  if (count > 0) compactChats.set(threadKey, count);
  else compactChats.delete(threadKey);
  for (const listener of listeners) listener();
}

/** While mounted, the chat's composer can rest as the compact row; null marks nothing. */
export function useCompactComposerChat(threadKey: string | null): void {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the chat in the module store the composer reads
  useEffect(() => {
    if (threadKey === null) return;
    setCompactChat(threadKey, 1);
    return () => setCompactChat(threadKey, -1);
  }, [threadKey]);
}

export function useIsCompactComposerChat(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): boolean {
  const threadKey = threadId ? scopedThreadKey(scopeThreadRef(environmentId, threadId)) : null;
  return useSyncExternalStore(
    subscribe,
    () => threadKey !== null && compactChats.has(threadKey),
    () => false,
  );
}

function isFocusWithinComposer(form: HTMLElement | null, target: EventTarget | null): boolean {
  if (!form || !(target instanceof Node)) return false;
  return form.contains(target) || isInsideRestingComposerControlScope(target);
}

/**
 * Whether focus is in the composer form or a menu it portaled out of it.
 * Checked a frame after focus moves: closing a menu briefly leaves focus on
 * the body before the menu hands it back to the prompt.
 */
function useComposerFocusWithin(formRef: RefObject<HTMLFormElement | null>): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    let frame: number | null = null;
    const check = () => {
      frame = null;
      setFocused(isFocusWithinComposer(formRef.current, document.activeElement));
    };
    const onFocusChange = (event: FocusEvent) => {
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
 * The compact row's controls button: it shows the full composer, with the
 * model and its other controls, until focus leaves the composer and its menus.
 */
export function useCompactComposerControls(
  formRef: RefObject<HTMLFormElement | null>,
): readonly [shown: boolean, show: () => void] {
  const isFocusWithin = useComposerFocusWithin(formRef);
  const [shown, setShown] = useState(false);
  const [wasFocusWithin, setWasFocusWithin] = useState(isFocusWithin);
  if (wasFocusWithin !== isFocusWithin) {
    setWasFocusWithin(isFocusWithin);
    if (!isFocusWithin) setShown(false);
  }
  return [shown, () => setShown(true)] as const;
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
 * The compact row's geometry: the footer overlays the card with only the paperclip and the
 * actions visible. The prompt keeps its padding so wrapping is measured at full width and the
 * two forms cannot flip each other.
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
