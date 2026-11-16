import type { BackgroundNotice, DesktopUpdateState, EnvironmentId } from "@t3tools/contracts";
import type { useGT } from "gt-react";

import { APP_BASE_NAME } from "../branding";
import type { UpdateEverythingRun } from "../components/sidebar/updateEverything.logic";
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
export function describeSidebarNotificationsButton(
  {
    severities,
    update,
    updateFailed = false,
  }: {
    readonly severities: ReadonlyArray<BackgroundNotice["severity"]>;
    readonly update: SidebarUpdateSignal;
    /** An update card shows a failure: see `hasFailedUpdate`. */
    readonly updateFailed?: boolean;
  },
  gt: ReturnType<typeof useGT>,
): { readonly dot: SidebarNotificationsDot | null; readonly label: string } {
  const dot: SidebarNotificationsDot | null =
    severities.includes("error") || updateFailed
      ? "error"
      : severities.includes("warning")
        ? "warning"
        : severities.length > 0 || update.kind === "available" || update.kind === "ready"
          ? "neutral"
          : null;
  // Lowercase phrases in a list; the first letter of the list is capitalized.
  const parts = [
    severities.length > 0
      ? gt("{count, plural, one {# notification} other {# notifications}}", {
          count: severities.length,
        })
      : null,
    updateFailed ? gt("update failed") : null,
    update.kind === "available"
      ? gt("update available")
      : update.kind === "ready"
        ? gt("update ready")
        : update.kind === "downloading"
          ? update.percent === null
            ? gt("downloading update")
            : gt("downloading update {percent}%", { percent: Math.floor(update.percent) })
          : null,
  ].filter((part) => part !== null);
  const label = parts.join(", ");
  return {
    dot,
    label: label === "" ? gt("Notifications") : `${label[0]!.toUpperCase()}${label.slice(1)}`,
  };
}

/** The app's own update as a popover card, or null when it has nothing to say. */
export interface AppUpdateCard {
  readonly kind: "available" | "downloading" | "ready" | "failed";
  readonly title: string;
  readonly detail: string;
  readonly action: "download" | "install" | "check" | null;
}

export function describeAppUpdateCard(
  state: DesktopUpdateState,
  action: DesktopUpdateButtonAction,
  gt: ReturnType<typeof useGT>,
): AppUpdateCard | null {
  if (getDesktopUpdateDisabledReason(state)) return null;
  const downloadedVersion = getDesktopUpdateDownloadedVersion(state);
  const version =
    downloadedVersion ?? gt("update", { $context: "stands in for an unknown version number" });
  const failed = (title: string, cardAction: AppUpdateCard["action"]): AppUpdateCard => ({
    kind: "failed",
    title,
    detail: state.message ?? gt("Try again in a moment."),
    action: cardAction,
  });
  if (state.status === "downloading") {
    return {
      kind: "downloading",
      title: gt("Downloading {appName} {version}", { appName: APP_BASE_NAME, version }),
      detail:
        state.downloadPercent === null
          ? gt("Starting the download")
          : gt("{percent}% downloaded", { percent: Math.floor(state.downloadPercent) }),
      action: null,
    };
  }
  if (action === "install") {
    if (state.status === "error" && state.errorContext === "install") {
      return failed(gt("Could not install {version}", { version }), "install");
    }
    if (state.notAppliedVersion !== undefined && state.notAppliedVersion === downloadedVersion) {
      return {
        kind: "failed",
        title: gt("Update {version} did not apply", { version }),
        detail: gt("You still have {currentVersion}. Restart to try again.", {
          currentVersion: state.currentVersion,
        }),
        action: "install",
      };
    }
    return {
      kind: "ready",
      title: gt("{appName} {version} is ready", { appName: APP_BASE_NAME, version }),
      detail: gt("Restart to finish updating."),
      action: "install",
    };
  }
  if (action === "download") {
    if (state.status === "error") {
      return failed(gt("Could not download {version}", { version }), "download");
    }
    return {
      kind: "available",
      title: `${APP_BASE_NAME} ${version}`,
      detail: gt("You have {currentVersion}", { currentVersion: state.currentVersion }),
      action: "download",
    };
  }
  if (state.status === "error") return failed(gt("Could not check for updates"), "check");
  return null;
}

export type NotificationRank = "error" | "warning" | "update" | "info";
const RANK_ORDER: Record<NotificationRank, number> = { error: 0, warning: 1, update: 2, info: 3 };

/** Errors, warnings, updates, then info; newest first in each, untimed cards last in their order. */
export function orderNotificationCards<
  Card extends { readonly rank: NotificationRank; readonly occurredAt: string | null },
>(cards: ReadonlyArray<Card>): Card[] {
  return cards.toSorted(
    (left, right) =>
      RANK_ORDER[left.rank] - RANK_ORDER[right.rank] ||
      (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""),
  );
}

/** Whether a card would show a failed update: the app's own, a provider's, or Update everything. */
export function hasFailedUpdate({
  app,
  providerStatuses,
  run,
}: {
  readonly app: AppUpdateCard | null;
  readonly providerStatuses: ReadonlyArray<string | undefined>;
  readonly run: UpdateEverythingRun | null;
}): boolean {
  // A run's card stands in for the app and provider cards.
  if (run !== null) return updateRunFailed(run);
  return app?.kind === "failed" || providerStatuses.includes("failed");
}

/** Update everything has stopped with a failure; until then it is running. */
export function updateRunFailed(run: UpdateEverythingRun): boolean {
  return (
    run.phase !== "countdown" &&
    run.phase !== "installing" &&
    run.machines.every((machine) => machine.result !== null) &&
    run.machines.some((machine) => machine.result === "failed")
  );
}

/** The Update everything card's words; upstream's capsule below them carries the count. */
export function describeUpdateRun(
  run: UpdateEverythingRun,
  gt: ReturnType<typeof useGT>,
): {
  readonly title: string;
  readonly detail: string;
} {
  const running = (detail: string) => ({ title: gt("Updating everything"), detail });
  if (run.phase === "countdown") {
    return running(gt("{appName} restarts to finish updating.", { appName: APP_BASE_NAME }));
  }
  if (run.phase === "installing") {
    return running(gt("Restarting {appName}.", { appName: APP_BASE_NAME }));
  }
  if (updateRunFailed(run)) {
    return { title: gt("Update everything failed"), detail: gt("Some updates did not finish.") };
  }
  if (run.machines.some((machine) => machine.result === null)) {
    return running(
      run.phase === "providers" ? gt("Updating provider CLIs first.") : gt("Updating servers."),
    );
  }
  return running(
    run.localVersion === null ? gt("Finishing up.") : gt("Downloading the app update."),
  );
}
