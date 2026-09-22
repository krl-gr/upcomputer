import type { InteractionModeProviderBehavior } from "@upcomputer/contracts";
import * as Layer from "effect/Layer";

import {
  createExperimentalDynamicToolRegistry,
  type ExperimentalDynamicToolOwner,
  type ExperimentalDynamicToolRegistry,
} from "./DynamicToolRegistry.ts";
import {
  createExperimentalFeatureMigrationPlan,
  type ExperimentalFeatureMigrationContribution,
} from "./FeatureMigrations.ts";
import {
  httpRouteContributionsLayer,
  type AnyHttpRouteContribution,
} from "./HttpRouteContribution.ts";
import { BUILT_IN_INTERACTION_MODE_REGISTRATIONS } from "./BuiltInInteractionModes.ts";
import { createRpcContributionPlan, type AnyNamespacedRpcContribution } from "./RpcContribution.ts";
import {
  createExperimentalInteractionModeRegistry,
  type ExperimentalInteractionModeRegistration,
  type ExperimentalInteractionModeRegistry,
} from "@upcomputer/shared/interactionMode";
import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "../provider/builtInDrivers.ts";
import type { AnyProviderDriver } from "../provider/ProviderDriver.ts";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const RESERVED_CORE_FEATURE_ID = "upcomputer.core";

export type ExperimentalOpaqueServerLayer = Layer.Layer<never, Error, never>;

/**
 * Closes a feature-owned runtime layer at the public product boundary.
 * Feature packages keep their service graph typed locally; core composes only
 * the startup side effect and does not expose private service tags.
 */
export function eraseExperimentalServerLayer<A, E, R>(
  layer: Layer.Layer<A, E, R>,
): ExperimentalOpaqueServerLayer {
  return layer as unknown as ExperimentalOpaqueServerLayer;
}

export interface ExperimentalServerLayerContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly layer: ExperimentalOpaqueServerLayer;
}

/** Trusted build-time registration for a provider driver owned by a feature. */
export interface ExperimentalProviderDriverContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly driver: AnyProviderDriver<BuiltInDriversEnv>;
}

/** Adds one provider-specific behavior to an existing interaction mode. */
export interface ExperimentalInteractionModeProviderContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly modeId: string;
  readonly behavior: InteractionModeProviderBehavior;
}

export interface ExperimentalServerFeatureContribution<
  RpcContributions extends ReadonlyArray<AnyNamespacedRpcContribution> =
    ReadonlyArray<AnyNamespacedRpcContribution>,
> {
  readonly id: string;
  readonly version: number;
  readonly layers?: ReadonlyArray<ExperimentalServerLayerContribution>;
  readonly httpRoutes?: ReadonlyArray<AnyHttpRouteContribution>;
  readonly migrations?: ReadonlyArray<ExperimentalFeatureMigrationContribution<Error>>;
  readonly rpc?: RpcContributions;
  readonly dynamicTools?: ReadonlyArray<ExperimentalDynamicToolOwner<never, never>>;
  readonly interactionModes?: ReadonlyArray<ExperimentalInteractionModeRegistration>;
  readonly providerDrivers?: ReadonlyArray<ExperimentalProviderDriverContribution>;
  readonly interactionModeProviders?: ReadonlyArray<ExperimentalInteractionModeProviderContribution>;
}

export type RpcContributionsOfFeature<Feature> = Feature extends {
  readonly rpc?: infer RpcContributions;
}
  ? RpcContributions extends ReadonlyArray<AnyNamespacedRpcContribution>
    ? RpcContributions[number]
    : never
  : never;

export type RpcContributionsOfFeatures<
  Features extends ReadonlyArray<ExperimentalServerFeatureContribution>,
> = RpcContributionsOfFeature<Features[number]>;

export interface ExperimentalServerFeatureDiagnostic {
  readonly id: string;
  readonly version: number;
  readonly layers: number;
  readonly httpRoutes: number;
  readonly migrationNamespaces: number;
  readonly rpcNamespaces: number;
  readonly dynamicTools: number;
  readonly interactionModes: number;
  readonly providerDrivers: number;
  readonly interactionModeProviders: number;
}

export interface ExperimentalServerProductComposition<
  Features extends ReadonlyArray<ExperimentalServerFeatureContribution> =
    ReadonlyArray<ExperimentalServerFeatureContribution>,
