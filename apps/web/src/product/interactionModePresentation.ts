import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  type ProviderInteractionMode,
} from "@upcomputer/contracts";

import {
  CORE_INTERACTION_MODE_PRESENTATIONS,
  type InteractionModePresentation,
} from "../interactionModes";
import { useServerConfigs } from "../state/entities";
import {
  listExperimentalWebInteractionModes,
  useWebProductComposition,
  type ExperimentalWebProductComposition,
} from "./WebComposition";
import { resolveWebFeatureAvailability } from "./environmentProduct";

const CORE_ORDER = new Map([
  ["default", 0],
  ["ask", 100],
  ["plan", 200],
]);

export function useInteractionModePresentations(
  environmentId: EnvironmentId | null | undefined,
  providerId: string | null | undefined,
): ReadonlyArray<InteractionModePresentation> {
  const composition = useWebProductComposition();
  const configs = useServerConfigs();
  const config =
    environmentId === null || environmentId === undefined
      ? undefined
      : (configs.get(environmentId) ?? null);
  const manifest = config === undefined ? undefined : (config?.environment.product ?? null);

  const presentations: Array<InteractionModePresentation & { readonly order: number }> =
    CORE_INTERACTION_MODE_PRESENTATIONS.map((presentation) => ({
      ...presentation,
      order: CORE_ORDER.get(presentation.id) ?? 0,
    }));

  for (const { feature, mode } of listExperimentalWebInteractionModes(composition)) {
    if (
      providerId !== null &&
      providerId !== undefined &&
      mode.supportedProviders !== undefined &&
      !mode.supportedProviders.includes(providerId)
    ) {
      continue;
    }
    const availability = resolveWebFeatureAvailability({
      feature,
      manifest,
      ...(mode.capabilities === undefined ? {} : { capabilities: mode.capabilities }),
    });
    if (!availability.canMutate) continue;
    presentations.push({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      available: true,
      order: mode.order ?? 0,
    });
  }

  return presentations
    .sort((left, right) => {
      const order = left.order - right.order;
      return order !== 0 ? order : left.id.localeCompare(right.id);
    })
    .map(({ order: _order, ...presentation }) => presentation);
}

/**
 * A thread or draft can store a mode that neither core nor a bundled feature
 * defines any more, such as the removed Orchestrator mode. The server runs it
 * as Default, so the composer shows and sends Default too.
 */
export function resolveKnownInteractionMode(
  mode: ProviderInteractionMode,
  composition: ExperimentalWebProductComposition,
): ProviderInteractionMode {
  const known =
    CORE_INTERACTION_MODE_PRESENTATIONS.some((presentation) => presentation.id === mode) ||
    listExperimentalWebInteractionModes(composition).some((entry) => entry.mode.id === mode);
  return known ? mode : DEFAULT_PROVIDER_INTERACTION_MODE;
}

export function useKnownInteractionMode(mode: ProviderInteractionMode): ProviderInteractionMode {
  return resolveKnownInteractionMode(mode, useWebProductComposition());
}
