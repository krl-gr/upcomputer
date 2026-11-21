// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";

import type { Browser, BrowserContext } from "playwright-core";
import { test } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  buildBrowserLaunchArgs,
  createBrowserAutomationService,
  getInstalledBrowserCandidates,
  minimizeBrowserWindows,
  type BrowserAutomationServiceDependencies,
} from "./BrowserAutomationService.ts";

const STATE_DIR = NodePath.join("/tmp", "browser-automation-service-test");
const DEBUGGING_PORT = 9_333;
const WINDOWLESS_ERROR = new Error(
  "browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.\nCall log:\n  - <ws connected>",
);

const runningBrowserService = (
  dependencies: Pick<BrowserAutomationServiceDependencies, "connectOverCdp" | "openCdpWindow">,
) =>
  createBrowserAutomationService(
    {
      stateDir: STATE_DIR,
      settingsPath: NodePath.join(STATE_DIR, "settings.json"),
    } as ServerConfig["Service"],
    {
      ...dependencies,
      readFile: async () =>
        JSON.stringify({
          version: 1,
          profileId: "default",
          userDataDir: NodePath.join(STATE_DIR, "browser-profiles", "default"),
          browserName: "chrome",
          executablePath: "/test/chrome",
          debuggingPort: DEBUGGING_PORT,
          launchedAt: "2026-10-28T00:00:00.000Z",
        }),
      probeCdpEndpoint: async () => ({ ok: true }),
      makeDirectory: async () => undefined,
      launchCdpBrowser: () => Promise.reject(new Error("The running browser must be reused.")),
    },
  );

test("attaching to a running browser with no windows opens one and retries", async () => {
  const context = {} as BrowserContext;
  const browser = { on: () => browser } as unknown as Browser;
  const openedWindows: number[] = [];
  const service = runningBrowserService({
    connectOverCdp: async () => {
      if (openedWindows.length === 0) throw WINDOWLESS_ERROR;
      return { browser, context };
    },
    openCdpWindow: async (port) => {
      openedWindows.push(port);
    },
  });

  NodeAssert.equal(await service.context(), context);
  NodeAssert.deepEqual(openedWindows, [DEBUGGING_PORT]);
});

test("a running browser that still cannot be attached reports a clear error", async () => {
  const service = runningBrowserService({
    connectOverCdp: () => Promise.reject(WINDOWLESS_ERROR),
    openCdpWindow: async () => undefined,
  });

  await NodeAssert.rejects(service.context(), {
    message: "The browser is not responding. Quit it and open it again.",
  });
});

test("the managed browser keeps background work running, with Windows' occlusion check off", () => {
  const backgroundFlags = [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];
  const args = (platform: NodeJS.Platform) =>
    buildBrowserLaunchArgs({ debuggingPort: 9_222, userDataDir: "/profile", platform });
  for (const platform of ["darwin", "linux", "win32"] as const) {
    NodeAssert.deepEqual(
      backgroundFlags.filter((flag) => args(platform).includes(flag)),
      backgroundFlags,
    );
  }
  NodeAssert.ok(args("win32").includes("--disable-features=CalculateNativeWinOcclusion"));
  NodeAssert.ok(!args("darwin").some((arg) => arg.includes("CalculateNativeWinOcclusion")));
});

test("a fresh managed browser minimizes each of its windows once", async () => {
  const calls: Array<readonly [string, unknown]> = [];
  let detached = false;
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async (method: string, params?: unknown) => {
        calls.push([method, params]);
        if (method === "Target.getTargets") {
          return {
            targetInfos: [
              { targetId: "page-1", type: "page" },
              { targetId: "page-2", type: "page" },
              { targetId: "worker-1", type: "service_worker" },
            ],
          };
        }
        if (method === "Browser.getWindowForTarget") return { windowId: 7 };
        return {};
      },
      detach: async () => {
        detached = true;
      },
    }),
  } as unknown as Pick<Browser, "newBrowserCDPSession">;
  await minimizeBrowserWindows(browser);
  NodeAssert.deepEqual(
    calls.filter(([method]) => method === "Browser.setWindowBounds"),
    [["Browser.setWindowBounds", { windowId: 7, bounds: { windowState: "minimized" } }]],
  );
  NodeAssert.ok(!calls.some(([, params]) => JSON.stringify(params)?.includes("worker-1")));
  NodeAssert.ok(detached);
});

test("Chrome is found in user installs, Chromium packages and on PATH", () => {
  const paths = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) =>
    getInstalledBrowserCandidates({ platform, env }).map((candidate) => candidate.executablePath);
  NodeAssert.ok(
    paths("darwin", { HOME: "/Users/someone" }).includes(
      "/Users/someone/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ),
  );
  const linux = paths("linux", { PATH: "/usr/local/bin:/home/someone/bin" });
  for (const expected of [
    "/opt/google/chrome/chrome",
    "/opt/microsoft/msedge/msedge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/local/bin/google-chrome",
    "/home/someone/bin/chromium",
  ]) {
    NodeAssert.ok(linux.includes(expected), expected);
  }
  // Google Chrome and Edge come before Chromium.
  NodeAssert.ok(linux.indexOf("/usr/bin/google-chrome") < linux.indexOf("/usr/bin/chromium"));
  NodeAssert.equal(new Set(linux).size, linux.length);
});

test("a missing or failing Chrome sends agents to the built-in browser, and is tried again later", async () => {
  let clock = 0;
  let installed = false;
  let launches = 0;
  let launchFails = true;
  const context = {} as BrowserContext;
  const service = createBrowserAutomationService(
    {
      stateDir: STATE_DIR,
      settingsPath: NodePath.join(STATE_DIR, "settings.json"),
    } as ServerConfig["Service"],
    {
      now: () => clock,
      findInstalledBrowser: async () =>
        installed ? { browserName: "chrome", executablePath: "/test/chrome" } : null,
      readFile: async () => "",
      makeDirectory: async () => undefined,
      writeFile: async () => undefined,
      renameFile: async () => undefined,
      launchCdpBrowser: async ({ userDataDir }) => {
        launches += 1;
        if (launchFails) throw new Error("Chrome exited before exposing CDP.");
        return {
          browserProcess: {
            browserName: "chrome",
            executablePath: "/test/chrome",
            debuggingPort: DEBUGGING_PORT,
            userDataDir,
            dispose: async () => undefined,
          },
          browser: { on: () => undefined } as unknown as Browser,
          context,
        };
      },
    },
  );

  NodeAssert.equal(await service.ensureAvailable(), false);
  NodeAssert.equal(launches, 0);
  NodeAssert.equal((await service.snapshot()).installed, false);

  installed = true;
  NodeAssert.equal(await service.ensureAvailable(), false);
  NodeAssert.equal(launches, 1);
  const failed = await service.snapshot();
  NodeAssert.equal(failed.installed, true);
  NodeAssert.equal(failed.launchError, "Chrome exited before exposing CDP.");

  // Agents do not wait for another failing launch right away.
  launchFails = false;
  NodeAssert.equal(await service.ensureAvailable(), false);
  NodeAssert.equal(launches, 1);

  clock += 5 * 60_000;
  NodeAssert.equal(await service.ensureAvailable(), true);
  NodeAssert.equal(launches, 2);
  NodeAssert.equal((await service.snapshot()).launchError, undefined);
});
