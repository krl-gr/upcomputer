import type { ComponentType, ReactNode } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ROUTE_PATH = /^\/[a-z0-9][a-z0-9._-]*$/;
const SETTINGS_ROUTE_PATH = /^\/settings\/[a-z0-9][a-z0-9._-]*$/;
// Top-level paths core routes own. A feature route there would never render.
const RESERVED_ROUTE_PATHS = new Set([
  "/connect",
  "/draft",
  "/pair",
  "/projects",
  "/pull-requests",
  "/settings",
  "/usage",
  "/welcome",
]);

export interface ExperimentalWebPageModule {
  readonly default: ComponentType;
}

/** A page at a top-level path, inside the app shell. */
export interface ExperimentalWebRouteContribution {
  readonly id: string;
  readonly path: `/${string}`;
  readonly load: () => Promise<ExperimentalWebPageModule>;
}

/** An entry in the sidebar's primary navigation, below the thread header. */
export interface ExperimentalWebNavigationContribution {
  readonly id: string;
  readonly label: string;
  readonly path: `/${string}`;
  readonly order?: number;
  readonly icon?: ComponentType<{ readonly className?: string }>;
  /** Compact status after the label, such as a count. The host owns placement. */
  readonly accessory?: ComponentType;
}

/** A section of the settings shell, listed after core's sections. */
export interface ExperimentalWebSettingsPageContribution {
  readonly id: string;
  readonly label: string;
  readonly path: `/settings/${string}`;
  readonly order?: number;
  readonly icon?: ComponentType<{ readonly className?: string }>;
  readonly load: () => Promise<ExperimentalWebPageModule>;
}

export interface ExperimentalWebThreadAccessoryProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface ExperimentalWebThreadRowAccessoryProps extends ExperimentalWebThreadAccessoryProps {
  /** The row's timestamp. Render it when there is nothing to show instead. */
  readonly fallback: ReactNode;
}

/**
 * Trusted, build-time web feature. Each slot is optional; the host owns
 * placement and layout, the feature owns content.
 */
export interface ExperimentalWebFeatureContribution {
  readonly id: string;
  readonly version: number;
  readonly routes?: ReadonlyArray<ExperimentalWebRouteContribution>;
  readonly navigation?: ReadonlyArray<ExperimentalWebNavigationContribution>;
  readonly settings?: ReadonlyArray<ExperimentalWebSettingsPageContribution>;
  /** Replaces a sidebar thread row's timestamp. */
  readonly threadRowAccessory?: ComponentType<ExperimentalWebThreadRowAccessoryProps>;
  /** Follows the open thread's title in the chat header. */
  readonly chatHeaderAccessory?: ComponentType<ExperimentalWebThreadAccessoryProps>;
  /** RPC groups the feature's server counterpart adds to the WebSocket transport. */
  readonly rpcGroups?: ReadonlyArray<RpcGroup.Any>;
}

export class WebFeatureInvariantError extends Error {
  override readonly name = "WebFeatureInvariantError";

  constructor(
    readonly code:
      | "invalid-id"
      | "invalid-version"
      | "invalid-route"
      | "duplicate-feature"
      | "duplicate-route"
      | "duplicate-navigation"
      | "duplicate-settings"
      | "duplicate-rpc-method",
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

function assertLabel(label: string, field: string): void {
  if (label.trim().length === 0) {
    throw new WebFeatureInvariantError("invalid-id", `${field} must have a non-empty label.`);
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

function assertSettingsPath(path: string): void {
  if (!SETTINGS_ROUTE_PATH.test(path)) {
    throw new WebFeatureInvariantError(
      "invalid-route",
      `Web feature settings path '${path}' must be a direct child of /settings.`,
    );
  }
}

export function defineExperimentalWebFeature<
  const Feature extends ExperimentalWebFeatureContribution,
>(feature: Feature): Feature {
  assertStableId(feature.id, "Web feature id");
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
    assertLabel(item.label, `Navigation '${item.id}'`);
  }
  for (const page of feature.settings ?? []) {
    assertStableId(page.id, `Settings page id for '${feature.id}'`);
    assertSettingsPath(page.path);
    assertLabel(page.label, `Settings page '${page.id}'`);
  }
  return feature;
}
