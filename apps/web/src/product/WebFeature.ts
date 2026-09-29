import type { ComponentType, FunctionComponent, ReactNode, SVGProps } from "react";
import type {
  EnvironmentId,
  ThreadId,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ProviderInteractionMode,
  ServerProvider,
} from "@upcomputer/contracts";
import type * as Schema from "effect/Schema";

import type { ProductCapabilityVersionRequirement } from "@upcomputer/shared/product";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ROUTE_PATH = /^\/[a-z0-9][a-z0-9._-]*$/;
const SETTINGS_ROUTE_PATH = /^\/settings\/[a-z0-9][a-z0-9._-]*$/;
const RESERVED_ROUTE_PATHS = new Set(["/draft", "/pair", "/settings"]);
const RESERVED_SETTINGS_ROUTE_PATHS = new Set([
  "/settings/archived",
  "/settings/connections",
  "/settings/diagnostics",
  "/settings/general",
  "/settings/keybindings",
  "/settings/providers",
  "/settings/source-control",
]);
const WEB_NAVIGATION_SLOTS = new Set<ExperimentalWebNavigationSlot>(["primary-after-project"]);

export type ExperimentalWebNavigationSlot = "primary-after-project";

export interface ExperimentalWebCapabilityRequirement extends ProductCapabilityVersionRequirement {
  readonly id: string;
}

export interface ExperimentalWebRouteModule {
  readonly default: ComponentType;
}

export interface ExperimentalWebRouteContribution {
  readonly id: string;
  /** Absolute, build-time route path such as `/tasks`. */
  readonly path: `/${string}`;
  readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
  /** Invoked only after the connected server passes the feature gate. */
  readonly load: () => Promise<ExperimentalWebRouteModule>;
}

export interface ExperimentalWebNavigationContribution {
  readonly id: string;
  readonly label: string;
  readonly path: `/${string}`;
  /** Host-owned placement. Extensions provide content, never sidebar layout. */
  readonly slot: ExperimentalWebNavigationSlot;
  readonly order?: number;
  readonly icon?: ComponentType<{ readonly className?: string }>;
  readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
}

export interface ExperimentalWebSettingsPageContribution {
  readonly id: string;
  readonly label: string;
  /** Settings-shell path such as `/settings/browser`. */
  readonly path: `/settings/${string}`;
  readonly order?: number;
  readonly icon?: ComponentType<{ readonly className?: string }>;
  /** Keeps the page reachable by path but leaves it out of the settings menu. */
  readonly hideFromNavigation?: boolean;
  readonly load: () => Promise<ExperimentalWebRouteModule>;
}

export interface ExperimentalWebInteractionModePresentation {
  readonly id: ProviderInteractionMode;
  readonly label: string;
  readonly description: string;
  readonly order?: number;
  readonly supportedProviders?: ReadonlyArray<string>;
  readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
}

export interface ExperimentalWebProviderDriverDetailsProps {
  readonly environmentId: EnvironmentId | undefined;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly liveProvider: ServerProvider | undefined;
  readonly refreshProviderStatus: () => void;
  readonly onConnectionStateChange?: (ready: boolean) => void;
  readonly onboardingFixtureOutcome?: "success" | "fail" | "cancel" | "loading";
  readonly onOnboardingStepChange?: (title: string, detailStep: boolean, subtitle: string) => void;
  readonly onboardingBackRequest?: number;
}

export interface ExperimentalWebProviderDriverContribution {
  readonly id: string;
  readonly driverKind: ProviderDriverKind;
  readonly label: string;
  readonly icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  readonly settingsSchema: Schema.Top & {
    readonly fields: Readonly<Record<string, Schema.Top>>;
  };
  readonly badgeLabel?: string;
  readonly onboardingDescription?: string;
  readonly onboardingOrder?: number;
  /** Lower values are shown first in the Providers settings list. */
  readonly settingsOrder?: number;
  /** Opens this provider's setup card by default whenever the Providers page mounts. */
  readonly defaultSettingsExpanded?: boolean;
  /** Primary login/key controls rendered before the provider's advanced settings. */
  readonly connectionDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  /** Simplified connection picker used during first-run onboarding. */
  readonly onboardingDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  /** Provider-specific controls rendered inside the nested Advanced settings section. */
  readonly advancedDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  readonly details?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
}

export interface ExperimentalWebThreadAccessoryProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly timeLabel: string;
  readonly fallback: ReactNode;
}

/**
 * Trusted, build-time web contribution. Executable UI is deliberately kept
 * separate from the server-advertised product manifest.
 *
 * @experimental This API is unstable while first-party extraction is active.
 */
export interface ExperimentalWebFeatureContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  /** Server-manifest extension id. Defaults to `id`. */
  readonly extensionId?: string;
  readonly routes?: ReadonlyArray<ExperimentalWebRouteContribution>;
  readonly navigation?: ReadonlyArray<ExperimentalWebNavigationContribution>;
  readonly settings?: ReadonlyArray<ExperimentalWebSettingsPageContribution>;
  readonly interactionModes?: ReadonlyArray<ExperimentalWebInteractionModePresentation>;
  /** Replaces the row timestamp when available; the host retains layout and fallback. */
  readonly threadAccessory?: {
    readonly component: ComponentType<ExperimentalWebThreadAccessoryProps>;
    readonly capabilities?: ReadonlyArray<ExperimentalWebCapabilityRequirement>;
  };
  readonly providerDrivers?: ReadonlyArray<ExperimentalWebProviderDriverContribution>;
}

export class WebFeatureInvariantError extends Error {
  override readonly name = "WebFeatureInvariantError";

  constructor(
    readonly code:
      | "invalid-id"
      | "invalid-version"
      | "invalid-route"
      | "invalid-navigation-slot"
      | "duplicate-feature"
      | "duplicate-route"
      | "duplicate-navigation"
      | "duplicate-settings"
      | "duplicate-presentation"
      | "duplicate-provider-driver",
    message: string,
  ) {
    super(message);
  }
}

function assertStableId(value: string, field: string): void {
  if (!STABLE_ID.test(value)) {
    throw new WebFeatureInvariantError(
      "invalid-id",
      `${field} '${value}' must be a lowercase dot, dash, or underscore separated id.`,
    );
  }
}

function assertRoutePath(path: string): void {
  if (!ROUTE_PATH.test(path) || RESERVED_ROUTE_PATHS.has(path)) {
    throw new WebFeatureInvariantError(
      "invalid-route",
      `Web feature route '${path}' must be an unreserved top-level application path.`,
    );
  }
}

function assertSettingsRoutePath(path: string): void {
  if (!SETTINGS_ROUTE_PATH.test(path) || RESERVED_SETTINGS_ROUTE_PATHS.has(path)) {
    throw new WebFeatureInvariantError(
      "invalid-route",
      `Web feature settings route '${path}' must be an unreserved direct child of /settings.`,
    );
  }
}

export function defineExperimentalWebFeature<
  const Feature extends ExperimentalWebFeatureContribution,
>(feature: Feature): Feature {
  assertStableId(feature.id, "Web feature id");
  assertStableId(feature.ownerId, "Web feature owner id");
  assertStableId(feature.extensionId ?? feature.id, "Web feature extension id");
  if (!Number.isSafeInteger(feature.version) || feature.version < 1) {
    throw new WebFeatureInvariantError(
      "invalid-version",
      `Web feature '${feature.id}' must have a positive safe-integer version.`,
    );
  }

  for (const route of feature.routes ?? []) {
    assertStableId(route.id, `Route id for '${feature.id}'`);
    assertRoutePath(route.path);
  }

  for (const item of feature.navigation ?? []) {
    assertStableId(item.id, `Navigation id for '${feature.id}'`);
    assertRoutePath(item.path);
    if (!WEB_NAVIGATION_SLOTS.has(item.slot)) {
      throw new WebFeatureInvariantError(
        "invalid-navigation-slot",
        `Navigation '${item.id}' for '${feature.id}' targets unknown host slot '${item.slot}'.`,
      );
    }
    if (item.label.trim().length === 0) {
      throw new WebFeatureInvariantError(
        "invalid-id",
        `Navigation '${item.id}' for '${feature.id}' must have a non-empty label.`,
      );
    }
  }
  for (const page of feature.settings ?? []) {
    assertStableId(page.id, `Settings page id for '${feature.id}'`);
    assertSettingsRoutePath(page.path);
    if (page.label.trim().length === 0) {
      throw new WebFeatureInvariantError(
        "invalid-id",
        `Settings page '${page.id}' for '${feature.id}' must have a non-empty label.`,
      );
    }
  }
  for (const mode of feature.interactionModes ?? []) {
    assertStableId(mode.id, `Interaction mode id for '${feature.id}'`);
    if (mode.label.trim().length === 0 || mode.description.trim().length === 0) {
      throw new WebFeatureInvariantError(
        "invalid-id",
        `Interaction mode '${mode.id}' for '${feature.id}' must have display metadata.`,
      );
    }
  }
  for (const provider of feature.providerDrivers ?? []) {
    assertStableId(provider.id, `Provider driver contribution id for '${feature.id}'`);
    assertStableId(provider.driverKind, `Provider driver kind for '${feature.id}'`);
    if (provider.label.trim().length === 0) {
      throw new WebFeatureInvariantError(
        "invalid-id",
        `Provider driver '${provider.driverKind}' for '${feature.id}' must have display metadata.`,
      );
    }
  }

  return feature;
}
