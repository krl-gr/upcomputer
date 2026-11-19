import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type FirstRunAgentFailureReason,
  ProviderDriverKind,
  type ProviderInstallState,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { msg } from "gt-react";

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
  | {
      readonly kind: "preparing";
      readonly progress: number | null;
      /** Installed, and still starting past `FIRST_RUN_AGENT_SLOW_START_MS`. */
      readonly slow: boolean;
    }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly reason: FirstRunAgentFailureReason;
    };

/** Shown through `useMessages()`, like the status's other text of ours. */
export const FIRST_RUN_SETUP_FAILED = msg("Could not set up your agent.");
export const FIRST_RUN_START_TIMED_OUT = msg("Your agent is taking too long to start.");

/**
 * How long a new user may stay on the first screen with a working agent and
 * no turn before `onboarding.first_screen_idle` reports it. Reading the
 * screen and typing a first prompt fits well inside it, while a session that
 * ends without a turn is usually still open by then.
 */
export const FIRST_SCREEN_IDLE_THRESHOLD_MS = 3 * 60_000;

/**
 * The first start of a freshly installed OpenCode: a healthy Mac answers within
 * about 15 s of the install, while the server's own deadlines for a cold start
 * (a 20 s `--version`, a 15 s catalog refresh, a 30 s `serve`, a 15 s model
 * list) add up to about 80 s, on Windows behind a Defender scan of a new exe.
 */
export const FIRST_RUN_AGENT_SLOW_START_MS = 15_000;
export const FIRST_RUN_AGENT_START_TIMEOUT_MS = 90_000;

/**
 * One attempt to start the installed OpenCode: the install's own, then one per
 * Retry. The starter times it, so the composer always shows where it is.
 */
export interface FirstRunAgentStartup {
  readonly operationId: string;
  readonly attempt: number;
  readonly startedAt: number;
  /** The failed result a Retry was pressed on, which says nothing about this attempt. */
  readonly retriedCheckedAt: string | null;
  /** `ready` once OpenCode worked: what it does later is no first-run failure. */
  readonly phase: "starting" | "slow" | "timedOut" | "ready";
  /** The app's own second attempt, which goes on from the first one's "still starting". */
  readonly automatic: boolean;
  /** OpenCode was on during this install's start, so turning it off is the user's choice. */
  readonly sawEnabled: boolean;
}

/**
 * A first run retries a failure once by itself before it offers Retry:
 * `available` until then, `used` after, recording the failed install it
 * replaced, and `off` for a window that is not setting up its own OpenCode.
 */
export type FirstRunAgentAutoRetry =
  | { readonly kind: "available" }
  | { readonly kind: "used"; readonly failedInstallId: string | null }
  | { readonly kind: "off" };

/** A sign-in or an empty model list fails the same way again, so those wait for the user. */
const AUTO_RETRY_REASONS: ReadonlySet<FirstRunAgentFailureReason> = new Set([
  "install",
  "startup_timeout",
  "migration",
  "unknown",
]);

export function firstRunAgentStartupPhase(elapsedMs: number): "starting" | "slow" | "timedOut" {
  if (elapsedMs >= FIRST_RUN_AGENT_START_TIMEOUT_MS) return "timedOut";
  return elapsedMs >= FIRST_RUN_AGENT_SLOW_START_MS ? "slow" : "starting";
}

function providerFailureReason(provider: ServerProvider | undefined): FirstRunAgentFailureReason {
  return (
    provider?.statusReason ?? (provider?.auth.status === "unauthenticated" ? "auth" : "unknown")
  );
}

const preparing = (progress: number | null, slow = false): FirstRunAgentStatus => ({
  kind: "preparing",
  progress,
  slow,
});

/** After the install succeeded. `startup` is the starter's record for that install, if any yet. */
function resolveInstalledAgentStatus(
  provider: ServerProvider | undefined,
  startup: FirstRunAgentStartup | null,
  starterRunning: boolean,
): FirstRunAgentStatus | null {
  const state = getOnboardingProviderState(provider);
  if (state === "ready") return null;
  if (state === "disabled" && startup?.sawEnabled === true) return null;
  const answered =
    startup?.retriedCheckedAt == null || provider?.checkedAt !== startup.retriedCheckedAt;
  if (answered && (state === "attention" || state === "install" || state === "signIn")) {
    return {
      kind: "failed",
      message: provider?.message ?? FIRST_RUN_SETUP_FAILED,
      reason: providerFailureReason(provider),
    };
  }
  const checking = state === "checking" && provider?.enabled === true;
  switch (startup?.phase) {
    case "starting":
      return preparing(null, startup.automatic);
    case "slow":
      return preparing(null, true);
    case "timedOut":
      return { kind: "failed", message: FIRST_RUN_START_TIMED_OUT, reason: "startup_timeout" };
    case "ready":
      // A later recheck. Off now is the user's choice.
      return checking ? preparing(null) : null;
    default:
      // The starter records the attempt in an effect, a render after the install
      // succeeds. Without a starter, this install is not this window's setup.
      return checking || starterRunning ? preparing(null) : null;
  }
}

