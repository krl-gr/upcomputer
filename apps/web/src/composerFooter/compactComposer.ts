import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

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
  /** The one-line prompt reaches the compact row's fade (`useCompactPromptReachesFade`). */
  hasLongPrompt: boolean;
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
    !input.hasLongPrompt &&
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

export interface CompactPromptMeasurement {
  /** The compact row is showing, so `compactLineWidth` is measured. */
  readonly compact: boolean;
  readonly textWidth: number;
  /** The full composer's prompt line. */
  readonly fullLineWidth: number;
  /** The compact row's prompt line up to its fade. */
  readonly compactLineWidth: number;
}

/**
 * Whether a one-line prompt reaches the compact row's fade. The full form has
 * no compact line to measure, so it keeps how much shorter that line was when
 * last compact: both forms apply the same limit and cannot flip each other.
 */
export function createCompactPromptFit(): (measurement: CompactPromptMeasurement) => boolean {
  let shortfall: number | null = null;
  return (measurement) => {
    if (measurement.compact) shortfall = measurement.fullLineWidth - measurement.compactLineWidth;
    return shortfall !== null && measurement.textWidth > measurement.fullLineWidth - shortfall;
  };
}

const px = (value: string) => Number.parseFloat(value) || 0;

/** From the first character to the last: the range of the editor's contents spans its paragraph's box. */
function textWidth(editor: HTMLElement): number {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let first: Node | null = null;
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue) continue;
    first ??= node;
    last = node;
  }
  if (!first || !last) return 0;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.nodeValue?.length ?? 0);
  return range.getBoundingClientRect().width;
}

/** Whether the prompt reaches the compact row's fade, and the ref callback that measures it on the composer body. */
export function useCompactPromptReachesFade(): readonly [
  boolean,
  (body: HTMLElement | null) => (() => void) | undefined,
] {
  const [reachesFade, setReachesFade] = useState(false);
  const [fit] = useState(createCompactPromptFit);
  const observeBody = (body: HTMLElement | null) => {
    const editor = body?.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    if (!body || !editor) return;
    const measure = () => {
      if (editor.clientWidth === 0) return;
      const bodyStyle = getComputedStyle(body);
      const editorStyle = getComputedStyle(editor);
      const fade = COMPACT_FADE_REM * px(getComputedStyle(document.documentElement).fontSize);
      setReachesFade(
        fit({
          compact:
            body
              .closest('[data-chat-composer-surface="true"]')
              ?.querySelector('[data-composer-footer-compact="true"]') != null,
          textWidth: textWidth(editor),
          fullLineWidth: body.clientWidth - px(bodyStyle.paddingLeft) - px(bodyStyle.paddingRight),
          compactLineWidth:
            editor.clientWidth - px(editorStyle.paddingLeft) - px(editorStyle.paddingRight) - fade,
        }),
      );
    };
    measure();
    const stopObserving = observeResize([body, editor], measure);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      stopObserving();
      mutationObserver.disconnect();
    };
  };
  return [reachesFade, observeBody] as const;
}

/** The width of the editor's fade in the compact row: the `1.5rem` of its mask. */
const COMPACT_FADE_REM = 1.5;

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
