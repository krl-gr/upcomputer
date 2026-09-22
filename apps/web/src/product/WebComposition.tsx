import { createContext, useContext, type PropsWithChildren } from "react";
import type { EnvironmentId } from "@upcomputer/contracts";
import type { RpcSessionClientFactory, WsRpcProtocolClient } from "@upcomputer/client-runtime/rpc";

import {
  defineExperimentalWebFeature,
  WebFeatureInvariantError,
  type ExperimentalWebFeatureContribution,
  type ExperimentalWebInteractionModePresentation,
  type ExperimentalWebNavigationContribution,
  type ExperimentalWebNavigationSlot,
  type ExperimentalWebProviderDriverContribution,
  type ExperimentalWebRouteContribution,
  type ExperimentalWebSettingsPageContribution,
} from "./WebFeature";
import type {
  EnvironmentExtensionRpcRequest,
  ExperimentalEnvironmentExtensionApiFactory,
} from "./EnvironmentExtensionApi";

interface ErasedEnvironmentExtensionApiFactory<Client extends WsRpcProtocolClient> {
  readonly definition: { readonly id: string };
  readonly create: (context: {
    readonly environmentId: EnvironmentId;
    readonly request: EnvironmentExtensionRpcRequest<Client>;
  }) => unknown;
}

export interface ExperimentalWebRpcComposition {
  readonly clientFactory: RpcSessionClientFactory;
  readonly extensionApis: ReadonlyArray<{
    readonly id: string;
    readonly create: (context: {
      readonly environmentId: EnvironmentId;
      readonly request: EnvironmentExtensionRpcRequest<WsRpcProtocolClient>;
    }) => unknown;
  }>;
}

export interface ExperimentalWebProductComposition {
  readonly features: ReadonlyArray<ExperimentalWebFeatureContribution>;
  readonly rpc?: ExperimentalWebRpcComposition;
}

export function defineExperimentalWebRpcComposition<Client extends WsRpcProtocolClient>(input: {
  readonly clientFactory: RpcSessionClientFactory<Client>;
  readonly extensionApis?: ReadonlyArray<
    ExperimentalEnvironmentExtensionApiFactory<Client, unknown>
  >;
}): ExperimentalWebRpcComposition {
  const ids = new Set<string>();
  const extensionApis = [...(input.extensionApis ?? [])]
    .sort((left, right) => left.definition.id.localeCompare(right.definition.id))
    .map((factory: ErasedEnvironmentExtensionApiFactory<Client>) => {
      if (ids.has(factory.definition.id)) {
        throw new WebFeatureInvariantError(
          "duplicate-feature",
          `Environment extension API '${factory.definition.id}' is registered more than once.`,
        );
      }
      ids.add(factory.definition.id);
      return {
        id: factory.definition.id,
        create: (context: {
          readonly environmentId: EnvironmentId;
          readonly request: EnvironmentExtensionRpcRequest<WsRpcProtocolClient>;
        }) =>
          factory.create({
            environmentId: context.environmentId,
            request: context.request as EnvironmentExtensionRpcRequest<Client>,
          }),
      };
    });

  return Object.freeze({
    clientFactory: input.clientFactory as RpcSessionClientFactory,
    extensionApis: Object.freeze(extensionApis),
  });
}

export function createExperimentalWebProductComposition(input: {
  readonly features?: ReadonlyArray<ExperimentalWebFeatureContribution>;
  readonly rpc?: ExperimentalWebRpcComposition;
}): ExperimentalWebProductComposition {
  const featureIds = new Set<string>();
  const routeIds = new Set<string>();
  const routePaths = new Set<string>();
  const navigationIds = new Set<string>();
  const settingsIds = new Set<string>();
  const settingsPaths = new Set<string>();
  const interactionModeIds = new Set<string>();
  const providerDriverIds = new Set<string>();
  const providerDriverKinds = new Set<string>();
  const features = [...(input.features ?? [])]
    .map((feature) => defineExperimentalWebFeature(feature))
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const feature of features) {
    if (featureIds.has(feature.id)) {
      throw new WebFeatureInvariantError(
        "duplicate-feature",
        `Web feature '${feature.id}' is registered more than once.`,
      );
    }
    featureIds.add(feature.id);

    for (const route of feature.routes ?? []) {
      if (routeIds.has(route.id) || routePaths.has(route.path)) {
        throw new WebFeatureInvariantError(
          "duplicate-route",
          `Web route '${route.id}' at '${route.path}' conflicts with another contribution.`,
        );
      }
      routeIds.add(route.id);
      routePaths.add(route.path);
    }

    for (const item of feature.navigation ?? []) {
      if (navigationIds.has(item.id)) {
        throw new WebFeatureInvariantError(
          "duplicate-navigation",
          `Web navigation item '${item.id}' is registered more than once.`,
        );
      }
      navigationIds.add(item.id);
    }
    for (const page of feature.settings ?? []) {
      if (settingsIds.has(page.id) || settingsPaths.has(page.path)) {
        throw new WebFeatureInvariantError(
          "duplicate-settings",
          `Web settings page '${page.id}' at '${page.path}' conflicts with another contribution.`,
        );
      }
      settingsIds.add(page.id);
      settingsPaths.add(page.path);
    }
    for (const mode of feature.interactionModes ?? []) {
      if (interactionModeIds.has(mode.id)) {
        throw new WebFeatureInvariantError(
          "duplicate-presentation",
          `Interaction mode presentation '${mode.id}' is registered more than once.`,
        );
      }
      interactionModeIds.add(mode.id);
    }
    for (const provider of feature.providerDrivers ?? []) {
      if (providerDriverIds.has(provider.id) || providerDriverKinds.has(provider.driverKind)) {
        throw new WebFeatureInvariantError(
          "duplicate-provider-driver",
          `Web provider driver '${provider.driverKind}' conflicts with another contribution.`,
        );
      }
      providerDriverIds.add(provider.id);
      providerDriverKinds.add(provider.driverKind);
    }
  }

  return Object.freeze({
    features: Object.freeze(features),
    ...(input.rpc === undefined ? {} : { rpc: input.rpc }),
  });
}

