import {
  type BackgroundNotice,
  type DesktopUpdateState,
  EnvironmentId,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdateState,
} from "@t3tools/contracts";
import { it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type {
  UpdateEverythingPlan,
  UpdateEverythingRun,
} from "../components/sidebar/updateEverything.logic";
import { setUpdateEverythingRun } from "../components/sidebar/updateEverythingRun";
import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The sidebar's notifications button with its popover open. Each state clicks
 * the button, then copies the open popup into its cell above the button, where
 * the app draws it: the popup itself portals to the body and the state is
 * frozen to static markup once it settles.
 */

// What the mocked data sources below return; each state's `setup` sets it.
const source = vi.hoisted(() => ({
  update: null as DesktopUpdateState | null,
  notices: [] as ReadonlyArray<BackgroundNotice>,
  providers: [] as ReadonlyArray<ServerProvider>,
  servers: [] as UpdateEverythingPlan["servers"],
}));

// Data sources, not UI: the update feed, server configs (notices, versions), the
// provider CLIs, and Update everything's plan, which reads stores a sheet cannot
// load, so it goes through the app's own `describeUpdateEverything`.
vi.mock("../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesktopUpdateState: () => source.update,
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerConfigs: () =>
    new Map([
      ["environment-ui-states", { backgroundNotices: source.notices }],
      ["environment-studio", { environment: { serverVersion: "0.9.1" } }],
    ]),
}));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "environment-ui-states",
        label: "This Mac",
        connection: { phase: "connected" },
      },
    ],
  }),
  useEnvironmentProviders: () => new Map([["environment-ui-states", source.providers]]),
}));
vi.mock("../components/sidebar/useUpdateEverything", async (importOriginal) => {
  const { describeUpdateEverything } = await import("../components/sidebar/updateEverything.logic");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useUpdateEverything: (localUpdateVersion: string | null) => ({
      hasUpdates: source.servers.length > 0 || source.providers.length > 0,
      ...describeUpdateEverything({
        localVersion: localUpdateVersion,
        localMachines: [],
        servers: source.servers,
        providerMachines:
          source.providers.length === 0
            ? []
            : [
                {
                  environmentId: "environment-ui-states" as EnvironmentId,
                  label: "This Mac",
                  providers: source.providers.map(
                    (provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
                  ),
                },
              ],
        skipped: [],
      }),
      restarts: [],
      run: async () => undefined,
    }),
  };
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const STUDIO_ID = EnvironmentId.make("environment-studio");
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
const NIGHTLY: DesktopUpdateState = {
  ...IDLE,
  channel: "nightly",
  currentVersion: "0.9.3-nightly.20261101",
  status: "available",
  availableVersion: "0.9.3-nightly.20261105",
  releaseNotes: [
    {
      version: "0.9.3-nightly.20261105",
      items: [
        "The sidebar footer's buttons share its width",
        "Update everything shows its progress in the notifications popover",
        "Fix a stale label after renaming a thread",
      ],
      totalItems: 5,
    },
    {
      version: "0.9.3-nightly.20261103",
      items: ["Faster cold start on large projects"],
      totalItems: 1,
    },
  ],
  omittedReleaseCount: 2,
};

function provider(
  driver: string,
  current: string,
  latest: string,
  updateState?: Pick<ServerProviderUpdateState, "status" | "message" | "output">,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: current,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: minutesAgo(5),
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: current,
      latestVersion: latest,
      updateCommand: `npm install -g ${driver}@latest`,
      canUpdate: true,
      checkedAt: minutesAgo(5),
      message: null,
    },
    ...(updateState
      ? { updateState: { startedAt: minutesAgo(1), finishedAt: null, ...updateState } }
      : {}),
  };
}
const CLAUDE = provider("claudeAgent", "2.0.9", "2.1.4");
const CODEX = provider("codex", "0.45.0", "0.48.0");
const PROVIDERS = [CLAUDE, CODEX];
const SERVERS: UpdateEverythingPlan["servers"] = [
  {
    environmentId: STUDIO_ID,
    serverLabel: "Studio Mac",
    selfUpdate: "desktop-managed",
    targetVersion: "0.9.3",
  },
];

/** Built when its state mounts, so a countdown reads its full length. */
function runOn(
  phase: UpdateEverythingRun["phase"],
  {
    restartInMs = null,
    failure = null,
  }: { readonly restartInMs?: number | null; readonly failure?: string | null } = {},
): () => UpdateEverythingRun {
  return () => ({
    localVersion: null,
    phase,
    restartAt: restartInMs === null ? null : Date.now() + restartInMs,
    machines: [
      {
        environmentId: ENVIRONMENT_ID,
        label: "This Mac",
        updatesProviders: true,
        server: null,
        handedOffVersion: null,
        startedAt: NOW,
        result: failure === null ? null : "failed",
        failure,
        providerFailure: failure,
      },
    ],
  });
}

