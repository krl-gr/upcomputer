import "../adaptiveSidebar/adaptiveSidebar.css";

import {
  type BackgroundNotice,
  type DesktopUpdateState,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { AsyncResult } from "effect/reactivity";
import { vi } from "vite-plus/test";
import { create } from "zustand";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarChromeFooter } from "../components/sidebar/SidebarChrome";
import type { UpdateEverythingRun } from "../components/sidebar/updateEverything.logic";
import { setUpdateEverythingRun } from "../components/sidebar/updateEverythingRun";
import { SidebarProvider } from "../components/ui/sidebar";
import { showThreadUndoNotice, undoLatestThreadAction } from "../hooks/showThreadUndoNotice";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { act } from "../../test/render";
import { footerSource as source } from "./sidebarFooter.source";
import type { UiState } from "./uiStateSheet";

/*
 * The sidebar footer's states, shared by its ui-states sheet and by the browser test that
 * checks the utility row in each of them: Settings, Bots, Usage and the bell, no text.
 * Both mock the same data sources to return `footerSource` (sidebarFooter.source.ts).
 */

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const IDLE: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "0.9.2",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: minutesAgo(5),
  message: null,
  errorContext: null,
  canRetry: false,
};
const AVAILABLE: DesktopUpdateState = { ...IDLE, status: "available", availableVersion: "0.9.3" };
const DOWNLOADING: DesktopUpdateState = {
  ...AVAILABLE,
  status: "downloading",
  downloadPercent: 40,
};
const DOWNLOADED: DesktopUpdateState = {
  ...AVAILABLE,
  status: "downloaded",
  downloadedVersion: "0.9.3",
  downloadPercent: 100,
};
const INTEL_BUILD: DesktopUpdateState = { ...IDLE, appArch: "x64" };
const INTEL_BUILD_UPDATE_AVAILABLE: DesktopUpdateState = { ...AVAILABLE, appArch: "x64" };
const INTEL_BUILD_UPDATE_DOWNLOADED: DesktopUpdateState = { ...DOWNLOADED, appArch: "x64" };

function notice(severity: BackgroundNotice["severity"], title: string, message: string) {
  return {
    id: `notice-${severity}`,
    area: "automations",
    severity,
    title,
    message,
    occurredAt: minutesAgo(3),
  } satisfies BackgroundNotice;
}
const INFO = notice("info", "Remote access is on", "This computer accepts paired devices.");
const WARNING = notice("warning", "Reminder skipped", "The computer was asleep at 9:00.");
const ERROR = notice("error", "Automation failed", "Nightly triage could not start its agent.");

const UPDATING_CLAUDE: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "2.0.9",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: minutesAgo(5),
  models: [],
  slashCommands: [],
  skills: [],
  updateState: {
    status: "running",
    startedAt: minutesAgo(1),
    finishedAt: null,
    message: null,
    output: null,
  },
};

const RUN: UpdateEverythingRun = {
  localVersion: null,
  phase: "providers",
  restartAt: null,
  machines: [
    {
      environmentId: ENVIRONMENT_ID,
      label: "This Mac",
      updatesProviders: true,
      server: null,
      handedOffVersion: null,
      startedAt: NOW,
      result: null,
      failure: null,
      providerFailure: null,
    },
  ],
};

// A state can switch the sidebar between full and compact while it settles.
const useFooterMode = create(() => ({ compact: false }));

function Footer() {
  const compact = useFooterMode((mode) => mode.compact);
  return (
    // The app's atom registry, as AppRoot provides it: the Update everything run lives there.
    <AppAtomRegistryProvider>
      {/* The provider's wrapper fills the viewport in the app; a sheet cell fits the footer. */}
      <SidebarProvider className="min-h-0" data-sidebar-compact={compact ? "true" : "false"}>
        <div
          data-app-sidebar=""
          className="-mx-(--sidebar-content-inset) -my-1 flex w-64 flex-col bg-sidebar"
          style={compact ? { width: SIDEBAR_COMPACT_WIDTH } : undefined}
        >
          <SidebarChromeFooter />
        </div>
      </SidebarProvider>
    </AppAtomRegistryProvider>
  );
}

