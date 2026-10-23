import type { ComponentType, ReactNode } from "react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { NavigateOptions } from "@tanstack/react-router";
import type * as RpcGroup from "effect/rpc/RpcGroup";

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
// Letters core's right-panel launcher already uses (`RightPanelTabs.tsx`).
const CORE_RIGHT_PANEL_SHORTCUTS = new Set(["B", "T", "F", "D", "P", "L", "M"]);

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

/** What a feature's thread action can do when chosen. */
export interface ExperimentalWebThreadActionContext {
  readonly navigate: (options: NavigateOptions) => Promise<void>;
}

/** An entry a feature adds to a thread's action menu. */
export interface ExperimentalWebThreadAction {
  /** Unique within the feature. */
  readonly id: string;
  readonly label: string;
  /** A context menu icon name, such as "bot"; desktop menus show none. */
  readonly icon?: string;
  readonly run: (context: ExperimentalWebThreadActionContext) => void;
}

export interface ExperimentalWebThreadRowAccessoryProps extends ExperimentalWebThreadAccessoryProps {
  /** The row's timestamp. Render it when there is nothing to show instead. */
  readonly fallback: ReactNode;
}

export interface ExperimentalWebRightPanelSurfaceProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The thread's project, null while it has none. */
  readonly projectId: ProjectId | null;
}

/**
 * A surface in the right panel beside a thread: an entry in the panel's
 * launcher and "+" menu, and at most one tab per thread.
 */
export interface ExperimentalWebRightPanelSurfaceContribution {
  readonly id: string;
  /** The launcher entry and the tab title. */
  readonly label: string;
  /** One letter that opens the surface from the launcher; core's letters are taken. */
  readonly shortcut: string;
  readonly icon: ComponentType<{ readonly className?: string }>;
  readonly load: () => Promise<{
    readonly default: ComponentType<ExperimentalWebRightPanelSurfaceProps>;
  }>;
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
  /**
   * Entries for a thread's action menu, asked each time it opens. The menu shows at once, so
   * answer from state the feature already holds. Like the menu's other thread changes they
   * need the operate scope.
   */
  readonly threadActions?: (
    thread: ExperimentalWebThreadAccessoryProps,
  ) => ReadonlyArray<ExperimentalWebThreadAction>;
  readonly sidebarSection?: ComponentType;
  /**
   * Mounted once in the app shell while the primary environment is signed in,
   * next to core's notification coordinators. It shows nothing of its own;
   * use it for toasts and notifications the feature raises from anywhere.
   */
  readonly coordinator?: ComponentType;
  readonly rightPanelSurfaces?: ReadonlyArray<ExperimentalWebRightPanelSurfaceContribution>;
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
      | "invalid-shortcut"
      | "duplicate-right-panel-surface"
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

function assertShortcut(shortcut: string, field: string): void {
  if (!/^[A-Z]$/.test(shortcut) || CORE_RIGHT_PANEL_SHORTCUTS.has(shortcut)) {
    throw new WebFeatureInvariantError(
      "invalid-shortcut",
      `${field} shortcut '${shortcut}' must be one uppercase letter core's launcher does not use.`,
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
  for (const surface of feature.rightPanelSurfaces ?? []) {
    assertStableId(surface.id, `Right-panel surface id for '${feature.id}'`);
    assertLabel(surface.label, `Right-panel surface '${surface.id}'`);
    assertShortcut(surface.shortcut, `Right-panel surface '${surface.id}'`);
  }
  return feature;
}
