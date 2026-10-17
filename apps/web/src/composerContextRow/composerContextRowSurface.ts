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
 * Whether the empty draft's hero shows upstream's "No project" picker under
 * its heading. With our surface that line reads "or pick a project", or "or
 * add a project" before there is one, and moves the draft into the project
 * (`useRetargetDraftToProject`, as the header's project list does).
 */
export function showsDraftHeroNoProjectPicker(): boolean {
  return !showsUpComputerComposerContextRow();
}

/**
 * Whether the hero's project picker lists "No project" first, as V1's did.
 * Upstream moved that choice to the line under the heading; with our row the
 * picker keeps it too, so a project draft leaves its project from the picker.
 */
export function showsDraftHeroNoProjectItem(): boolean {
  return showsUpComputerComposerContextRow();
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