> {
  readonly features: ReadonlyArray<Features[number]>;
  readonly diagnostics: ReadonlyArray<ExperimentalServerFeatureDiagnostic>;
  readonly featureLayer: ExperimentalOpaqueServerLayer;
  readonly httpRoutesLayer: ExperimentalOpaqueServerLayer;
  readonly migrations: ReadonlyArray<ExperimentalFeatureMigrationContribution<Error>>;
  readonly rpc: ReadonlyArray<RpcContributionsOfFeatures<Features>>;
  readonly dynamicToolRegistry: ExperimentalDynamicToolRegistry<never, never>;
  readonly interactionModeRegistry: ExperimentalInteractionModeRegistry;
  readonly providerDrivers: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>>;
}

export class ServerProductCompositionInvariantError extends Error {
  override readonly name = "ServerProductCompositionInvariantError";
  readonly code:
    | "invalid-feature-id"
    | "invalid-feature-version"
    | "reserved-feature-id"
    | "duplicate-feature"
    | "invalid-layer-id"
    | "invalid-layer-version"
    | "duplicate-layer"
    | "owner-mismatch"
    | "invalid-provider-driver-id"
    | "invalid-provider-driver-version"
    | "duplicate-provider-driver"
    | "reserved-provider-driver"
    | "invalid-interaction-mode-provider"
    | "duplicate-interaction-mode-provider";

