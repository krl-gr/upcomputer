import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";

import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";

/** An agent other than the free agent (OpenCode) works: setup with the free agent is over. */
export function realAgentConnected(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): boolean {
  return (
    providers?.some(
      (provider) =>
        provider.driver !== "opencode" &&
        provider.enabled &&
        getOnboardingProviderState(provider) === "ready",
    ) ?? false
  );
}

type ProviderReader = (
  environmentId: EnvironmentId,
) => ReadonlyArray<ServerProvider> | null | undefined;

let readProviders: ProviderReader | null = null;

/** Set by the onboarding surface, which owns the app's provider state, when the chat loads. */
export function setStarPromptProviderReader(reader: ProviderReader | null): void {
  readProviders = reader;
}

/**
 * The GitHub star prompt neither counts nor asks while the free agent is the only
 * working agent. Without a reader nothing holds it back.
 */
export function starPromptWaitsForRealAgent(environmentId: EnvironmentId): boolean {
  return readProviders !== null && !realAgentConnected(readProviders(environmentId));
}
