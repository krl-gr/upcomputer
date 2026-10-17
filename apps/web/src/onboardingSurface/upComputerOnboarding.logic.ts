import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

import { hasProviderSetup } from "../components/chat/ProviderStatusBanner";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { productSurface } from "../product/productFlags";
import type { ProviderInstanceEntry } from "../providerInstances";

/*
 * The `onboarding` surface's decisions. With `upstream` the first run is
 * exactly upstream's WelcomeWizard; with `upcomputer` it is V1's agent table
 * (`UpComputerOnboarding.tsx`) on top of upstream's provider logic.
 */

export type UpComputerOnboardingDriver = "codex" | "claudeAgent";

/** The agents first run offers; more live in Settings. */
export const UPCOMPUTER_ONBOARDING_DRIVERS: ReadonlyArray<UpComputerOnboardingDriver> = [
  "codex",
  "claudeAgent",
];

/**
 * Our screens set up agents on the server this window is paired with, so
 * they need one. Hosted web without a local server keeps upstream's wizard,
 * whose Connect step is how it gets a computer at all.
 */
export function showsUpComputerOnboarding(input: {
  readonly localAvailable: boolean;
  readonly environmentId: EnvironmentId | undefined;
}): boolean {
  return (
    productSurface("onboarding") === "upcomputer" &&
    input.localAvailable &&
    input.environmentId !== undefined
  );
}

/**
 * Upstream treats a Codex instance without `setupMode` as "existing CLI" but
 * still offers ChatGPT; only an explicit choice shows the CLI steps.
 */
export function isCodexExistingCliChosen(config: unknown): boolean {
  return (
    config !== null &&
    typeof config === "object" &&
    "setupMode" in config &&
    config.setupMode === "existing"
  );
}

export type AgentInstallCell = "checking" | "installed" | "included" | "install";

/** Managed Codex needs no install step: "Continue with ChatGPT" downloads it. */
export function resolveAgentInstallCell(input: {
  readonly driver: UpComputerOnboardingDriver;
  readonly provider: ServerProvider | undefined;
  readonly codexExistingCli: boolean;
}): AgentInstallCell {
  const state = getOnboardingProviderState(input.provider);
  if (state === "checking") return "checking";
  if (input.provider?.installed) return "installed";
  if (input.driver === "codex" && !input.codexExistingCli) return "included";
  return "install";
}

export type AgentReadyCell =
  | "ready"
  | "checking"
  | "enable"
  | "connect"
  | "sign-in"
  | "install-first"
  | "fix";

export function resolveAgentReadyCell(input: {
  readonly driver: UpComputerOnboardingDriver;
  readonly provider: ServerProvider | undefined;
}): AgentReadyCell {
  const state = getOnboardingProviderState(input.provider);
  switch (state) {
    case "ready":
      return "ready";
    case "checking":
      return "checking";
    case "disabled":
      return "enable";
  }
  // Codex signs in from its own screen, managed or CLI, so it always opens it.
  if (input.driver === "codex") return "connect";
  if (state === "install") return "install-first";
  return state === "signIn" ? "sign-in" : "fix";
}

/**
 * One short line under the agent's name. Provider messages stay out: they
 * are written for Settings ("Check Settings → Providers → Codex → Binary
 * path on the server") and read as an error on a first run.
 */
export function describeOnboardingAgent(input: {
  readonly driver: UpComputerOnboardingDriver;
  readonly provider: ServerProvider | undefined;
  readonly codexExistingCli: boolean;
}): string {
  const state = getOnboardingProviderState(input.provider);
  const codex = input.driver === "codex";
  switch (state) {
    case "ready":
      return "Ready to code.";
    case "checking":
      return "Checking this computer...";
    case "disabled":
      return "Turned off. Turn it on to use it.";
    case "signIn":
      return codex && !input.codexExistingCli
        ? "Sign in with your ChatGPT account."
        : "Installed. Sign in to start.";
    case "attention":
      return "Needs attention. Open its screen to fix it.";
    case "install":
      if (codex) {
        return input.codexExistingCli
          ? "Codex CLI is not installed yet."
          : "Uses your ChatGPT plan. Up.computer downloads Codex for you.";
      }
      return "Uses your Claude plan. Installs in one step.";
  }
}

export function countReadyOnboardingProviders(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): number {
  return (
    providers?.filter(
      (provider) => provider.enabled && getOnboardingProviderState(provider) === "ready",
    ).length ?? 0
  );
}

/**
 * After an agent works: import when a scan found something (or is still
 * looking), otherwise finish without an empty "no projects found" step.
 */
export function resolveProjectImportOffer(
  scans: ReadonlyArray<{
    readonly data: { readonly candidates: ReadonlyArray<unknown> } | null;
    readonly isPending: boolean;
  }>,
): "offer" | "skip" {
  return scans.some(
    (scan) => (scan.data?.candidates.length ?? 0) > 0 || (scan.isPending && scan.data === null),
  )
    ? "offer"
    : "skip";
}

const SETUP_TARGET_DRIVERS: ReadonlyArray<string> = UPCOMPUTER_ONBOARDING_DRIVERS;

/**
 * Where the composer's "Open provider settings" goes when no agent works.
 * Upstream picks the first provider with in-app setup, which on a clean Mac
 * is Cursor: nobody installed it. An agent the user already installed comes
 * first, then the agents first run offers, then any with in-app setup.
 */
export function composerProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  if (productSurface("onboarding") !== "upcomputer") {
    return entries.find((entry) => hasProviderSetup(entry.snapshot))?.instanceId;
  }
  return resolveProviderSetupInstanceId(entries);
}

export function resolveProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  const enabled = entries.filter((entry) => entry.enabled);
  const candidates = enabled.length > 0 ? enabled : entries;
  const rank = (entry: ProviderInstanceEntry) =>
    (entry.installed ? 0 : 4) +
    (SETUP_TARGET_DRIVERS.includes(entry.driverKind) ? 0 : 2) +
    (hasProviderSetup(entry.snapshot) ? 0 : 1);
  let best: ProviderInstanceEntry | undefined;
  for (const entry of candidates) {
    if (best === undefined || rank(entry) < rank(best)) best = entry;
  }
  return best?.instanceId;
}
