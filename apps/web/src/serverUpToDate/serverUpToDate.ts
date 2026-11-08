import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { APP_VERSION } from "../branding";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";

/*
 * Desktop hosts whose own update feed had nothing newer than the version they
 * run (UpComputer). Asking again cannot succeed until that version or the
 * version this app offers changes, so the update is not offered until then.
 */

const UpToDateReport = Schema.Struct({
  serverVersion: Schema.String,
  targetVersion: Schema.String,
});
type UpToDateReport = typeof UpToDateReport.Type;
const UpToDateReports = Schema.Record(Schema.String, UpToDateReport);
type UpToDateReports = typeof UpToDateReports.Type;

const STORAGE_KEY = "upcomputer:server-up-to-date:v1";

function readStoredReports(): UpToDateReports {
  try {
    return getLocalStorageItem(STORAGE_KEY, UpToDateReports) ?? {};
  } catch {
    return {};
  }
}

const reportsAtom = Atom.make<UpToDateReports>(readStoredReports()).pipe(
  Atom.keepAlive,
  Atom.withLabel("server-up-to-date-reports"),
);

function recordServerUpToDate(environmentId: EnvironmentId, report: UpToDateReport): void {
  const next = { ...appAtomRegistry.get(reportsAtom), [environmentId]: report };
  appAtomRegistry.set(reportsAtom, next);
  try {
    setLocalStorageItem(STORAGE_KEY, next, UpToDateReports);
  } catch {}
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
    report.targetVersion === targetVersion
  );
}

export function useServerUpToDateReports(): UpToDateReports {
  return useAtomValue(reportsAtom);
}

const trackLabel = (version: string) =>
  desktopUpdateChannelOf(version) === "nightly" ? "Nightly" : "Stable";

/** Where the host stays, and its track when this app runs another one. */
function describeServerUpToDate(version: string, appVersion: string = APP_VERSION): string {
  const track = trackLabel(version);
  const appTrack = trackLabel(appVersion);
  return track === appTrack
    ? `It has ${version}, the newest build its update feed offers.`
    : `It is on ${track} ${version}, the newest build on that track. This app runs ${appTrack}.`;
}

export const SERVER_UP_TO_DATE_NOTE = "Up to date on its track";

/**
 * The host's desktop app installed nothing: its own feed has nothing newer.
 * Always reported, since no caller's summary covers it.
 */
export function reportServerUpToDate(
  target: {
    readonly environmentId: EnvironmentId;
    readonly serverLabel: string;
    readonly targetVersion: string;
  },
  version: string,
): { readonly status: "current"; readonly version: string } {
  const serverVersion =
    appAtomRegistry.get(serverEnvironment.configValueAtom(target.environmentId))?.environment
      .serverVersion ?? version;
  recordServerUpToDate(target.environmentId, {
    serverVersion,
    targetVersion: target.targetVersion,
  });
  toastManager.add(
    stackedThreadToast({
      type: "info",
      title: `${target.serverLabel} is up to date`,
      description: describeServerUpToDate(serverVersion),
    }),
  );
  return { status: "current", version: serverVersion };
}