  constructor(
    code:
      | "invalid-feature-id"
      | "invalid-feature-version"
      | "reserved-feature-id"
      | "duplicate-feature"
      | "invalid-layer-id"
      | "invalid-layer-version"
      | "duplicate-layer"
      | "owner-mismatch"
      | "invalid-provider-driver-id"
      | "invalid-provider-driver-version"
      | "duplicate-provider-driver"
      | "reserved-provider-driver"
      | "invalid-interaction-mode-provider"
      | "duplicate-interaction-mode-provider",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function assertStableId(
  value: string,
  code:
    | "invalid-feature-id"
    | "invalid-layer-id"
    | "invalid-provider-driver-id"
    | "invalid-interaction-mode-provider",
  field: string,
): void {
  if (!STABLE_ID.test(value)) {
    throw new ServerProductCompositionInvariantError(
      code,
      `${field} '${value}' must be a lowercase dot, dash, or underscore separated id.`,
    );
  }
}

export function defineExperimentalProviderDriver(
  contribution: ExperimentalProviderDriverContribution,
): ExperimentalProviderDriverContribution {
  assertStableId(contribution.id, "invalid-provider-driver-id", "Provider driver contribution id");
  if (!Number.isSafeInteger(contribution.version) || contribution.version < 1) {
    throw new ServerProductCompositionInvariantError(
      "invalid-provider-driver-version",
      `Provider driver contribution '${contribution.id}' must have a positive safe-integer version.`,
    );
  }
  if (!contribution.driver.metadata.displayName.trim()) {
    throw new ServerProductCompositionInvariantError(
      "invalid-provider-driver-id",
      `Provider driver contribution '${contribution.id}' has an empty display name.`,
    );
  }
  return contribution;
}

export function defineExperimentalInteractionModeProvider(
  contribution: ExperimentalInteractionModeProviderContribution,
): ExperimentalInteractionModeProviderContribution {
  assertStableId(
    contribution.id,
    "invalid-interaction-mode-provider",
    "Interaction-mode provider contribution id",
  );
  if (!Number.isSafeInteger(contribution.version) || contribution.version < 1) {
    throw new ServerProductCompositionInvariantError(
      "invalid-interaction-mode-provider",
      `Interaction-mode provider contribution '${contribution.id}' must have a positive safe-integer version.`,
    );
  }
  return contribution;
}

function assertFeatureVersion(feature: ExperimentalServerFeatureContribution): void {
  if (!Number.isSafeInteger(feature.version) || feature.version < 1) {
    throw new ServerProductCompositionInvariantError(
      "invalid-feature-version",
      `Server feature '${feature.id}' must have a positive safe-integer version.`,
    );
  }
}

function assertLayerVersion(featureId: string, layer: ExperimentalServerLayerContribution): void {
  if (!Number.isSafeInteger(layer.version) || layer.version < 1) {
    throw new ServerProductCompositionInvariantError(
      "invalid-layer-version",
      `Server layer '${layer.id}' for feature '${featureId}' must have a positive safe-integer version.`,
    );
  }
}

function assertOwner(featureId: string, ownerId: string, contribution: string): void {
  if (ownerId !== featureId) {
    throw new ServerProductCompositionInvariantError(
      "owner-mismatch",
      `${contribution} owned by '${ownerId}' cannot be registered by feature '${featureId}'.`,
    );
  }
}

function mergeFeatureLayers(
  contributions: ReadonlyArray<ExperimentalServerLayerContribution>,
): ExperimentalOpaqueServerLayer {
  if (contributions.length === 0) return Layer.empty;
  const [first, ...rest] = contributions;
  return Layer.mergeAll(
    first!.layer,
    ...rest.map(({ layer }) => layer),
  ) as ExperimentalOpaqueServerLayer;
}

/**
 * Trusted, build-time server contribution.
 *
 * @experimental This API is intentionally narrow while the server boundary is rebuilt.
 */
export function defineExperimentalServerFeature<
  const Feature extends ExperimentalServerFeatureContribution,
>(feature: Feature): Feature {
  assertStableId(feature.id, "invalid-feature-id", "Server feature id");
  if (feature.id === RESERVED_CORE_FEATURE_ID) {
    throw new ServerProductCompositionInvariantError(
      "reserved-feature-id",
      `Server feature '${feature.id}' is reserved for the built-in core product.`,
    );
  }
  assertFeatureVersion(feature);
  return feature;
}

export function createExperimentalServerProductComposition<
  const Features extends ReadonlyArray<ExperimentalServerFeatureContribution> = readonly [],
>(input: { readonly features?: Features }): ExperimentalServerProductComposition<Features> {
  const featureIds = new Set<string>();
  const layerIds = new Set<string>();
  const layers: ExperimentalServerLayerContribution[] = [];
  const httpRoutes: AnyHttpRouteContribution[] = [];
  const migrations: ExperimentalFeatureMigrationContribution<Error>[] = [];
  const rpc: AnyNamespacedRpcContribution[] = [];
  const dynamicTools: ExperimentalDynamicToolOwner<never, never>[] = [];
  const interactionModes: ExperimentalInteractionModeRegistration[] = [];
  const providerDrivers: ExperimentalProviderDriverContribution[] = [];
  const interactionModeProviders: ExperimentalInteractionModeProviderContribution[] = [];
  const providerDriverIds = new Set<string>();
  const providerDriverKinds = new Set(BUILT_IN_DRIVERS.map((driver) => driver.driverKind));
  const features = [...(input.features ?? [])]
    .map((feature) => defineExperimentalServerFeature(feature))
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const feature of features) {
    if (featureIds.has(feature.id)) {
      throw new ServerProductCompositionInvariantError(
        "duplicate-feature",
        `Server feature '${feature.id}' is registered more than once.`,
      );
    }
    featureIds.add(feature.id);

    for (const layer of feature.layers ?? []) {
      assertOwner(feature.id, layer.ownerId, "Server layer contribution");
      assertStableId(layer.id, "invalid-layer-id", "Server layer contribution id");
      assertLayerVersion(feature.id, layer);
      const layerKey = `${layer.ownerId}:${layer.id}`;
      if (layerIds.has(layerKey)) {
        throw new ServerProductCompositionInvariantError(
          "duplicate-layer",
          `Server layer contribution '${layerKey}' is registered more than once.`,
        );
      }
      layerIds.add(layerKey);
      layers.push(layer);
    }

    for (const contribution of feature.httpRoutes ?? []) {
      assertOwner(feature.id, contribution.ownerId, "HTTP route contribution");
      httpRoutes.push(contribution);
    }

    for (const migration of feature.migrations ?? []) {
      assertOwner(feature.id, migration.ownerId, "Feature migration contribution");
      migrations.push(migration);
    }

    for (const contribution of feature.rpc ?? []) {
      assertOwner(feature.id, contribution.ownerId, "RPC contribution");
      rpc.push(contribution);
    }

    for (const contribution of feature.dynamicTools ?? []) {
      assertOwner(feature.id, contribution.ownerId, "Dynamic-tool contribution");
      dynamicTools.push(contribution);
    }

    for (const registration of feature.interactionModes ?? []) {
      assertOwner(feature.id, registration.descriptor.ownerId, "Interaction-mode contribution");
      interactionModes.push(registration);
    }

    for (const rawContribution of feature.providerDrivers ?? []) {
      const contribution = defineExperimentalProviderDriver(rawContribution);
      assertOwner(feature.id, contribution.ownerId, "Provider driver contribution");
      if (providerDriverIds.has(contribution.id)) {
        throw new ServerProductCompositionInvariantError(
          "duplicate-provider-driver",
          `Provider driver contribution '${contribution.id}' is registered more than once.`,
        );
      }
      if (providerDriverKinds.has(contribution.driver.driverKind)) {
        const isCoreDriver = BUILT_IN_DRIVERS.some(
          (driver) => driver.driverKind === contribution.driver.driverKind,
        );
        throw new ServerProductCompositionInvariantError(
          isCoreDriver ? "reserved-provider-driver" : "duplicate-provider-driver",
          isCoreDriver
            ? `Provider driver '${contribution.driver.driverKind}' is owned by public core.`
            : `Provider driver '${contribution.driver.driverKind}' is registered more than once.`,
        );
      }
      providerDriverIds.add(contribution.id);
      providerDriverKinds.add(contribution.driver.driverKind);
      providerDrivers.push(contribution);
    }

    for (const rawContribution of feature.interactionModeProviders ?? []) {
      const contribution = defineExperimentalInteractionModeProvider(rawContribution);
      assertOwner(feature.id, contribution.ownerId, "Interaction-mode provider contribution");
      interactionModeProviders.push(contribution);
    }
  }

  const orderedLayers = layers.sort(
    (left, right) => left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id),
  );
  const httpRoutesLayer = httpRouteContributionsLayer(
    httpRoutes,
  ) as unknown as ExperimentalOpaqueServerLayer;
  const dynamicToolRegistry = createExperimentalDynamicToolRegistry(dynamicTools);
  createExperimentalFeatureMigrationPlan(migrations);
  const orderedRpc = createRpcContributionPlan(
    rpc as unknown as ReadonlyArray<RpcContributionsOfFeatures<Features>>,
  );
  const modeRegistrations: ExperimentalInteractionModeRegistration[] = [
    ...BUILT_IN_INTERACTION_MODE_REGISTRATIONS,
    ...interactionModes,
  ];
  const modeRegistrationIndex = new Map(
    modeRegistrations.map((registration, index) => [registration.descriptor.id, index] as const),
  );
  const modeProviderKeys = new Set<string>();
  for (const contribution of interactionModeProviders) {
    const index = modeRegistrationIndex.get(contribution.modeId);
    if (index === undefined) {
      throw new ServerProductCompositionInvariantError(
        "invalid-interaction-mode-provider",
        `Interaction mode '${contribution.modeId}' does not exist for provider contribution '${contribution.id}'.`,
      );
    }
    const registration = modeRegistrations[index]!;
    const providerKey = `${contribution.modeId}:${contribution.behavior.providerId}`;
    if (
      modeProviderKeys.has(providerKey) ||
      registration.descriptor.supportedProviders.includes(contribution.behavior.providerId)
    ) {
      throw new ServerProductCompositionInvariantError(
        "duplicate-interaction-mode-provider",
        `Interaction mode '${contribution.modeId}' already defines provider '${contribution.behavior.providerId}'.`,
      );
    }
    modeProviderKeys.add(providerKey);
    modeRegistrations[index] = {
      ...registration,
      descriptor: {
        ...registration.descriptor,
        supportedProviders: [
          ...registration.descriptor.supportedProviders,
          contribution.behavior.providerId,
        ],
        providerBehaviors: [...registration.descriptor.providerBehaviors, contribution.behavior],
      },
    };
  }
  const interactionModeRegistry = createExperimentalInteractionModeRegistry(modeRegistrations);

