import type { EnvironmentMachineKind, EnvironmentId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

import { isElectron } from "../env";
import { isWindowsPlatform } from "../lib/utils";
import { useQuietThreadShells } from "../state/entities";
import {
  useEnvironmentMachines,
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { resolveServerConfigVersionMismatch } from "../versionSkew";
import {
  countComputerRuns,
  NO_COMPUTER_RUNS,
  type ComputerRunCounts,
} from "./sidebarComputers.logic";

/** online: connected and current; outdated: connected but older, or too old to connect. */
export type ComputerStatus = "online" | "outdated" | "connecting" | "offline";

export interface SidebarComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly machine: EnvironmentMachineKind;
  readonly status: ComputerStatus;
  /** Too old to connect at all: only the update can bring it back. */
  readonly unsupported: boolean;
  readonly serverVersion: string | null;
  readonly description: string;
  readonly counts: ComputerRunCounts;
  readonly presentation: EnvironmentPresentation;
}

function platformComputerName(platform: string): string {
  if (isMacPlatform(platform)) return "This Mac";
  if (isWindowsPlatform(platform)) return "This PC";
  return "This computer";
}

/** The desktop app's own computer reads "This Mac"; a browser names every computer. */
function computerName(
  presentation: Pick<EnvironmentPresentation, "environmentId" | "label">,
  primaryId: EnvironmentId | null,
): string {
  if (isElectron && presentation.environmentId === primaryId) {
    return platformComputerName(typeof navigator === "undefined" ? "" : navigator.platform);
  }
  return presentation.label;
}

function computerStatus(presentation: EnvironmentPresentation): ComputerStatus {
  switch (presentation.connection.phase) {
    case "connected":
      return resolveServerConfigVersionMismatch(presentation.serverConfig) === null
        ? "online"
        : "outdated";
    case "unsupported":
      return "outdated";
    case "connecting":
    case "reconnecting":
      return "connecting";
    default:
      return "offline";
  }
}

function describeComputer(presentation: EnvironmentPresentation, status: ComputerStatus): string {
  const version = presentation.serverConfig?.environment.serverVersion ?? null;
  switch (status) {
    case "online":
      return version ? `Online, ${version}` : "Online";
    case "outdated":
      if (presentation.connection.phase === "unsupported") return "Update needed";
      return version ? `${version}, update available` : "Update available";
    case "connecting":
      return presentation.connection.phase === "reconnecting" ? "Reconnecting..." : "Connecting...";
    case "offline":
      return "Offline";
  }
}

/** The computers the switcher lists, in its order, with their status and run counts. */
export function useSidebarComputers(
  computerIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<SidebarComputer> {
  const { environments } = useEnvironments();
  const machines = useEnvironmentMachines();
  const primaryId = usePrimaryEnvironmentId();
  const threads = useQuietThreadShells();
  const localLastVisitedAt = useUiStateStore((store) => store.threadLastVisitedAtById);
  const counts = countComputerRuns(threads, localLastVisitedAt);
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  return computerIds.flatMap((environmentId) => {
    const presentation = byId.get(environmentId);
    if (presentation === undefined) return [];
    const status = computerStatus(presentation);
    return [
      {
        environmentId,
        name: computerName(presentation, primaryId),
        machine: machines.get(environmentId) ?? "server",
        status,
        unsupported: presentation.connection.phase === "unsupported",
        serverVersion: presentation.serverConfig?.environment.serverVersion ?? null,
        description: describeComputer(presentation, status),
        counts: counts.get(environmentId) ?? NO_COMPUTER_RUNS,
        presentation,
      },
    ];
  });
}

/** The name the sidebar uses for a computer, for labels outside the switcher. */
export function useComputerName(environmentId: EnvironmentId): string | null {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const presentation = environments.find(
    (environment) => environment.environmentId === environmentId,
  );
  return presentation === undefined ? null : computerName(presentation, primaryId);
}
