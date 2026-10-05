/**
 * Build-time product composition for the server.
 *
 * A product is core plus a fixed list of trusted features. Each feature
 * contributes layers, migrations, WebSocket RPC groups, tools on the core MCP
 * server, HTTP routes and provider drivers. The CLI provides the composition
 * through `ServerProduct`; upstream code reads it at a few hook points, and
 * without a product it sees the empty composition, so core behaves as
 * upstream does.
 */
import {
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  UPSTREAM_PRODUCT_FLAGS,
  type ProductFlag,
  type ProductFlags,
} from "@t3tools/shared/productFlags";

import type { AnyProviderDriver } from "../provider/ProviderDriver.ts";
import type { BuiltInDriversEnv } from "../provider/builtInDrivers.ts";
import {
  createExperimentalFeatureMigrationPlan,
  runExperimentalFeatureMigrations,
  type ExperimentalFeatureMigrationContribution,
} from "./FeatureMigrations.ts";
import {
  httpRouteContributionsLayer,
  type AnyHttpRouteContribution,
} from "./HttpRouteContribution.ts";
import { createRpcContributionPlan, type AnyNamespacedRpcContribution } from "./RpcContribution.ts";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/**
 * A feature layer with its types closed at the product boundary. Its services
 * still reach core transports at runtime: feature layers are merged into the
 * server runtime, so RPC handlers and MCP tools of the same feature find them.
 */
export type ExperimentalOpaqueServerLayer = Layer.Layer<never, never, never>;

export function eraseExperimentalServerLayer<A, E, R>(
  layer: Layer.Layer<A, E, R>,
): ExperimentalOpaqueServerLayer {
  return layer as unknown as ExperimentalOpaqueServerLayer;
}

interface OwnedContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
}

/** Services and background work, built after core runtime services and feature migrations. */
export interface ExperimentalServerLayerContribution extends OwnedContribution {
  readonly layer: ExperimentalOpaqueServerLayer;
}

/**
 * Registers tools on the core MCP server every provider session receives. The
 * layer is built with `McpServer` in context and calls `McpServer.addTool`.
 */
export interface ExperimentalMcpToolContribution extends OwnedContribution {
  readonly layer: ExperimentalOpaqueServerLayer;
}

/** A provider driver the provider instance registry can instantiate, next to the built-in ones. */
export interface ExperimentalProviderDriverContribution extends OwnedContribution {
  readonly driver: AnyProviderDriver<BuiltInDriversEnv>;
}

export interface ExperimentalServerFeatureContribution {
  readonly id: string;
  readonly version: number;
  readonly layers?: ReadonlyArray<ExperimentalServerLayerContribution>;
  readonly migrations?: ReadonlyArray<ExperimentalFeatureMigrationContribution<Error>>;
  readonly rpc?: ReadonlyArray<AnyNamespacedRpcContribution>;
  readonly mcpTools?: ReadonlyArray<ExperimentalMcpToolContribution>;
  readonly httpRoutes?: ReadonlyArray<AnyHttpRouteContribution>;
  readonly providerDrivers?: ReadonlyArray<ExperimentalProviderDriverContribution>;
}

export interface ExperimentalServerProductComposition {
  readonly features: ReadonlyArray<ExperimentalServerFeatureContribution>;
  /** Feature migrations, then every feature layer. */
  readonly featureLayer: ExperimentalOpaqueServerLayer;
  readonly mcpToolsLayer: ExperimentalOpaqueServerLayer;
  readonly httpRoutesLayer: ExperimentalOpaqueServerLayer;
  readonly rpc: ReadonlyArray<AnyNamespacedRpcContribution>;
  readonly providerDrivers: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>>;
  /** Upstream features this product shows; see `@t3tools/shared/productFlags`. */
  readonly flags: ProductFlags;
}

export interface ExperimentalServerProductOptions {
  /** Defaults to upstream's: every upstream feature shown. */
  readonly flags?: ProductFlags;
}

export class ServerProductCompositionError extends Error {
  override readonly name = "ServerProductCompositionError";
  readonly code:
    | "invalid-id"
    | "invalid-version"
    | "duplicate-feature"
    | "duplicate-contribution"
    | "owner-mismatch"
    | "duplicate-provider-driver";