  return Object.freeze({
    features: Object.freeze(features),
    diagnostics: Object.freeze(
      features.map(
        ({
          id,
          version,
          layers,
          httpRoutes,
          migrations,
          rpc,
          dynamicTools,
          interactionModes,
          providerDrivers,
          interactionModeProviders,
        }) => ({
          id,
          version,
          layers: layers?.length ?? 0,
          httpRoutes: httpRoutes?.length ?? 0,
          migrationNamespaces: migrations?.length ?? 0,
          rpcNamespaces: rpc?.length ?? 0,
          dynamicTools: dynamicTools?.reduce((count, owner) => count + owner.tools.length, 0) ?? 0,
          interactionModes: interactionModes?.length ?? 0,
          providerDrivers: providerDrivers?.length ?? 0,
          interactionModeProviders: interactionModeProviders?.length ?? 0,
        }),
      ),
    ),
    featureLayer: mergeFeatureLayers(orderedLayers),
    httpRoutesLayer,
    migrations: Object.freeze([...migrations]),
    rpc: Object.freeze([...orderedRpc]),
    dynamicToolRegistry,
    interactionModeRegistry,
    providerDrivers: Object.freeze(providerDrivers.map((contribution) => contribution.driver)),
  });
}

export function composeExperimentalServerFeatures(
  features: ReadonlyArray<ExperimentalServerFeatureContribution>,
): ExperimentalServerProductComposition<ReadonlyArray<ExperimentalServerFeatureContribution>> {
  return createExperimentalServerProductComposition({ features });
}

export const CORE_SERVER_PRODUCT_COMPOSITION = createExperimentalServerProductComposition({});
