import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useServerConfigs } from "../state/entities";
import { serverEnvironment } from "../state/server";
import {
  describeServerUpToDate,
  isStillUpToDate,
  type UpToDateReport,
  upToDateReportToRemember,
} from "./serverUpToDate.logic";

/*
 * Desktop hosts on another track whose own update feed had nothing newer
 * (UpComputer). Asking again cannot succeed until the host's version or the
 * version this app offers changes, so the update is not offered until then.
 */

const UpToDateReports = Schema.Record(
  Schema.String,
  Schema.Struct({ serverVersion: Schema.String, targetVersion: Schema.String }),
);
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

/** Whether an update for this host is one it already answered it can never get. */
export function useIsServerStillUpToDate(): (target: {
  readonly environmentId: EnvironmentId;
  readonly targetVersion: string;
}) => boolean {
  const reports = useAtomValue(reportsAtom);
  const configs = useServerConfigs();
  return (target) =>
    isStillUpToDate(
      reports[target.environmentId],
      configs.get(target.environmentId)?.environment.serverVersion,
      target.targetVersion,
    );
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
  const report = { serverVersion, targetVersion: target.targetVersion };
  const remembered = upToDateReportToRemember(report);
  if (remembered !== null) recordServerUpToDate(target.environmentId, remembered);
  toastManager.add(
    stackedThreadToast({ type: "info", ...describeServerUpToDate(target.serverLabel, report) }),
  );
  return { status: "current", version: serverVersion };
}
