import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";

export interface UpToDateReport {
  readonly serverVersion: string;
  readonly targetVersion: string;
}

const onOtherTrack = (serverVersion: string, targetVersion: string) =>
  desktopUpdateChannelOf(serverVersion) !== desktopUpdateChannelOf(targetVersion);

/**
 * What to remember from an up-to-date answer. Only a host on another track
 * than the offered version can never reach it from its own feed; on the same
 * track its feed may just lag, so the update stays on offer.
 */
export function upToDateReportToRemember(report: UpToDateReport): UpToDateReport | null {
  return onOtherTrack(report.serverVersion, report.targetVersion) ? report : null;
}

/** The host's last answer still holds: neither its version nor the offered one changed since. */
export function isStillUpToDate(
  report: UpToDateReport | undefined,
  serverVersion: string | null | undefined,
  targetVersion: string,
): boolean {
  return (
    report !== undefined &&
    report.serverVersion === serverVersion &&
    report.targetVersion === targetVersion &&
    onOtherTrack(report.serverVersion, report.targetVersion)
  );
}

const trackLabel = (version: string) =>
  desktopUpdateChannelOf(version) === "nightly" ? "Nightly" : "Stable";

/** What the user reads: its track's newest build, or a feed with nothing newer yet. */
export function describeServerUpToDate(
  label: string,
  report: UpToDateReport,
): { readonly title: string; readonly description: string } {
  const { serverVersion, targetVersion } = report;
  return onOtherTrack(serverVersion, targetVersion)
    ? {
        title: `${label} is up to date`,
        description: `It is on ${trackLabel(serverVersion)} ${serverVersion}, the newest build on that track. This app runs ${trackLabel(targetVersion)}.`,
      }
    : {
        title: `Nothing to install on ${label} yet`,
        description: `Its update feed has nothing newer than ${serverVersion} yet. Try again later.`,
      };
}
