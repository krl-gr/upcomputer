import type { ProviderInstanceId } from "@t3tools/contracts";

import { resolveModelPickerSelectedModel } from "../components/chat/ModelPickerContent";
import { getTriggerDisplayModelName, type ModelEsque } from "../components/chat/providerIconUtils";
import type { ProviderInstanceEntry } from "../providerInstances";
import { productSurface } from "../product/productFlags";

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
 * timeline scroll collapses the composer into stays upstream's.
 */
export function showsUpComputerComposerFooter(isComposerResting: boolean): boolean {
  return !isComposerResting && productSurface("composerFooter") === "upcomputer";
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
