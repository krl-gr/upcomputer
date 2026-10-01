import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@upcomputer/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
} from "@upcomputer/shared/model";

import { getProviderModelCapabilities } from "../../../../apps/web/src/providerModels.ts";
import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";

export function getAgentModelOptionDescriptors(input: {
  readonly provider: ProviderInstanceEntry | undefined;
  readonly model: string;
  readonly options: ReadonlyArray<ProviderOptionSelection> | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  if (!input.provider) return [];
  return getProviderOptionDescriptors({
    caps: getProviderModelCapabilities(
      input.provider.models,
      input.model,
      input.provider.driverKind,
    ),
    selections: input.options,
  });
}

export function getAgentModelOptionPresentation(input: {
  readonly provider: ProviderInstanceEntry | undefined;
  readonly model: string;
  readonly options: ReadonlyArray<ProviderOptionSelection> | undefined;
}): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return getAgentModelOptionDescriptors(input).flatMap((descriptor) => {
    const value = getProviderOptionCurrentLabel(descriptor);
    return value ? [{ label: descriptor.label, value }] : [];
  });
}

/** Retain stored values only when the newly selected provider/model advertises them. */
export function retainValidAgentModelOptions(input: {
  readonly provider: ProviderInstanceEntry | undefined;
  readonly model: string;
  readonly options: ReadonlyArray<ProviderOptionSelection> | undefined;
}): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (!input.options) return undefined;
  const descriptors = getAgentModelOptionDescriptors({ ...input, options: undefined });
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor] as const));
  const retained = input.options.filter((selection) => {
    const descriptor = byId.get(selection.id);
    if (!descriptor) return false;
    if (descriptor.type === "boolean") return typeof selection.value === "boolean";
    return (
      typeof selection.value === "string" &&
      (descriptor.options.length === 0 ||
        descriptor.options.some((option) => option.id === selection.value))
    );
  });
  return retained.length > 0 ? retained : undefined;
}
