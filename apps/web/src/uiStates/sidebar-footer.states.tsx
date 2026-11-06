import "../adaptiveSidebar/adaptiveSidebar.css";

import { type BackgroundNotice, type DesktopUpdateState, EnvironmentId } from "@t3tools/contracts";
import { it, vi } from "vite-plus/test";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarChromeFooter } from "../components/sidebar/SidebarChrome";
import type { UpdateEverythingRun } from "../components/sidebar/updateEverything.logic";
import { setUpdateEverythingRun } from "../components/sidebar/updateEverythingRun";
import { SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The sidebar footer: Settings, Workers, Pull requests, Usage and the
 * notifications button, in the full sidebar and the compact column.
 */

// What the mocked data sources below return; each state's `setup` sets it.
const source = vi.hoisted(() => ({
  update: null as DesktopUpdateState | null,
  notices: [] as ReadonlyArray<BackgroundNotice>,
  pullRequestsSupported: false,
  pathname: "/",
}));

// Data sources, not UI: the desktop update feed, the server configs that carry
// background notices, the Pull requests capability and the page on screen.
vi.mock("../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesktopUpdateState: () => source.update,
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerConfigs: () =>
    new Map([["environment-ui-states", { backgroundNotices: source.notices }]]),
}));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePullRequestsSupported: () => source.pullRequestsSupported,
}));
vi.mock("../hooks/useShownPathname", () => ({
  useShownPathname: () => source.pathname,
}));

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

function Footer(props: { readonly compact: boolean }) {
  return (
    // The app's atom registry, as AppRoot provides it: the Update everything run lives there.
    <AppAtomRegistryProvider>
      {/* The provider's wrapper fills the viewport in the app; a sheet cell fits the footer. */}
      <SidebarProvider className="min-h-0" data-sidebar-compact={props.compact ? "true" : "false"}>
        <div
          data-app-sidebar=""
          className="-mx-(--sidebar-content-inset) -my-1 flex w-64 flex-col bg-sidebar"
          style={props.compact ? { width: SIDEBAR_COMPACT_WIDTH } : undefined}
        >
          <SidebarChromeFooter />
        </div>
      </SidebarProvider>
    </AppAtomRegistryProvider>
  );
}

function footer(
  name: string,
  options: {
    readonly compact?: boolean;
    readonly update?: DesktopUpdateState;
    readonly notices?: ReadonlyArray<BackgroundNotice>;
    readonly pullRequests?: boolean;
    readonly pathname?: string;
    readonly run?: UpdateEverythingRun;
    readonly hover?: string;
    readonly open?: boolean;
  } = {},
): UiState {
  return {
    name,
    render: () => <Footer compact={options.compact ?? false} />,
    setup: () => {
      source.update = options.update ?? IDLE;
      source.notices = options.notices ?? [];
      source.pullRequestsSupported = options.pullRequests ?? false;
      source.pathname = options.pathname ?? "/";
      if (options.run) setUpdateEverythingRun(() => options.run!);
      return () => {
        source.update = null;
        source.notices = [];
        source.pullRequestsSupported = false;
        source.pathname = "/";
        setUpdateEverythingRun(() => null);
      };
    },
    ...(options.hover ? { hover: options.hover } : {}),
    ...(options.open ? { settle: openNotifications } : {}),
  };
}

// Opens the bell's popover: an open trigger gets Base UI focus guards beside it.
async function openNotifications(cell: HTMLElement) {
  cell.querySelector<HTMLElement>('[data-track="sidebar.notifications"]')!.click();
  await vi.waitFor(() => {
    if (!cell.querySelector("[data-base-ui-focus-guard]")) throw new Error("popover not open");
  });
}

const FULL_STATES: ReadonlyArray<UiState> = [
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
  footer("utility page (Pull requests): Back and notifications", {
    pathname: "/pull-requests",
    pullRequests: true,
  }),
  footer("notifications popover open: buttons keep their width", { open: true }),
  footer("hover on Usage", { hover: '[data-track="sidebar.usage"]' }),
  footer("hover on the bell, with an error dot", {
    notices: [ERROR],
    hover: '[data-track="sidebar.notifications"]',
  }),
];

const COMPACT_STATES: ReadonlyArray<UiState> = [
  footer("icon column: default", { compact: true }),
  footer("icon column: Pull requests, error dot", {
    compact: true,
    pullRequests: true,
    notices: [ERROR],
  }),
  footer("icon column: update downloading, 40%", { compact: true, update: DOWNLOADING }),
  footer("icon column: utility page", { compact: true, pathname: "/pull-requests" }),
];

it("sidebar-footer", async () => {
  await captureUiStateSheet("sidebar-footer", [
    { title: "Full sidebar, 256px", states: FULL_STATES },
    { title: "Icon column", states: COMPACT_STATES },
  ]);
});