export const CORE_WEB_PRODUCT_COMPOSITION = createExperimentalWebProductComposition({});

let installedComposition: ExperimentalWebProductComposition = CORE_WEB_PRODUCT_COMPOSITION;

/** Installs the immutable build composition before environment connections start. */
export function installWebProductComposition(composition: ExperimentalWebProductComposition): void {
  installedComposition = composition;
}

export function getInstalledWebProductComposition(): ExperimentalWebProductComposition {
  return installedComposition;
}

export function listExperimentalWebRoutes(
  composition: ExperimentalWebProductComposition,
): ReadonlyArray<{
  readonly feature: ExperimentalWebFeatureContribution;
  readonly route: ExperimentalWebRouteContribution;
}> {
  return composition.features
    .flatMap((feature) => (feature.routes ?? []).map((route) => ({ feature, route })))
    .sort((left, right) =>
      left.route.path === right.route.path
        ? left.route.id.localeCompare(right.route.id)
        : left.route.path.localeCompare(right.route.path),
    );
}

export function listExperimentalWebNavigation(
  composition: ExperimentalWebProductComposition,
  slot: ExperimentalWebNavigationSlot,
): ReadonlyArray<{
  readonly feature: ExperimentalWebFeatureContribution;
  readonly item: ExperimentalWebNavigationContribution;
}> {
  return composition.features
    .flatMap((feature) => (feature.navigation ?? []).map((item) => ({ feature, item })))
    .filter(({ item }) => item.slot === slot)
    .sort((left, right) => {
      const order = (left.item.order ?? 0) - (right.item.order ?? 0);
      return order !== 0 ? order : left.item.id.localeCompare(right.item.id);
    });
}

export function listExperimentalWebSettings(
  composition: ExperimentalWebProductComposition,
): ReadonlyArray<{
  readonly feature: ExperimentalWebFeatureContribution;
  readonly page: ExperimentalWebSettingsPageContribution;
}> {
  return composition.features
    .flatMap((feature) => (feature.settings ?? []).map((page) => ({ feature, page })))
    .sort((left, right) => {
      const order = (left.page.order ?? 0) - (right.page.order ?? 0);
      return order !== 0 ? order : left.page.id.localeCompare(right.page.id);
    });
}

function compareOrderedPresentation(
  left: { readonly id: string; readonly order?: number },
  right: { readonly id: string; readonly order?: number },
): number {
  const order = (left.order ?? 0) - (right.order ?? 0);
  return order !== 0 ? order : left.id.localeCompare(right.id);
}

export function listExperimentalWebInteractionModes(
  composition: ExperimentalWebProductComposition,
): ReadonlyArray<{
  readonly feature: ExperimentalWebFeatureContribution;
  readonly mode: ExperimentalWebInteractionModePresentation;
}> {
  return composition.features
    .flatMap((feature) => (feature.interactionModes ?? []).map((mode) => ({ feature, mode })))
    .sort((left, right) => compareOrderedPresentation(left.mode, right.mode));
}

export function listExperimentalWebProviderDrivers(
  composition: ExperimentalWebProductComposition,
): ReadonlyArray<{
  readonly feature: ExperimentalWebFeatureContribution;
  readonly provider: ExperimentalWebProviderDriverContribution;
}> {
  return composition.features
    .flatMap((feature) =>
      (feature.providerDrivers ?? []).map((provider) => ({ feature, provider })),
    )
    .sort((left, right) => left.provider.label.localeCompare(right.provider.label));
}

const WebProductCompositionContext = createContext<ExperimentalWebProductComposition>(
  CORE_WEB_PRODUCT_COMPOSITION,
);

export function WebProductCompositionProvider({
  composition,
  children,
}: PropsWithChildren<{ readonly composition: ExperimentalWebProductComposition }>) {
  return (
    <WebProductCompositionContext.Provider value={composition}>
      {children}
    </WebProductCompositionContext.Provider>
  );
}

export function useWebProductComposition(): ExperimentalWebProductComposition {
  return useContext(WebProductCompositionContext);
}
