import type { EnvironmentMachineKind, EnvironmentId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

import { isElectron } from "../env";
import { isWindowsPlatform } from "../lib/utils";
import { useIsServerStillUpToDate } from "../serverUpToDate/serverUpToDate";
import { useDelegatedUnderParent, useQuietThreadShells } from "../state/entities";
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
  /** Offline or too old to connect: the sidebar shows what it had when last connected. */
  readonly stale: boolean;
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

/** A host on another track that already answered it is current is online, not behind. */
function computerStatus(presentation: EnvironmentPresentation, upToDate: boolean): ComputerStatus {
  switch (presentation.connection.phase) {
    case "connected":
      return upToDate || resolveServerConfigVersionMismatch(presentation.serverConfig) === null
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

function describeComputer(
  presentation: EnvironmentPresentation,
  status: ComputerStatus,
  upToDate: boolean,
): string {
  const version = presentation.serverConfig?.environment.serverVersion ?? null;
  switch (status) {
    case "online":
      if (upToDate && version) return `Online, ${version}, up to date on its track`;
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

/** The computers the Computers section lists, in its order, with their status and run counts. */
export function useSidebarComputers(
  computerIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<SidebarComputer> {
  const { environments } = useEnvironments();
  const machines = useEnvironmentMachines();
  const primaryId = usePrimaryEnvironmentId();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAt = useUiStateStore((store) => store.threadLastVisitedAtById);
  const counts = countComputerRuns(threads, delegatedUnderParent, localLastVisitedAt);
  const isServerStillUpToDate = useIsServerStillUpToDate();
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  return computerIds.flatMap((environmentId) => {
    const presentation = byId.get(environmentId);
    if (presentation === undefined) return [];
    const mismatch = resolveServerConfigVersionMismatch(presentation.serverConfig);
    const upToDate =
      mismatch !== null &&
      isServerStillUpToDate({ environmentId, targetVersion: mismatch.clientVersion });
    const status = computerStatus(presentation, upToDate);
    return [
      {
        environmentId,
        name: computerName(presentation, primaryId),
        machine: machines.get(environmentId) ?? "server",
        status,
        unsupported: presentation.connection.phase === "unsupported",
        stale:
          status === "offline" ||
          (status === "outdated" && presentation.connection.phase === "unsupported"),
        serverVersion: presentation.serverConfig?.environment.serverVersion ?? null,
        description: describeComputer(presentation, status, upToDate),
        counts: counts.get(environmentId) ?? NO_COMPUTER_RUNS,
        presentation,
      },
    ];
  });
}

/** The name the sidebar uses for a computer, for labels outside the Computers section. */
export function useComputerName(environmentId: EnvironmentId): string | null {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const presentation = environments.find(
    (environment) => environment.environmentId === environmentId,
  );
  return presentation === undefined ? null : computerName(presentation, primaryId);
}
