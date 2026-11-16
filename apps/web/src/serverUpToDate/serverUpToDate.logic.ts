import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import type { useGT } from "gt-react";

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

/** What the user reads: its track's newest build, or a feed with nothing newer yet. */
export function describeServerUpToDate(
  label: string,
  report: UpToDateReport,
  gt: ReturnType<typeof useGT>,
): { readonly title: string; readonly description: string } {
  const { serverVersion, targetVersion } = report;
  const trackLabel = (version: string) =>
    desktopUpdateChannelOf(version) === "nightly"
      ? gt("Nightly", { $context: "desktop app update track" })
      : gt("Stable", { $context: "desktop app update track" });
  return onOtherTrack(serverVersion, targetVersion)
    ? {
        title: gt("{label} is up to date", { label }),
        description: gt(
          "It is on {serverTrack} {serverVersion}, the newest build on that track. This app runs {targetTrack}.",
          {
            serverTrack: trackLabel(serverVersion),
            serverVersion,
            targetTrack: trackLabel(targetVersion),
          },
        ),
      }
    : {
        title: gt("Nothing to install on {label} yet", { label }),
        description: gt(
          "Its update feed has nothing newer than {serverVersion} yet. Try again later.",
          { serverVersion },
        ),
      };
}