  constructor(code: ServerProductCompositionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function assertIdentity(label: string, id: string, version: number): void {
  if (!STABLE_ID.test(id)) {
    throw new ServerProductCompositionError(
      "invalid-id",
      `${label} '${id}' must be a lowercase dot, dash, or underscore separated id.`,
    );
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ServerProductCompositionError(
      "invalid-version",
      `${label} '${id}' must have a positive safe-integer version.`,
    );
  }
}

function collectOwned<C extends OwnedContribution>(
  label: string,
  features: ReadonlyArray<ExperimentalServerFeatureContribution>,
  pick: (feature: ExperimentalServerFeatureContribution) => ReadonlyArray<C> | undefined,
): ReadonlyArray<C> {
  const keys = new Set<string>();
  const collected: C[] = [];
  for (const feature of features) {
    for (const contribution of pick(feature) ?? []) {
      assertIdentity(label, contribution.id, contribution.version);
      if (contribution.ownerId !== feature.id) {
        throw new ServerProductCompositionError(
          "owner-mismatch",
          `${label} owned by '${contribution.ownerId}' cannot be registered by feature '${feature.id}'.`,
        );
      }
      const key = `${contribution.ownerId}:${contribution.id}`;
      if (keys.has(key)) {
        throw new ServerProductCompositionError(
          "duplicate-contribution",
          `${label} '${key}' is registered more than once.`,
        );
      }
      keys.add(key);
      collected.push(contribution);
    }
  }
  return collected;
}

function mergeLayers(layers: ReadonlyArray<ExperimentalOpaqueServerLayer>) {
  if (layers.length === 0) return Layer.empty;
  const [first, ...rest] = layers;
  return Layer.mergeAll(first!, ...rest);
}

export function defineExperimentalServerFeature<
  const Feature extends ExperimentalServerFeatureContribution,
>(feature: Feature): Feature {
  assertIdentity("Server feature", feature.id, feature.version);
  return feature;
}

/** Validates the features once at build time and precomputes what each hook point reads. */
export function composeExperimentalServerFeatures(
  input: ReadonlyArray<ExperimentalServerFeatureContribution>,
  options: ExperimentalServerProductOptions = {},
): ExperimentalServerProductComposition {
  const features = [...input].sort((left, right) => left.id.localeCompare(right.id));
  const featureIds = new Set<string>();
  for (const feature of features) {
    defineExperimentalServerFeature(feature);
    if (featureIds.has(feature.id)) {
      throw new ServerProductCompositionError(
        "duplicate-feature",
        `Server feature '${feature.id}' is registered more than once.`,
      );
    }
    featureIds.add(feature.id);
  }

  const layers = collectOwned("Server layer", features, (feature) => feature.layers);
  const mcpTools = collectOwned("MCP tool contribution", features, (feature) => feature.mcpTools);
  const drivers = collectOwned(
    "Provider driver contribution",
    features,
    (feature) => feature.providerDrivers,
  );
  const driverKinds = new Set<string>();
  for (const { driver } of drivers) {
    if (driverKinds.has(driver.driverKind)) {
      throw new ServerProductCompositionError(
        "duplicate-provider-driver",
        `Provider driver '${driver.driverKind}' is registered more than once.`,
      );
    }
    driverKinds.add(driver.driverKind);
  }

  const migrations = features.flatMap((feature) => {
    for (const migration of feature.migrations ?? []) {
      if (migration.ownerId !== feature.id) {
        throw new ServerProductCompositionError(
          "owner-mismatch",
          `Feature migrations owned by '${migration.ownerId}' cannot be registered by feature '${feature.id}'.`,
        );
      }
    }
    return feature.migrations ?? [];
  });
  createExperimentalFeatureMigrationPlan(migrations);

  const rpc = features.flatMap((feature) =>
    (feature.rpc ?? []).map((contribution) => {
      if (contribution.ownerId !== feature.id) {
        throw new ServerProductCompositionError(
          "owner-mismatch",
          `RPC contribution owned by '${contribution.ownerId}' cannot be registered by feature '${feature.id}'.`,
        );
      }
      return contribution;
    }),
  );

  const httpRoutes = features.flatMap((feature) =>
    (feature.httpRoutes ?? []).map((contribution) => {
      if (contribution.ownerId !== feature.id) {
        throw new ServerProductCompositionError(
          "owner-mismatch",
          `HTTP route owned by '${contribution.ownerId}' cannot be registered by feature '${feature.id}'.`,
        );
      }
      return contribution;
    }),
  );

  // A failed feature migration stops startup, as a failed core migration does.
  const migrationsLayer =
    migrations.length === 0
      ? Layer.empty
      : eraseExperimentalServerLayer(
          Layer.effectDiscard(Effect.orDie(runExperimentalFeatureMigrations(migrations))),
        );

  return Object.freeze({
    features: Object.freeze(features),
    featureLayer: mergeLayers(layers.map(({ layer }) => layer)).pipe(
      Layer.provide(migrationsLayer),
    ),
    mcpToolsLayer: mergeLayers(mcpTools.map(({ layer }) => layer)),
    httpRoutesLayer: eraseExperimentalServerLayer(httpRouteContributionsLayer(httpRoutes)),
    rpc: createRpcContributionPlan(rpc),
    providerDrivers: Object.freeze(drivers.map(({ driver }) => driver)),
    flags: Object.freeze({ ...(options.flags ?? UPSTREAM_PRODUCT_FLAGS) }),
  });
}

export const CORE_SERVER_PRODUCT_COMPOSITION = composeExperimentalServerFeatures([]);

/** The running product. Core alone when nothing provides one. */
export class ServerProduct extends Context.Reference<ExperimentalServerProductComposition>(
  "t3/product/ServerProduct",
  { defaultValue: () => CORE_SERVER_PRODUCT_COMPOSITION },
) {}

/** Hook for the runtime services: feature migrations and feature layers. */
export const productFeatureLayer = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* ServerProduct).featureLayer;
  }),
);