let archivedThreads = 0;

/** Archives a thread through the app's real undo notice. */
function archiveThread() {
  archivedThreads += 1;
  showThreadUndoNotice({
    action: "Archived",
    failureTitle: "Could not restore the thread",
    undo: () => Promise.resolve(AsyncResult.success(undefined)),
    claim: ThreadUndo.begin("archive", `environment-ui-states/thread-${archivedThreads}`),
  });
}

function shownNotice(cell: HTMLElement) {
  return [...cell.querySelectorAll("span")].find((span) =>
    /^Archived( \d+)?,?$/.test(span.textContent ?? ""),
  );
}

/** Waits until the notice is on screen and its fade-in has finished. */
async function waitForShownNotice(cell: HTMLElement) {
  await vi.waitFor(() => {
    const text = shownNotice(cell);
    if (!text) throw new Error("undo notice not shown yet");
    let element: Element | null = text;
    while (element && element !== cell) {
      if (getComputedStyle(element).opacity !== "1") throw new Error("undo notice still fading in");
      element = element.parentElement;
    }
  });
}

/** Waits a moment for the ended notice to leave; a sheet then shows whatever stayed. */
async function waitForNoticeToLeave(cell: HTMLElement) {
  await vi
    .waitFor(
      () => {
        if (cell.querySelector("[aria-hidden='true'][inert]")) throw new Error("notice stayed");
      },
      { timeout: 1_000 },
    )
    .catch(() => undefined);
}

type NoticeStep = "showing" | "showing-two" | "fading" | "ended" | "ended-unseen" | "ended-compact";

/*
 * The undo notice through its real lifecycle: archiving shows it, mod+z ends it.
 * `ended-unseen` ends it before its fade-in starts, so no transition runs at all;
 * `ended-compact` ends it while the compact column hides it, then expands the sidebar.
 */
async function playUndoNotice(cell: HTMLElement, step: NoticeStep) {
  if (step === "ended-unseen") {
    await act(archiveThread);
    await act(undoLatestThreadAction);
    await waitForNoticeToLeave(cell);
    return;
  }
  if (step === "ended-compact") {
    await act(() => useFooterMode.setState({ compact: true }));
    await act(archiveThread);
    await act(undoLatestThreadAction);
    await act(() => useFooterMode.setState({ compact: false }));
    await waitForNoticeToLeave(cell);
    return;
  }
  await act(archiveThread);
  if (step === "showing-two") await act(archiveThread);
  await waitForShownNotice(cell);
  if (step === "showing" || step === "showing-two") return;
  await act(undoLatestThreadAction);
  if (step === "ended") await waitForNoticeToLeave(cell);
}

// Opens the bell's popover: an open trigger gets Base UI focus guards beside it.
async function openNotifications(cell: HTMLElement) {
  cell.querySelector<HTMLElement>('[data-track="sidebar.notifications"]')!.click();
  await vi.waitFor(() => {
    if (!cell.querySelector("[data-base-ui-focus-guard]")) throw new Error("popover not open");
  });
}

export interface FooterOptions {
  readonly compact?: boolean;
  readonly update?: DesktopUpdateState;
  readonly notices?: ReadonlyArray<BackgroundNotice>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly pullRequests?: boolean;
  readonly pathname?: string;
  readonly run?: UpdateEverythingRun;
  readonly hover?: string;
  readonly open?: boolean;
  readonly undo?: NoticeStep;
}

export interface FooterState extends UiState {
  readonly options: FooterOptions;
}

