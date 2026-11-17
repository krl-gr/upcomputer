import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  ProviderDriverKind,
  type ProviderInstallState,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import { isScratchProject } from "@t3tools/client-runtime/state/projects";

import { hasProviderSetup } from "../components/chat/ProviderStatusBanner";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { productSurface } from "../product/productFlags";
import type { ProviderInstanceEntry } from "../providerInstances";

/*
 * The `onboarding` surface's decisions. With `upcomputer` a new user lands in
 * the app while it sets up OpenCode; /welcome is upstream's Welcome page.
 */

export function countReadyOnboardingProviders(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): number {
  return (
    providers?.filter(
      (provider) => provider.enabled && getOnboardingProviderState(provider) === "ready",
    ).length ?? 0
  );
}

const SETUP_TARGET_DRIVERS: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);

/**
 * Where the composer's "Open provider settings" goes when no agent works.
 * Upstream picks the first provider with in-app setup, which on a clean Mac
 * is Cursor: nobody installed it. An agent the user already installed comes
 * first, then Codex and Claude, then any with in-app setup.
 */
export function composerProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  if (productSurface("onboarding") !== "upcomputer") {
    return entries.find((entry) => hasProviderSetup(entry.snapshot))?.instanceId;
  }
  return resolveProviderSetupInstanceId(entries);
}

function resolveProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  const enabled = entries.filter((entry) => entry.enabled);
  const candidates = enabled.length > 0 ? enabled : entries;
  const rank = (entry: ProviderInstanceEntry) =>
    (entry.installed ? 0 : 4) +
    (SETUP_TARGET_DRIVERS.has(entry.driverKind) ? 0 : 2) +
    (hasProviderSetup(entry.snapshot) ? 0 : 1);
  let best: ProviderInstanceEntry | undefined;
  for (const entry of candidates) {
    if (best === undefined || rank(entry) < rank(best)) best = entry;
  }
  return best?.instanceId;
}

/*
 * A new user skips the agent table: the app installs OpenCode, whose free Zen
 * models answer without an account, and the composer shows that setup until
 * the first agent works.
 */
export const FIRST_RUN_AGENT_INSTANCE_ID = defaultInstanceIdForDriver(
  ProviderDriverKind.make("opencode"),
);

/**
 * OpenCode turns selectable as soon as settings turn it on, but lists no models
 * until its first check answers, and for a moment the stream still holds the
 * snapshot from while it was off. The composer keeps the setup state until
 * then, so its model picker never flashes "Choose model" in between.
 */
export function isFirstRunAgentChecking(entry: ProviderInstanceEntry | undefined): boolean {
  if (entry?.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID) return false;
  const { snapshot } = entry;
  return snapshot.statusPending === true || !snapshot.enabled || snapshot.status === "disabled";
}

/**
 * The projects that tell the first-run gate a workspace already exists. Home
 * opens the primary environment's scratch project ("No project") for a new
 * user at once, so it says nothing about them: counted, it would end first-run
 * setup before their first agent works.
 */
export function firstRunWorkspaceProjects<
  Project extends { readonly environmentId: EnvironmentId; readonly workspaceRoot: string },
>(
  projects: ReadonlyArray<Project>,
  primary: {
    readonly environmentId: EnvironmentId | null;
    readonly scratchWorkspaceRoot: string | null | undefined;
  },
): ReadonlyArray<Project> {
  return projects.filter(
    (project) =>
      project.environmentId !== primary.environmentId ||
      !isScratchProject(project, primary.scratchWorkspaceRoot),
  );
}

/** How long a new user's setup waits for the agents already on the Mac to answer their first check. */
export const FIRST_RUN_AGENT_CHECK_WAIT_MS = 10_000;

/**
 * Whether a new user's window installs OpenCode. A user whose own agent works
 * needs no download, so this waits for each turned-on agent's first check, but
 * a check that does not answer within `FIRST_RUN_AGENT_CHECK_WAIT_MS` does not
 * hold setup back.
 */