const INFO: BackgroundNotice = {
  id: "remote-access",
  area: "remote-access",
  severity: "info",
  title: "Remote access is on",
  message: "This computer accepts paired devices.",
  occurredAt: minutesAgo(40),
};
const WARNING: BackgroundNotice = {
  id: "reminder-skipped",
  area: "reminders",
  severity: "warning",
  title: "Reminder skipped",
  message: "The computer was asleep at 9:00, so Standup notes did not run.",
  link: { label: "Open reminders", path: "/reminders" },
  occurredAt: minutesAgo(20),
};
const ERROR: BackgroundNotice = {
  id: "automation-failed",
  area: "automations",
  severity: "error",
  title: "Automation failed",
  message: "Nightly triage could not start its agent.",
  detail:
    "ProviderStartError: codex exited with code 1\n    at startSession (provider/codex.ts:212)\n    at runAutomation (automations/run.ts:88)",
  link: { label: "Open automation", path: "/automations/nightly-triage" },
  occurredAt: minutesAgo(3),
};

function Bell() {
  return (
    <AppAtomRegistryProvider>
      <SidebarProvider className="min-h-0" data-sidebar-compact="false">
        <div data-app-sidebar="" className="flex flex-col py-2">
          <div data-popover-copy="" className="mb-1 empty:hidden" />
          <SidebarMenu className="flex-row items-center">
            <SidebarNotifications />
          </SidebarMenu>
        </div>
      </SidebarProvider>
    </AppAtomRegistryProvider>
  );
}

function openPopup(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute("aria-controls");
  const popup = id ? document.getElementById(id) : null;
  if (!popup?.hasAttribute("data-open")) throw new Error("The notifications popover is not open");
  return popup;
}

/** Opens the popover for real, then copies it into the cell above the button. */
function openPopover(inside?: (popup: HTMLElement) => Promise<void>) {
  return async (cell: HTMLElement) => {
    const trigger = cell.querySelector<HTMLElement>('[data-track="sidebar.notifications"]')!;
    await userEvent.click(trigger);
    const popup = await vi.waitFor(() => openPopup(trigger));
    await inside?.(popup);
    // The opening transition; a spinner's endless animation never finishes.
    await Promise.all(
      popup
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    );
    const copy = popup.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-starting-style");
    copy.removeAttribute("id");
    // Placement for a size transition, against the positioner the copy leaves behind.
    for (const property of ["position", "top", "bottom", "left", "right"]) {
      copy.style.removeProperty(property);
    }
    cell.querySelector("[data-popover-copy]")!.append(copy);
    // Leaves the pointer off the button, so its tooltip does not stay open.
    await userEvent.unhover(trigger);
  };
}

async function expandErrorDetails(popup: HTMLElement) {
  const details = [...popup.querySelectorAll("button")].find(
    (button) => button.textContent === "Details",
  )!;
  await userEvent.click(details);
  await vi.waitFor(() => {
    if (!popup.querySelector("pre")) throw new Error("Details did not expand");
  });
}

function bell(
  name: string,
  options: {
    readonly update?: DesktopUpdateState | null;
    readonly notices?: ReadonlyArray<BackgroundNotice>;
    readonly providers?: ReadonlyArray<ServerProvider>;
    readonly servers?: UpdateEverythingPlan["servers"];
    readonly run?: () => UpdateEverythingRun;
    readonly inside?: (popup: HTMLElement) => Promise<void>;
  } = {},
): UiState {
  return {
    name,
    render: () => <Bell />,
    setup: () => {
      source.update = options.update === undefined ? IDLE : options.update;
      source.notices = options.notices ?? [];
      source.providers = options.providers ?? [];
      source.servers = options.servers ?? [];
      if (options.run) setUpdateEverythingRun(options.run);
      return () => {
        source.update = null;
        source.notices = [];
        source.providers = [];
        source.servers = [];
        setUpdateEverythingRun(() => null);
      };
    },
    settle: openPopover(options.inside),
  };
}

const APP_UPDATE_STATES: ReadonlyArray<UiState> = [
  bell("nothing new: You're all caught up", {}),
  bell("web, no desktop update feed: never says up to date", { update: null }),
  bell("checking for updates, nothing else: caught up", {
    update: { ...IDLE, status: "checking" },
  }),
  bell("updates unavailable in this build: caught up", {
    update: {
      ...IDLE,
      enabled: false,
      status: "disabled",
      message: "Automatic updates are not available in development builds.",
    },
  }),
  bell("check failed: red tile, Retry", {
    update: {
      ...IDLE,
      status: "error",
      errorContext: "check",
      message: "Could not reach the update server.",
      canRetry: true,
    },
  }),
  bell("update available: Download", { update: AVAILABLE }),
  bell("downloading, 40%: progress bar and ring", { update: DOWNLOADING }),
  bell("downloading, percent unknown", { update: { ...DOWNLOADING, downloadPercent: null } }),
];