function footer(name: string, options: FooterOptions = {}): FooterState {
  const { open, undo } = options;
  return {
    name,
    options,
    render: () => <Footer />,
    setup: () => {
      useFooterMode.setState({ compact: options.compact ?? false });
      source.update = options.update ?? IDLE;
      source.notices = options.notices ?? [];
      source.providers = options.providers ?? [];
      source.pullRequestsSupported = options.pullRequests ?? false;
      source.pathname = options.pathname ?? "/";
      if (options.run) setUpdateEverythingRun(() => options.run!);
      return () => {
        undoLatestThreadAction();
        useFooterMode.setState({ compact: false });
        source.update = null;
        source.notices = [];
        source.providers = [];
        source.pullRequestsSupported = false;
        source.pathname = "/";
        setUpdateEverythingRun(() => null);
      };
    },
    ...(options.hover ? { hover: options.hover } : {}),
    ...(open || undo
      ? {
          settle: async (cell: HTMLElement) => {
            if (undo) await playUndoNotice(cell, undo);
            if (open) await openNotifications(cell);
          },
        }
      : {}),
  };
}

export const FULL_FOOTER_STATES: ReadonlyArray<FooterState> = [
  footer("default: no notifications, no update, no Pull requests"),
  footer("with Pull requests: five buttons", { pullRequests: true }),
  footer("1 info notice: neutral dot", { notices: [INFO] }),
  footer("warning notice: warning dot", { notices: [WARNING, INFO] }),
  footer("error notice: error dot", { notices: [ERROR, WARNING] }),
  footer("update available: neutral dot", { update: AVAILABLE }),
  footer("update downloading, 40%: progress ring", { update: DOWNLOADING }),
  footer("update ready to install: neutral dot", { update: DOWNLOADED }),
  footer("Update everything running: ring on the bell, progress in its popover", { run: RUN }),
  footer("error notice and update ready together", { notices: [ERROR], update: DOWNLOADED }),
  footer("provider updating: its pill above the row", { providers: [UPDATING_CLAUDE] }),
  footer("Intel build on Apple Silicon: the warning above the row", {
    update: INTEL_BUILD,
  }),
  footer("Intel build, update available: Download on the warning", {
    update: INTEL_BUILD_UPDATE_AVAILABLE,
  }),
  footer("Intel build, update downloaded: Restart on the warning", {
    update: INTEL_BUILD_UPDATE_DOWNLOADED,
  }),
  footer("utility page (Pull requests): Back and notifications", {
    pathname: "/pull-requests",
    pullRequests: true,
  }),
  footer("notifications popover open: buttons keep their width", { open: true }),
  footer("thread archived: the undo notice shows", { undo: "showing" }),
  footer("two threads archived", { undo: "showing-two" }),
  footer("undo notice fading out after mod+z", { undo: "fading" }),
  footer("undo notice gone after mod+z", { undo: "ended" }),
  footer("undo notice gone, ended before its fade-in ran", { undo: "ended-unseen" }),
  footer("undo notice gone, ended in the icon column, sidebar expanded", {
    undo: "ended-compact",
  }),
  footer("all notices at once: provider pill, warning, undo notice", {
    providers: [UPDATING_CLAUDE],
    update: INTEL_BUILD,
    notices: [INFO],
    undo: "showing",
  }),
  footer("utility page with the undo notice", { pathname: "/pull-requests", undo: "showing" }),
  footer("hover on Usage", { hover: '[data-track="sidebar.usage"]' }),
  footer("hover on the bell, with an error dot", {
    notices: [ERROR],
    hover: '[data-track="sidebar.notifications"]',
  }),
];

export const COMPACT_FOOTER_STATES: ReadonlyArray<FooterState> = [
  footer("icon column: default", { compact: true }),
  footer("icon column: Pull requests, error dot", {
    compact: true,
    pullRequests: true,
    notices: [ERROR],
  }),
  footer("icon column: update downloading, 40%", { compact: true, update: DOWNLOADING }),
  footer("icon column: utility page", { compact: true, pathname: "/pull-requests" }),
];