/** Hook for the core MCP server's tool registrations. */
export const productMcpToolsLayer = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* ServerProduct).mcpToolsLayer;
  }),
);

/** Hook for the HTTP router. */
export const productHttpRoutesLayer = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* ServerProduct).httpRoutesLayer;
  }),
);

/** Whether the running product shows an upstream feature; see `@t3tools/shared/productFlags`. */
export const isProductFeatureShown = (flag: ProductFlag) =>
  Effect.gen(function* () {
    return (yield* ServerProduct).flags[flag];
  });

/**
 * Hook for upstream background work and tools behind a product flag: the
 * layer runs only when the product shows that feature.
 */
export function whenProductFeature<E, R>(
  flag: ProductFlag,
  layer: Layer.Layer<never, E, R>,
): Layer.Layer<never, E, R> {
  return Layer.unwrap(
    Effect.map(isProductFeatureShown(flag), (shown) => (shown ? layer : Layer.empty)),
  );
}

/** Built-in drivers followed by the product's; a product cannot replace a built-in kind. */
export function withProductProviderDrivers(
  builtIn: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>>,
  product: ExperimentalServerProductComposition,
): ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> {
  const builtInKinds = new Set(builtIn.map((driver) => driver.driverKind));
  for (const driver of product.providerDrivers) {
    if (builtInKinds.has(driver.driverKind)) {
      throw new ServerProductCompositionError(
        "duplicate-provider-driver",
        `Provider driver '${driver.driverKind}' is owned by core.`,
      );
    }
  }
  return [...builtIn, ...product.providerDrivers];
}

/**
 * Gives every product driver its default instance (keyed by the driver kind,
 * as built-in drivers get from their legacy settings). An explicit
 * `providerInstances` entry for that id wins; the instance starts with the
 * driver's default config.
 */
export function withProductDefaultInstances(
  configMap: ProviderInstanceConfigMap,
  product: ExperimentalServerProductComposition,
): ProviderInstanceConfigMap {
  const merged: Record<string, ProviderInstanceConfig> = { ...configMap };
  for (const driver of product.providerDrivers) {
    const instanceId = defaultInstanceIdForDriver(driver.driverKind);
    if (!(instanceId in merged)) merged[instanceId] = { driver: driver.driverKind };
  }
  return merged as ProviderInstanceConfigMap;
}
