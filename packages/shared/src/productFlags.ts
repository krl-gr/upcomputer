/**
 * Upstream features a product build can hide.
 *
 * Hiding instead of deleting keeps upstream syncs cheap: the upstream code
 * stays, and a few hook points read these flags. Core defaults keep upstream
 * behaviour (`UPSTREAM_PRODUCT_FLAGS`); the UpComputer product, meaning the
 * public build and pro, passes `UPCOMPUTER_PRODUCT_FLAGS` to its server and
 * web compositions. The hook points are listed in
 * `docs/internals/product-flags.md`.
 */
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

export interface ProductFlags {
  /** Pull requests: the PR page, panels, badges, PR watch and sync, the PR agent tools. */
  readonly pullRequests: boolean;
  /** The integrated terminal, with project scripts and "Run in terminal". */
  readonly terminal: boolean;
  /** The settled-thread lifecycle: settle, auto-settle, the Settled section. Snooze stays. */
  readonly threadSettlement: boolean;
  /** Devices and simulators: the device panel, its settings, the device agent tools. */
  readonly devices: boolean;
}

export type ProductFlag = keyof ProductFlags;

export const UPSTREAM_PRODUCT_FLAGS: ProductFlags = Object.freeze({
  pullRequests: true,
  terminal: true,
  threadSettlement: true,
  devices: true,
});

export const UPCOMPUTER_PRODUCT_FLAGS: ProductFlags = Object.freeze({
  pullRequests: false,
  terminal: false,
  threadSettlement: false,
  devices: false,
});

/**
 * UI surfaces a product can replace with its own version. Each one is either
 * `upstream` (exactly upstream's UI) or `upcomputer` (the product's version,
 * in the product's own files, behind a minimal hook in upstream's file). Web
 * reads them through `productSurface` in `apps/web/src/product/productFlags.ts`.
 */
export type ProductSurfaceVariant = "upstream" | "upcomputer";

export interface ProductSurfaces {
  /** The sidebar's Projects section, in place of the header's project scope button. */
  readonly sidebarProjects: ProductSurfaceVariant;
  /**
   * Sidebar thread rows. With `upcomputer` the user picks them in Settings,
   * Appearance, "Thread list": compact rows (the default) or upstream's.
   */
  readonly sidebarThreadRow: ProductSurfaceVariant;
  /**
   * The sidebar's titlebar row. With `upcomputer` it shows no brand and no
   * stage badge, and the sidebar toggle lines up with the sidebar's row icons.
   */
  readonly sidebarHeader: ProductSurfaceVariant;
}

export type ProductSurface = keyof ProductSurfaces;

export const UPSTREAM_PRODUCT_SURFACES: ProductSurfaces = Object.freeze({
  sidebarProjects: "upstream",
  sidebarThreadRow: "upstream",
  sidebarHeader: "upstream",
});

export const UPCOMPUTER_PRODUCT_SURFACES: ProductSurfaces = Object.freeze({
  sidebarProjects: "upcomputer",
  sidebarThreadRow: "upcomputer",
  sidebarHeader: "upcomputer",
});

type CapabilityKey = {
  [K in keyof ExecutionEnvironmentCapabilities]-?: NonNullable<
    ExecutionEnvironmentCapabilities[K]
  > extends boolean
    ? K
    : never;
}[keyof ExecutionEnvironmentCapabilities];

interface HiddenPieces {
  /** Environment capabilities the server stops advertising, so every client hides their UI. */
  readonly capabilities: ReadonlyArray<CapabilityKey>;
  /** Keybinding commands dropped from the resolved bindings, by prefix or exact name. */
  readonly keybindingCommands: ReadonlyArray<string>;
  /** Settings search items, by id. Keybinding items follow `keybindingCommands`. */
  readonly settingsSearchIds: ReadonlyArray<string>;
  /** Right-panel launcher entries, by label. */
  readonly rightPanelSurfaces: ReadonlyArray<string>;
}

const HIDDEN_PIECES: Readonly<Record<ProductFlag, HiddenPieces>> = {
  pullRequests: {
    capabilities: [
      "pullRequests",
      "pullRequestChecks",
      "threadPullRequests",
      "threadPullRequestWatch",
      "pullRequestStackActions",
      "threadPullRequestLinking",
    ],
    keybindingCommands: ["pullRequest."],
    settingsSearchIds: [
      "pull-request-merge-method",
      "github-routing",
      "auto-settle-merged-threads",
    ],
    rightPanelSurfaces: ["Pull request", "Linked pull requests"],
  },
  terminal: {
    capabilities: [],
    // Project scripts run in the terminal, so their commands go with it.
    keybindingCommands: ["terminal.", "script."],
    settingsSearchIds: ["terminal-font"],
    rightPanelSurfaces: ["Terminal"],
  },
  threadSettlement: {
    capabilities: ["threadSettlement", "threadAutoSettlement", "threadAutoSettleOptOut"],
    keybindingCommands: ["thread.settle"],
    settingsSearchIds: [
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ],
    rightPanelSurfaces: [],
  },
  devices: {
    capabilities: [],
    keybindingCommands: [],
    settingsSearchIds: [
      "device-hosts",
      "agent-device-access",
      "device-hub",
      "device-platform-support",
    ],
    rightPanelSurfaces: ["Device"],
  },
};

function hiddenPieces(flags: ProductFlags): ReadonlyArray<HiddenPieces> {
  return (Object.keys(HIDDEN_PIECES) as ProductFlag[])
    .filter((flag) => !flags[flag])
    .map((flag) => HIDDEN_PIECES[flag]);
}

/** Capability overrides for the environment descriptor; empty with upstream flags. */
export function hiddenProductCapabilities(
  flags: ProductFlags,
): Partial<Record<CapabilityKey, false>> {
  return Object.fromEntries(
    hiddenPieces(flags).flatMap((pieces) => pieces.capabilities.map((key) => [key, false])),
  );
}

function matchesCommand(patterns: ReadonlyArray<string>, command: string): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith(".") ? command.startsWith(pattern) : command === pattern,
  );
}

export function isProductKeybindingCommandShown(flags: ProductFlags, command: string): boolean {
  return !hiddenPieces(flags).some((pieces) => matchesCommand(pieces.keybindingCommands, command));
}

const KEYBINDING_SEARCH_ID_PREFIX = "keybinding-";

export function isProductSettingsSearchItemShown(flags: ProductFlags, id: string): boolean {
  if (id.startsWith(KEYBINDING_SEARCH_ID_PREFIX)) {
    return isProductKeybindingCommandShown(flags, id.slice(KEYBINDING_SEARCH_ID_PREFIX.length));
  }
  return !hiddenPieces(flags).some((pieces) => pieces.settingsSearchIds.includes(id));
}

export function isProductRightPanelSurfaceShown(flags: ProductFlags, label: string): boolean {
  return !hiddenPieces(flags).some((pieces) => pieces.rightPanelSurfaces.includes(label));
}
