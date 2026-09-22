import type { ExperimentalInteractionModeRegistry } from "@upcomputer/shared/interactionMode";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface InteractionModeRegistryServiceShape {
  readonly registry: ExperimentalInteractionModeRegistry;
}

export class InteractionModeRegistryService extends Context.Service<
  InteractionModeRegistryService,
  InteractionModeRegistryServiceShape
>()("t3/product/InteractionModeRegistryService") {}

export const layer = (registry: ExperimentalInteractionModeRegistry) =>
  Layer.succeed(InteractionModeRegistryService, { registry });