export function resolveFirstRunAgentStart(input: {
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly waitOver: boolean;
}): "wait" | "install" | "skip" {
  const others =
    input.providers?.filter(
      (provider) => provider.enabled && provider.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID,
    ) ?? [];
  if (others.some((provider) => getOnboardingProviderState(provider) === "ready")) return "skip";
  if (input.waitOver) return "install";
  if (!input.providers || others.some((provider) => provider.statusPending === true)) {
    return "wait";
  }
  return "install";
}

export type FirstRunAgentStart = "install" | "skip";

/**
 * The starter decides once per window session. After `skip`, or once
 * onboarding is complete, an agent of the user's that later stops working
 * (turned off, signed out, a failed recheck) starts no download.
 */
export function latchFirstRunAgentStart(input: {
  readonly latched: FirstRunAgentStart | null;
  readonly completed: boolean;
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly waitOver: boolean;
}): FirstRunAgentStart | null {
  if (input.latched !== null) return input.latched;
  if (input.completed) return "skip";
  const next = resolveFirstRunAgentStart(input);
  return next === "wait" ? null : next;
}

export type FirstRunAgentStatus =
  | { readonly kind: "preparing"; readonly progress: number | null }
  | { readonly kind: "failed"; readonly message: string };

const FIRST_RUN_SETUP_FAILED = "Could not set up your agent.";

/**
 * How long a new user may stay on the first screen with a working agent and
 * no turn before `onboarding.first_screen_idle` reports it. Reading the
 * screen and typing a first prompt fits well inside it, while a session that
 * ends without a turn is usually still open by then.
 */
export const FIRST_SCREEN_IDLE_THRESHOLD_MS = 3 * 60_000;

/** How long setup still shows once the install succeeds, while the server turns OpenCode on. */
export const FIRST_RUN_AGENT_ACTIVATION_WAIT_MS = 10_000;

/** The activation wait the starter is running, or has finished, for one succeeded install. */
export interface FirstRunAgentActivation {
  readonly operationId: string;
  readonly active: boolean;
}

/**
 * The starter records the wait in an effect, a render after the install
 * succeeds. Until then a running starter counts the wait as begun, or the
 * composer would offer "Open provider settings" for that one frame.
 */
export function isFirstRunAgentActivating(input: {
  readonly succeededOperationId: string | null;
  readonly starterRunning: boolean;
  readonly activation: FirstRunAgentActivation | null;
}): boolean {
  if (input.succeededOperationId === null) return false;
  if (input.activation?.operationId === input.succeededOperationId) {
    return input.activation.active;
  }
  return input.starterRunning;
}

export function resolveFirstRunAgentStatus(input: {
  readonly requested: boolean;
  readonly startError: string | null;
  readonly install: ProviderInstallState | null;
  readonly provider: ServerProvider | undefined;
  /** Within `FIRST_RUN_AGENT_ACTIVATION_WAIT_MS` of this window seeing the install succeed. */
  readonly activating: boolean;
}): FirstRunAgentStatus | null {
  const { install } = input;
  if (input.startError !== null && (install === null || install.phase === "idle")) {
    return { kind: "failed", message: input.startError };
  }
  switch (install?.phase) {
    case "downloading":
      return {
        kind: "preparing",
        progress:
          install.totalBytes !== null && install.totalBytes > 0
            ? Math.min(1, install.downloadedBytes / install.totalBytes)
            : null,
      };
    case "extracting":
    case "verifying":
      return { kind: "preparing", progress: 1 };
    case "failed":
    case "cancelled":
      return { kind: "failed", message: install.message ?? FIRST_RUN_SETUP_FAILED };
    case "succeeded": {
      const state = getOnboardingProviderState(input.provider);
      if (state === "ready") return null;
      if (state === "attention" || state === "install" || state === "signIn") {
        return { kind: "failed", message: input.provider?.message ?? FIRST_RUN_SETUP_FAILED };
      }
      if (state === "checking" && input.provider?.enabled === true) {
        return { kind: "preparing", progress: null };
      }
      // Until the turned-on instance reports, the stream still holds the disabled
      // one. Past that wait, OpenCode is off by the user's choice.
      return input.activating ? { kind: "preparing", progress: null } : null;
    }
    default:
      return input.requested ? { kind: "preparing", progress: null } : null;
  }
}
