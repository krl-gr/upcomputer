import type { EnvironmentId } from "@upcomputer/contracts";

import {
  CORE_INTERACTION_MODE_PRESENTATIONS,
  type InteractionModePresentation,
} from "../interactionModes";
import { useServerConfigs } from "../state/entities";
import { listExperimentalWebInteractionModes, useWebProductComposition } from "./WebComposition";
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
