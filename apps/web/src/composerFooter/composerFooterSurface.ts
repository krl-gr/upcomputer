import type { ProviderInstanceId } from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { resolveModelPickerSelectedModel } from "../components/chat/ModelPickerContent";
import { getTriggerDisplayModelName, type ModelEsque } from "../components/chat/providerIconUtils";
import type { ProviderInstanceEntry } from "../providerInstances";
import { productSurface } from "../product/productFlags";
import {
  COMPOSER_BODY_PADDING_CLASS,
  COMPOSER_BOTTOM_SPACE_CLASS,
  COMPOSER_BOTTOM_SPACE_WITH_ROW_CLASS,
  COMPOSER_CARD_CLASS,
  COMPOSER_EDITOR_CLASS,
  COMPOSER_PLACEHOLDER_CLASS,
  COMPOSER_SHELL_CLASS,
  V1_COMPOSER_EXTRA_WIDTH,
  composerSendButtonClass,
} from "./composerLookStyles";

/*
 * The `composerFooter` surface's decisions, read by the hooks in upstream's
 * `components/chat/ChatComposer.tsx`. With `upstream` each one returns
 * exactly what upstream's composer did.
 */

export const NEW_THREAD_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";
export const FOLLOW_UP_COMPOSER_PLACEHOLDER = "Ask for follow-up changes or attach images";

/**
 * Whether the composer renders the UpComputer footer row. The resting row a
 * timeline scroll collapses the composer into stays upstream's; with the
 * UpComputer surface the composer never rests (`composerCollapsesOnScroll`).
 */
export function showsUpComputerComposerFooter(isComposerResting: boolean): boolean {
  return !isComposerResting && productSurface("composerFooter") === "upcomputer";
}

/**
 * Whether a timeline scroll may rest the composer into upstream's one-line
 * form, as upstream's "Collapse composer on scroll" setting asks. V1's
 * composer always stays whole, so with its surface the setting is hidden too.
 */
export function composerCollapsesOnScroll(): boolean {
  return productSurface("composerFooter") !== "upcomputer";
}

const COMPOSER_LOOK_CLASSES = {
  shell: COMPOSER_SHELL_CLASS,
  card: COMPOSER_CARD_CLASS,
  body: COMPOSER_BODY_PADDING_CLASS,
  editor: COMPOSER_EDITOR_CLASS,
  placeholder: COMPOSER_PLACEHOLDER_CLASS,
} as const;

/** V1's classes for one part of upstream's composer; nothing with `upstream`. */
export function composerLookClass(part: keyof typeof COMPOSER_LOOK_CLASSES): string | undefined {
  return productSurface("composerFooter") === "upcomputer"
    ? COMPOSER_LOOK_CLASSES[part]
    : undefined;
}

/**
 * The composer's width, V1's amount wider than the messages. Upstream sizes
 * the timeline and every composer piece from `--chat-content-max-width` (the
 * chat width setting). The overlay derives `--chat-composer-max-width` from
 * it, and the lane inside sets `--chat-content-max-width` to that, so
 * upstream's composer, the row under it and the fade all follow. Two
 * elements, because a custom property cannot refer to itself.
 */
export function composerWidthStyle(element: "overlay" | "lane"): CSSProperties | undefined {
  if (productSurface("composerFooter") !== "upcomputer") return undefined;
  const properties: Record<string, string> =
    element === "overlay"
      ? {
          "--chat-composer-max-width": `calc(var(--chat-content-max-width) + ${V1_COMPOSER_EXTRA_WIDTH})`,
        }
      : { "--chat-content-max-width": "var(--chat-composer-max-width)" };
  return properties as CSSProperties;
}

/** V1's space under the composer stack; null keeps upstream's. */
export function composerBottomSpaceClass(hasContextRow: boolean): string | null {
  if (productSurface("composerFooter") !== "upcomputer") return null;
  return hasContextRow ? COMPOSER_BOTTOM_SPACE_WITH_ROW_CLASS : COMPOSER_BOTTOM_SPACE_CLASS;
}

/** V1's send button for upstream's send, steer and queue states; null keeps upstream's. */
export function composerSendButtonSurfaceClass(canSend: boolean): string | null {
  return productSurface("composerFooter") === "upcomputer"
    ? composerSendButtonClass(canSend)
    : null;
}

/** The prompt's idle placeholder; V1 asked for follow-ups in an existing thread. */
export function composerIdlePlaceholder(isExistingThread: boolean): string {
  return isExistingThread && productSurface("composerFooter") === "upcomputer"
    ? FOLLOW_UP_COMPOSER_PLACEHOLDER
    : NEW_THREAD_COMPOSER_PLACEHOLDER;
}

/**
 * "Claude · Claude Opus 5.5": the provider and model in one label, as V1's
 * picker showed them. Null when the picker should keep upstream's trigger.
 */
export function composerModelPickerLabel(input: {
  activeInstanceId: ProviderInstanceId;
  model: string;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
}): string | null {
  const entry = input.instanceEntries.find(
    (candidate) => candidate.instanceId === input.activeInstanceId,
  );
  if (!entry) return null;
  const options = input.modelOptionsByInstance.get(input.activeInstanceId) ?? [];
  // The same fallback upstream's trigger uses for its model name.
  const selected =
    resolveModelPickerSelectedModel({
      driverKind: entry.driverKind,
      model: input.model,
      options,
    }) ??
    (entry.driverKind === "opencode" || entry.driverKind === "antigravity"
      ? undefined
      : options[0]);
  const modelName = selected
    ? `${getTriggerDisplayModelName(selected)}${selected.isUnavailable ? " (Unavailable)" : ""}`
    : input.model || "Choose model";
  return `${entry.displayName} · ${modelName}`;
}