const APP_UPDATE_STATES_2: ReadonlyArray<UiState> = [
  bell("download failed: Retry", {
    update: {
      ...AVAILABLE,
      status: "error",
      errorContext: "download",
      message: "The download was interrupted.",
      canRetry: true,
    },
  }),
  bell("ready to install: Restart", { update: DOWNLOADED }),
  bell("install failed: Retry", {
    update: {
      ...DOWNLOADED,
      status: "error",
      errorContext: "install",
      message: "The app could not replace itself. Quit and try again.",
      canRetry: true,
    },
  }),
  bell("previous install did not apply", {
    update: { ...DOWNLOADED, notAppliedVersion: "0.9.3" },
  }),
  bell("nightly: Release notes opens the notes", { update: NIGHTLY }),
  bell("nightly ready to install", {
    update: { ...NIGHTLY, status: "downloaded", downloadedVersion: NIGHTLY.availableVersion },
  }),
];

const EVERYTHING_STATES: ReadonlyArray<UiState> = [
  bell("one provider behind: Update, no Update all", { providers: [CLAUDE] }),
  bell("a server behind: Update opens Update everything", { servers: SERVERS }),
  bell("a server behind while the app downloads: no Update", {
    update: DOWNLOADING,
    servers: SERVERS,
  }),
  bell("several updates: Update all", {
    update: DOWNLOADED,
    providers: PROVIDERS,
    servers: SERVERS,
  }),
  bell("providers updating on their own: waiting, updating, updated", {
    providers: [
      provider("claudeAgent", "2.0.9", "2.1.4", { status: "running", message: null, output: null }),
      provider("codex", "0.45.0", "0.48.0", { status: "queued", message: null, output: null }),
      provider("cursor", "1.4.0", "1.5.2", { status: "succeeded", message: null, output: null }),
    ],
  }),
  bell("provider update failed: Retry and Details", {
    providers: [
      provider("codex", "0.45.0", "0.48.0", {
        status: "failed",
        message: "npm exited with code 1.",
        output: "npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules/@openai/codex",
      }),
      CLAUDE,
    ],
  }),
];

const RUN_STATES: ReadonlyArray<UiState> = [
  bell("Update all running: one card with upstream's capsule", {
    providers: PROVIDERS,
    run: runOn("providers"),
  }),
  bell("Update all waiting to restart: Later", {
    update: DOWNLOADED,
    run: runOn("countdown", { restartInMs: 30_000 }),
  }),
  bell("Update all with a failure: Dismiss", {
    run: runOn("servers", { failure: "Claude: npm exited with code 1." }),
  }),
  bell("Update all running beside an alert", {
    providers: PROVIDERS,
    notices: [WARNING],
    run: runOn("providers"),
  }),
];

const NOTICE_STATES: ReadonlyArray<UiState> = [
  bell("info notice: neutral tile", { notices: [INFO] }),
  bell("warning notice: amber tile, link button", { notices: [WARNING] }),
  bell("error notice: red tile, link button and Details", { notices: [ERROR] }),
  bell("error notice, Details expanded full width", {
    notices: [ERROR],
    inside: expandErrorDetails,
  }),
  bell("three notices: Clear all, error, warning, info", { notices: [INFO, WARNING, ERROR] }),
];

const MIXED_STATES: ReadonlyArray<UiState> = [
  bell("download in progress with alerts: errors, warnings, update, info", {
    update: DOWNLOADING,
    notices: [INFO, WARNING, ERROR],
  }),
  bell("alerts and several updates: Clear all and Update all", {
    update: DOWNLOADED,
    providers: PROVIDERS,
    notices: [WARNING, ERROR],
  }),
  bell("failed provider update and an error, Details open", {
    update: DOWNLOADED,
    providers: [
      provider("codex", "0.45.0", "0.48.0", {
        status: "failed",
        message: "npm exited with code 1.",
        output: null,
      }),
    ],
    notices: [ERROR],
    inside: expandErrorDetails,
  }),
  bell("web, no desktop update feed: alerts and provider updates", {
    update: null,
    providers: PROVIDERS,
    notices: [WARNING],
  }),
];

it("sidebar-notifications", async () => {
  // Several sheets: a taller capture comes out blank past about 4000px.
  const options = { cellWidth: 360 };
  await captureUiStateSheet(
    "sidebar-notifications-app-update",
    [{ title: "This app's update", states: APP_UPDATE_STATES }],
    options,
  );
  await captureUiStateSheet(
    "sidebar-notifications-app-update-2",
    [{ title: "This app's update, continued", states: APP_UPDATE_STATES_2 }],
    options,
  );
  await captureUiStateSheet(
    "sidebar-notifications-everything",
    [{ title: "Servers and providers", states: EVERYTHING_STATES }],
    options,
  );
  await captureUiStateSheet(
    "sidebar-notifications-run",
    [{ title: "Update all running", states: RUN_STATES }],
    options,
  );
  await captureUiStateSheet(
    "sidebar-notifications-notices",
    [{ title: "Alerts", states: NOTICE_STATES }],
    options,
  );
  await captureUiStateSheet(
    "sidebar-notifications-mixed",
    [{ title: "Alerts and updates together", states: MIXED_STATES }],
    options,
  );
});
