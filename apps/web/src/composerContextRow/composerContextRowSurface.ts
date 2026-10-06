import { productSurface } from "../product/productFlags";

/*
 * The `composerContextRow` surface's decisions, read by the hooks in upstream's
 * `components/ChatView.tsx` and `components/chat/ChatComposer.tsx`. With
 * `upstream` each one returns exactly what upstream did.
 */

/** Whether V1's row sits under the composer instead of upstream's context strip. */
export function showsUpComputerComposerContextRow(): boolean {
  return productSurface("composerContextRow") === "upcomputer";
}

/**
 * Where the composer's control shortcuts (`composer.workspace`, `composer.host`)
 * look for their trigger. Our row sits under the composer shell, so with it the
 * scope is the whole composer stack.
 */
export function composerShortcutScope(form: Element | null | undefined): Element | null {
  if (!form) return null;
  return (
    (showsUpComputerComposerContextRow()
      ? form.closest('[data-chat-composer-stack="true"]')
      : null) ?? form.closest('[data-slot="composer-shell"]')
  );
}