interface FirstRunAgentStatusInput {
  readonly requested: boolean;
  readonly startError: string | null;
  readonly install: ProviderInstallState | null;
  readonly provider: ServerProvider | undefined;
  readonly startup: FirstRunAgentStartup | null;
  readonly starterRunning: boolean;
}

function resolveFirstRunAgentOwnStatus(
  input: FirstRunAgentStatusInput,
): FirstRunAgentStatus | null {
  const { install } = input;
  // A new start's own error: it clears any earlier one before it asks the server.
  if (
    input.startError !== null &&
    (install === null ||
      install.phase === "idle" ||
      install.phase === "failed" ||
      install.phase === "cancelled")
  ) {
    return { kind: "failed", message: input.startError, reason: "install" };
  }
  switch (install?.phase) {
    case "downloading":
      return preparing(
        install.totalBytes !== null && install.totalBytes > 0
          ? Math.min(1, install.downloadedBytes / install.totalBytes)
          : null,
      );
    case "extracting":
    case "verifying":
      return preparing(1);
    case "failed":
    case "cancelled":
      return {
        kind: "failed",
        message: install.message ?? FIRST_RUN_SETUP_FAILED,
        reason: "install",
      };
    case "succeeded":
      return resolveInstalledAgentStatus(
        input.provider,
        input.startup?.operationId === install.operationId ? input.startup : null,
        input.starterRunning,
      );
    default:
      return input.requested ? preparing(null) : null;
  }
}

/** What the automatic retry of a first run runs now, if it is due. */
export function resolveFirstRunAgentAutoRetry(
  input: FirstRunAgentStatusInput & { readonly autoRetry: FirstRunAgentAutoRetry },
): "install" | "start" | null {
  if (input.autoRetry.kind !== "available") return null;
  const status = resolveFirstRunAgentOwnStatus(input);
  if (status?.kind !== "failed" || !AUTO_RETRY_REASONS.has(status.reason)) return null;
  if (status.reason === "install") return "install";
  // The starter records the attempt a render after the install; the retry is its next one.
  return input.startup !== null && input.startup.operationId === input.install?.operationId
    ? "start"
    : null;
}

export function resolveFirstRunAgentStatus(
  input: FirstRunAgentStatusInput & { readonly autoRetry: FirstRunAgentAutoRetry },
): FirstRunAgentStatus | null {
  const status = resolveFirstRunAgentOwnStatus(input);
  if (status?.kind !== "failed" || !AUTO_RETRY_REASONS.has(status.reason)) return status;
  const { autoRetry, install } = input;
  // The retry is due, or still waits for the server to replace the install it retried.
  const retrying =
    autoRetry.kind === "available" ||
    (autoRetry.kind === "used" &&
      input.startError === null &&
      (install?.phase === "failed" || install?.phase === "cancelled") &&
      install.operationId !== null &&
      install.operationId === autoRetry.failedInstallId);
  return retrying ? preparing(null, status.reason !== "install") : status;
}

/**
 * Why the attempt failed after a good install, for `onboarding.first_run_agent`
 * `failed`: OpenCode's reported error, or no answer by the timeout. Null while
 * it may still work, and once it worked.
 */
export function resolveFirstRunAgentStartupFailure(input: {
  readonly install: ProviderInstallState | null;
  readonly provider: ServerProvider | undefined;
  readonly startup: FirstRunAgentStartup | null;
}): FirstRunAgentFailureReason | null {
  const { install, startup } = input;
  if (install?.phase !== "succeeded" || startup === null) return null;
  if (startup.operationId !== install.operationId || startup.phase === "ready") return null;
  const status = resolveInstalledAgentStatus(input.provider, startup, true);
  return status?.kind === "failed" ? status.reason : null;
}
