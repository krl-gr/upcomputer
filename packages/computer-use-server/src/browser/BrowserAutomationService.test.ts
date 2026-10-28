// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";

import type { Browser, BrowserContext } from "playwright-core";
import { test } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  createBrowserAutomationService,
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
