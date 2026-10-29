import type { BackgroundNotice, DesktopUpdateState, EnvironmentId } from "@t3tools/contracts";

import {
  getDesktopUpdateDisabledReason,
  getDesktopUpdateDownloadedVersion,
  type DesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";

/** A repeat of the same problem shows again, so dismissal is per occurrence. */
export function backgroundNoticeDismissalKey(notice: BackgroundNotice): string {
  return `${notice.id}@${notice.occurredAt}`;
}

export function visibleBackgroundNotices<Notice extends BackgroundNotice>(
  noticeLists: ReadonlyArray<ReadonlyArray<Notice> | undefined>,
  dismissed: ReadonlySet<string>,
): Notice[] {
  return noticeLists
    .flatMap((notices) => notices ?? [])
    .filter((notice) => !dismissed.has(backgroundNoticeDismissalKey(notice)))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** A notice's in-app link, on the computer the notice came from. */
export function backgroundNoticeHref(path: string, environmentId: EnvironmentId): string {
  const url = new URL(path, "http://notice.invalid");
  url.searchParams.set("environment", environmentId);
  return `${url.pathname}${url.search}`;
}

/** What the footer button says about updates. A running Update everything has its own capsule. */
export type SidebarUpdateSignal =
  | { readonly kind: "none" }
  | { readonly kind: "available" }
  | { readonly kind: "downloading"; readonly percent: number | null }
  | { readonly kind: "ready" };

export function resolveSidebarUpdateSignal({
  state,
  action,
  hasOtherUpdates,
  running,
}: {
  readonly state: Pick<DesktopUpdateState, "status" | "downloadPercent"> | null;
  readonly action: DesktopUpdateButtonAction;
  /** Servers or provider CLIs that Update everything would update. */
  readonly hasOtherUpdates: boolean;
  readonly running: boolean;
}): SidebarUpdateSignal {
  if (running) return { kind: "none" };
  if (state?.status === "downloading") {
    return { kind: "downloading", percent: state.downloadPercent };
  }
  if (action === "install") return { kind: "ready" };
  if (action === "download" || hasOtherUpdates) return { kind: "available" };
  return { kind: "none" };
}

export type SidebarNotificationsDot = "error" | "warning" | "neutral";

/**
 * The footer button's corner dot takes the most important item's colour, and
 * its label counts what the popover holds. Download progress shows as the
 * button's ring instead of a dot.
 */
export function describeSidebarNotificationsButton({
  severities,
  update,
}: {
  readonly severities: ReadonlyArray<BackgroundNotice["severity"]>;
  readonly update: SidebarUpdateSignal;
}): { readonly dot: SidebarNotificationsDot | null; readonly label: string } {
  const dot: SidebarNotificationsDot | null = severities.includes("error")
    ? "error"
    : severities.includes("warning")
      ? "warning"
      : severities.length > 0 || update.kind === "available" || update.kind === "ready"
        ? "neutral"
        : null;
  const parts = [
    severities.length > 0
      ? `${severities.length} notification${severities.length === 1 ? "" : "s"}`
      : null,
    update.kind === "available"
      ? "update available"
      : update.kind === "ready"
        ? "update ready"
        : update.kind === "downloading"
          ? `downloading update${update.percent === null ? "" : ` ${Math.floor(update.percent)}%`}`
          : null,
  ].filter((part) => part !== null);
  const label = parts.join(", ");
  return {
    dot,
    label: label === "" ? "Notifications" : `${label[0]!.toUpperCase()}${label.slice(1)}`,
  };
}

/** The app's own update state, as the popover's Updates section states it. */
export function describeAppUpdate(
  state: DesktopUpdateState,
  action: DesktopUpdateButtonAction,
): { readonly title: string; readonly detail: string | null } {
  const current = `You have ${state.currentVersion}`;
  const version = getDesktopUpdateDownloadedVersion(state) ?? "update";
  const notApplied =
    state.notAppliedVersion !== undefined && state.notAppliedVersion === version
      ? `Update ${version} did not apply`
      : null;
  const disabledReason = getDesktopUpdateDisabledReason(state);
  if (disabledReason) return { title: "Updates unavailable", detail: disabledReason };
  if (state.status === "downloading") {
    return {
      title: `Downloading ${state.availableVersion ?? "update"}`,
      detail:
        state.downloadPercent === null ? current : `${Math.floor(state.downloadPercent)}% done`,
    };
  }
  if (action === "install") {
    if (state.status === "error" && state.errorContext === "install") {
      return { title: `Could not install ${version}`, detail: state.message };
    }
    return { title: notApplied ?? `${version} is ready to install`, detail: current };
  }
  if (action === "download") {
    if (state.status === "error") {
      return { title: `Could not download ${version}`, detail: state.message };
    }
    return { title: notApplied ?? `${version} is available`, detail: current };
  }
  if (state.status === "checking") return { title: "Checking for updates", detail: current };
  if (state.status === "error") {
    return { title: "Could not check for updates", detail: state.message };
  }
  return { title: "Up to date", detail: current };
}
