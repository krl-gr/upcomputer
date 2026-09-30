import { isProviderAvailable, type ServerProvider } from "@upcomputer/contracts";

export function areInitialProviderProbesSettled(providers: ReadonlyArray<ServerProvider>): boolean {
  return (
    providers.length > 0 &&
    providers.every((provider) => !provider.enabled || provider.probeStatus !== "checking")
  );
}

/**
 * The single definition of "this agent will work now". Both the onboarding
 * gate and each onboarding row's verdict read it, so the screen can never
 * award a readiness checkmark to an instance the runtime would refuse for a
 * new session.
 *
 * `enabled` is part of the predicate but deliberately has no column of its
 * own in onboarding: a disabled-but-otherwise-ready instance surfaces as an
 * `Enable` action in the readiness cell instead.
 */
export function isProviderUsable(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    isProviderAvailable(provider) &&
    provider.models.length > 0 &&
    (provider.status === "ready" || provider.auth.status === "authenticated")
  );
}

export function hasUsableProvider(providers: ReadonlyArray<ServerProvider>): boolean {
  return providers.some(isProviderUsable);
}

export function countUsableProviders(providers: ReadonlyArray<ServerProvider>): number {
  return providers.filter(isProviderUsable).length;
}

/**
 * Readiness of one onboarding row, naming the single condition of
 * `isProviderUsable` that is still unmet. Never collapse these into one
 * "not connected" label: an agent that is signed in but exposes no models is
 * not the same problem as one that was never signed in, and describing the
 * first as a missing connection contradicts the server's own status.
 *
 * `checking` is distinct on purpose too — an empty readiness cell reads as
 * "not loaded yet" exactly as much as it reads as "not ready", and the
 * snapshot carries a real unknown (`probeStatus: "checking"`,
 * `auth.status: "unknown"`).
 */
export type ProviderOnboardingRowState =
  | "ready"
  | "checking"
  | "unavailable"
  | "not-installed"
  | "disabled"
  | "needs-auth"
  | "needs-models";

export function getProviderOnboardingRowState(
  provider: ServerProvider | undefined,
): ProviderOnboardingRowState {
  if (!provider) return "unavailable";
  if (isProviderUsable(provider)) return "ready";
  if (!isProviderAvailable(provider)) return "unavailable";
  if (provider.probeStatus === "checking") return "checking";
  if (!provider.installed) return "not-installed";
  if (!provider.enabled) return "disabled";
  if (provider.status !== "ready" && provider.auth.status !== "authenticated") return "needs-auth";
  return "needs-models";
}

export function shouldShowInitialProviderOnboarding(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly dismissed: boolean;
  readonly probeWaitExpired?: boolean;
}): boolean | null {
  if (input.dismissed) return false;
  if (hasUsableProvider(input.providers)) return false;
  if (!areInitialProviderProbesSettled(input.providers) && input.probeWaitExpired !== true) {
    return null;
  }
  return true;
}

/**
 * Onboarding stays closed when an agent already works, but a fresh workspace
 * still gets the project import step when Claude Code or Codex left projects
 * to import. `null` while the scan has not answered yet.
 */
export function shouldOfferInitialProjectImport(input: {
  readonly dismissed: boolean;
  /** Projects on the primary environment, not counting its scratch project. */
  readonly projectCount: number;
  readonly candidates: ReadonlyArray<{ readonly alreadyImported: boolean }> | null;
}): boolean | null {
  if (input.dismissed || input.projectCount > 0) return false;
  if (input.candidates === null) return null;
  return input.candidates.some((candidate) => !candidate.alreadyImported);
}
