import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export interface NotificationsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase;
  readonly providers: ReadonlyArray<ServerProvider>;
}

export interface ComputerOutage {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** The connection stopped on an error and waits for Retry; otherwise it keeps trying. */
  readonly stopped: boolean;
}

export interface ProviderUpdate {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ServerProvider["instanceId"];
  readonly version: string | null;
  readonly latestVersion: string;
  /** The computer's name, when updates come from more than one computer. */
  readonly machineLabel: string | null;
}

/**
 * The desktop bell's computer cards: a computer that dropped, or never came up, while it was
 * kept. A first connection is not an outage, so `connecting` waits for its outcome.
 */
export function computerOutages(
  environments: ReadonlyArray<NotificationsEnvironment>,
): ReadonlyArray<ComputerOutage> {
  return environments.flatMap((environment) =>
    environment.phase === "error" ||
    environment.phase === "offline" ||
    environment.phase === "reconnecting"
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            stopped: environment.phase === "error",
          },
        ]
      : [],
  );
}

/**
 * The desktop bell's provider update cards: one per provider CLI a connected computer can
 * update in one step, the default instance standing for its driver.
 */
export function providerUpdates(
  environments: ReadonlyArray<NotificationsEnvironment>,
  canUpdate: (provider: ServerProvider) => boolean,
): ReadonlyArray<ProviderUpdate> {
  const machines = environments.flatMap((environment) => {
    if (environment.phase !== "connected") return [];
    const byDriver = new Map<ProviderDriverKind, ServerProvider>();
    for (const provider of environment.providers) {
      if (!canUpdate(provider) || byDriver.has(provider.driver)) continue;
      byDriver.set(provider.driver, provider);
    }
    return byDriver.size > 0 ? [{ environment, providers: [...byDriver.values()] }] : [];
  });
  return machines.flatMap(({ environment, providers }) =>
    providers.map((provider) => ({
      key: `${environment.environmentId}:${provider.instanceId}`,
      environmentId: environment.environmentId,
      name: PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.displayName ?? provider.driver,
      driver: provider.driver,
      instanceId: provider.instanceId,
      version: provider.version,
      latestVersion: provider.versionAdvisory?.latestVersion ?? "",
      machineLabel: machines.length > 1 ? environment.label : null,
    })),
  );
}
