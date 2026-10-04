import type {
  ModelSelection,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionCurrentLabel, getProviderOptionDescriptors } from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../../../apps/web/src/providerModels.ts";
import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";
import { getTriggerDisplayModelName } from "../../../../apps/web/src/components/chat/providerIconUtils.ts";
import type { ScopedTaskAgent, ScopedTaskAgentRun } from "../state/index.ts";

/**
 * "Claude Code · Claude Opus 5.5", as the composer's model picker labels a
 * selection. Falls back to the slug where the catalog has no entry.
 */
export function getAgentModelLabel(
  entries: ReadonlyArray<ProviderInstanceEntry> | undefined,
  selection: Pick<ModelSelection, "instanceId" | "model">,
): string {
  const provider = entries?.find((entry) => entry.instanceId === selection.instanceId);
  if (!provider) return selection.model;
  return `${provider.displayName} · ${getAgentModelName(provider, selection.model)}`;
}

/** The model's display name, or its slug when the provider does not list it. */
export function getAgentModelName(
  provider: ProviderInstanceEntry | undefined,
  slug: string,
): string {
  const model = provider?.models.find((candidate) => candidate.slug === slug);
  return model ? getTriggerDisplayModelName(model) : slug;
}

/** A run's agent name and the harness and model it ran on, which can differ from the agent's current config. */
export function getTaskRunAgentPresentation(
  run: ScopedTaskAgentRun,
  agents: ReadonlyArray<ScopedTaskAgent>,
  entries: ReadonlyArray<ProviderInstanceEntry> | undefined,
): { readonly agentName: string; readonly modelLabel: string } {
  const agent = agents.find(
    (candidate) => candidate.environmentId === run.environmentId && candidate.id === run.agentId,
  );
  return {
    agentName: agent?.name ?? "Agent run",
    modelLabel: getAgentModelLabel(entries, run.modelSelection),
  };
}

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
