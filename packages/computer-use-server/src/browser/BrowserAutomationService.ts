// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalFetch:off
// @effect-diagnostics globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { PRODUCT_BASE_NAME } from "../Branding.ts";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import { normalizePreviewUrl } from "@upcomputer/shared/preview";
import { resolveBrowserProfilePaths } from "./BrowserProfiles.ts";

export type BrowserName = "chrome" | "msedge";

interface BrowserProcessExitState {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly killed: boolean;
}

export interface BrowserProcessHandle {
  readonly browserName: BrowserName;
  readonly executablePath: string;
  readonly debuggingPort: number;
  readonly userDataDir: string;
  readonly pid?: number;
  readonly getExitState?: () => BrowserProcessExitState;
  readonly dispose: () => Promise<void>;
}

export interface BrowserExecutableCandidate {
  readonly browserName: BrowserName;
  readonly executablePath: string;
}

export interface LaunchedCdpBrowser {
  readonly browserProcess: BrowserProcessHandle;
  readonly browser: Browser;
  readonly context: BrowserContext;
}

interface BrowserRuntimeMetadata {
  readonly version: 1;
  readonly profileId: "default";
  readonly userDataDir: string;
  readonly browserName: BrowserName;
  readonly executablePath: string;
  readonly debuggingPort: number;
  readonly pid?: number;
  readonly launchedAt: string;
}

interface CdpEndpointProbeResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface BrowserAutomationServiceDependencies {
  readonly launchCdpBrowser?: (input: {
    readonly userDataDir: string;
    readonly initialUrl?: string;
  }) => Promise<LaunchedCdpBrowser>;
  readonly connectOverCdp?: (port: number) => Promise<{
    readonly browser: Browser;
    readonly context: BrowserContext;
  }>;
  readonly probeCdpEndpoint?: (port: number) => Promise<CdpEndpointProbeResult>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  readonly renameFile?: (fromPath: string, toPath: string) => Promise<void>;
  readonly removeFile?: (path: string) => Promise<void>;
  readonly makeDirectory?: (path: string) => Promise<void>;
  readonly removeDirectory?: (path: string) => Promise<void>;
}

export interface BrowserProfileSnapshot {
  readonly profileId: "default";
  readonly profilePath: string;
  readonly status: "closed" | "open";
  readonly launchMode?: "cdp-attached";
  readonly browserName?: BrowserName;
  readonly debuggingPort?: number;
  readonly currentUrl?: string;
  readonly currentTitle?: string;
}

export interface BrowserAutomationServiceShape {
  /** Opens or reconnects the managed browser and returns its persistent profile context. */
  readonly context: () => Promise<BrowserContext>;
  readonly snapshot: () => Promise<BrowserProfileSnapshot>;
  readonly openLoginWindow: (input?: { readonly url?: string }) => Promise<BrowserProfileSnapshot>;
  readonly closeBrowser: () => Promise<BrowserProfileSnapshot>;
  readonly clearProfileData: () => Promise<BrowserProfileSnapshot>;
}

function trimText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeFilesystemPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function titleOf(page: Page): Promise<string | undefined> {
  return page
    .title()
    .then(trimText)
    .catch(() => undefined);
}

function candidatePath(
  join: (...paths: string[]) => string,
  ...parts: Array<string | undefined>
): string | null {
  if (parts.some((part) => !part)) {
    return null;
  }
  return join(...(parts as string[]));
}

function getInstalledBrowserCandidates(input?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}): ReadonlyArray<BrowserExecutableCandidate> {
  const env = input?.env ?? process.env;
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Plain helper; callers and tests pass `platform`.
  const platform = input?.platform ?? process.platform;
  if (platform === "win32") {
    const join = NodePath.win32.join;
    const chromeCandidates: BrowserExecutableCandidate[] = [
      candidatePath(join, env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
      candidatePath(
        join,
        env["ProgramFiles(x86)"],
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      candidatePath(join, env.LocalAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ]
      .filter((executablePath): executablePath is string => executablePath !== null)
      .map((executablePath) => ({ browserName: "chrome" as const, executablePath }));
    const edgeCandidates: BrowserExecutableCandidate[] = [
      candidatePath(
        join,
        env["ProgramFiles(x86)"],
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
      candidatePath(join, env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
      .filter((executablePath): executablePath is string => executablePath !== null)
      .map((executablePath) => ({ browserName: "msedge" as const, executablePath }));
    return [...chromeCandidates, ...edgeCandidates];
  }

  if (platform === "darwin") {
    return [
      {
        browserName: "chrome",
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        browserName: "msedge",
        executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      },
    ];
  }

  return [
    { browserName: "chrome", executablePath: "/usr/bin/google-chrome" },
    { browserName: "chrome", executablePath: "/usr/bin/google-chrome-stable" },
    { browserName: "msedge", executablePath: "/usr/bin/microsoft-edge" },
    { browserName: "msedge", executablePath: "/usr/bin/microsoft-edge-stable" },
  ];
}

function buildBrowserLaunchArgs(input: {
  readonly debuggingPort: number;
  readonly userDataDir: string;
  readonly initialUrl?: string;
}): string[] {
  return [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${input.debuggingPort}`,
    `--user-data-dir=${input.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(trimText(input.initialUrl) ? [normalizePreviewUrl(input.initialUrl!)] : []),
  ];
}

async function findAvailableLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (typeof address === "object" && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to allocate a local browser debugging port."));
      });
    });
  });
}

async function resolveInstalledBrowserExecutable(): Promise<BrowserExecutableCandidate> {
  const candidates = getInstalledBrowserCandidates();
  for (const candidate of candidates) {
    if (
      await NodeFSP.access(candidate.executablePath).then(
        () => true,
        () => false,
      )
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to find Chrome or Edge for ${PRODUCT_BASE_NAME} browser automation. Checked: ${candidates
      .map((candidate) => candidate.executablePath)
      .join(", ")}`,
  );
}

function waitForProcessExit(processHandle: NodeChildProcess.ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (processHandle.exitCode !== null || processHandle.killed) {
      resolve();
      return;
    }
    processHandle.once("exit", () => resolve());
  });
}

function cdpVersionEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/json/version`;
}

function isValidLocalPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;
}

async function probeCdpEndpoint(port: number): Promise<CdpEndpointProbeResult> {
  const endpoint = cdpVersionEndpoint(port);
  try {
    const response = await fetch(endpoint);
    return response.ok
      ? { ok: true }
      : { ok: false, error: `CDP endpoint returned HTTP ${response.status}.` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function processExitedBeforeCdpError(port: number, state: BrowserProcessExitState): Error {
  return new Error(
    `${PRODUCT_BASE_NAME} browser process exited before exposing CDP on ${cdpVersionEndpoint(port)} ` +
      `(exitCode=${state.exitCode ?? "null"}, signal=${state.signalCode ?? "null"}). ` +
      `The ${PRODUCT_BASE_NAME} browser profile may already be in use by another Chrome process. ` +
      `Close the existing ${PRODUCT_BASE_NAME} browser window or use Settings > Browser Use > Close, then retry.`,
  );
}

function getExitedProcessState(
  processHandle: BrowserProcessHandle | undefined,
): BrowserProcessExitState | null {
  const state = processHandle?.getExitState?.();
  if (!state) {
    return null;
  }
  return state.exitCode !== null || state.signalCode !== null || state.killed ? state : null;
}

function metadataToRecoveredProcessHandle(metadata: BrowserRuntimeMetadata): BrowserProcessHandle {
  return {
    browserName: metadata.browserName,
    executablePath: metadata.executablePath,
    debuggingPort: metadata.debuggingPort,
    userDataDir: metadata.userDataDir,
    ...(metadata.pid ? { pid: metadata.pid } : {}),
    dispose: async () => undefined,
  };
}

async function waitForCdpEndpoint(
  port: number,
  timeoutMs = 15_000,
  processHandle?: BrowserProcessHandle,
): Promise<void> {
  const endpoint = cdpVersionEndpoint(port);
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const exitedState = getExitedProcessState(processHandle);
    if (exitedState) {
      throw processExitedBeforeCdpError(port, exitedState);
    }

    const probe = await probeCdpEndpoint(port);
    if (probe.ok) {
      return;
    }
    lastError = probe.error;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const exitedState = getExitedProcessState(processHandle);
  if (exitedState) {
    throw processExitedBeforeCdpError(port, exitedState);
  }

  throw new Error(
    `Chrome/Edge did not expose a local CDP endpoint at ${endpoint}. ${lastError ?? ""}`.trim(),
  );
}

async function launchBrowserProcess(input: {
  readonly userDataDir: string;
  readonly initialUrl?: string;
}): Promise<BrowserProcessHandle> {
  const executable = await resolveInstalledBrowserExecutable();
  const debuggingPort = await findAvailableLocalPort();
  const args = buildBrowserLaunchArgs({
    debuggingPort,
    userDataDir: input.userDataDir,
    ...(trimText(input.initialUrl) ? { initialUrl: input.initialUrl } : {}),
  });
  const child = NodeChildProcess.spawn(executable.executablePath, args, {
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  let disposed = false;
  return {
    ...executable,
    debuggingPort,
    userDataDir: input.userDataDir,
    ...(child.pid ? { pid: child.pid } : {}),
    getExitState: () => ({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      killed: child.killed,
    }),
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (child.exitCode !== null || child.killed) {
        return;
      }
      child.kill();
      await Promise.race([
        waitForProcessExit(child),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    },
  };
}

async function connectOverCdp(port: number): Promise<{
  readonly browser: Browser;
  readonly context: BrowserContext;
}> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new Error("Chrome/Edge CDP connection did not expose a browser context.");
  }
  return { browser, context };
}

async function launchCdpBrowser(input: {
  readonly userDataDir: string;
  readonly initialUrl?: string;
}): Promise<LaunchedCdpBrowser> {
  const browserProcess = await launchBrowserProcess(input);
  try {
    await waitForCdpEndpoint(browserProcess.debuggingPort, 15_000, browserProcess);
    const { browser, context } = await connectOverCdp(browserProcess.debuggingPort);
    return { browserProcess, browser, context };
  } catch (error) {
    await browserProcess.dispose().catch(() => undefined);
    throw error;
  }
}

const browserAutomationServices = new Map<string, BrowserAutomationServiceShape>();

export function createBrowserAutomationService(
  serverConfig: ServerConfig["Service"],
  dependencies: BrowserAutomationServiceDependencies = {},
): BrowserAutomationServiceShape {
  const profilePaths = resolveBrowserProfilePaths(serverConfig.stateDir);
  const launchBrowser = dependencies.launchCdpBrowser ?? launchCdpBrowser;
  const connectBrowser = dependencies.connectOverCdp ?? connectOverCdp;
  const probeEndpoint = dependencies.probeCdpEndpoint ?? probeCdpEndpoint;
  const readFile =
    dependencies.readFile ?? ((filePath: string) => NodeFSP.readFile(filePath, "utf8"));
  const writeFile =
    dependencies.writeFile ??
    ((filePath: string, content: string) => NodeFSP.writeFile(filePath, content));
  const renameFile =
    dependencies.renameFile ??
    ((fromPath: string, toPath: string) => NodeFSP.rename(fromPath, toPath));
  const removeFile =
    dependencies.removeFile ??
    ((filePath: string) => NodeFSP.rm(filePath, { force: true }).then(() => undefined));
  const makeDirectory =
    dependencies.makeDirectory ??
    ((directoryPath: string) =>
      NodeFSP.mkdir(directoryPath, { recursive: true }).then(() => undefined));
  const removeDirectory =
    dependencies.removeDirectory ??
    ((directoryPath: string) =>
      NodeFSP.rm(directoryPath, { recursive: true, force: true }).then(() => undefined));
  let browserProcess: BrowserProcessHandle | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let activePage: Page | null = null;

  const readRuntimeMetadata = async (): Promise<BrowserRuntimeMetadata | null> => {
    const raw = await readFile(profilePaths.defaultRuntimeMetadataPath).catch(() => "");
    if (!raw.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BrowserRuntimeMetadata>;
      if (
        parsed.version !== 1 ||
        parsed.profileId !== "default" ||
        typeof parsed.userDataDir !== "string" ||
        normalizeFilesystemPath(parsed.userDataDir) !==
          normalizeFilesystemPath(profilePaths.defaultProfileDir) ||
        (parsed.browserName !== "chrome" && parsed.browserName !== "msedge") ||
        typeof parsed.executablePath !== "string" ||
        !isValidLocalPort(parsed.debuggingPort) ||
        typeof parsed.launchedAt !== "string" ||
        (parsed.pid !== undefined && !Number.isInteger(parsed.pid))
      ) {
        return null;
      }
      return {
        version: 1,
        profileId: "default",
        userDataDir: parsed.userDataDir,
        browserName: parsed.browserName,
        executablePath: parsed.executablePath,
        debuggingPort: parsed.debuggingPort,
        ...(parsed.pid !== undefined ? { pid: parsed.pid } : {}),
        launchedAt: parsed.launchedAt,
      };
    } catch {
      return null;
    }
  };

  const writeRuntimeMetadata = async (launched: LaunchedCdpBrowser) => {
    await makeDirectory(profilePaths.profilesDir);
    const metadata: BrowserRuntimeMetadata = {
      version: 1,
      profileId: "default",
      userDataDir: launched.browserProcess.userDataDir,
      browserName: launched.browserProcess.browserName,
      executablePath: launched.browserProcess.executablePath,
      debuggingPort: launched.browserProcess.debuggingPort,
      ...(launched.browserProcess.pid ? { pid: launched.browserProcess.pid } : {}),
      launchedAt: new Date().toISOString(),
    };
    const temporaryPath = `${profilePaths.defaultRuntimeMetadataPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await renameFile(temporaryPath, profilePaths.defaultRuntimeMetadataPath);
  };

  const removeRuntimeMetadata = async () => {
    await removeFile(profilePaths.defaultRuntimeMetadataPath).catch(() => undefined);
    await removeFile(`${profilePaths.defaultRuntimeMetadataPath}.tmp`).catch(() => undefined);
  };

  const reconnectFromRuntimeMetadata = async (): Promise<boolean> => {
    const metadata = await readRuntimeMetadata();
    if (!metadata) {
      return false;
    }
    const probe = await probeEndpoint(metadata.debuggingPort);
    if (!probe.ok) {
      return false;
    }
    const connected = await connectBrowser(metadata.debuggingPort);
    browserProcess = metadataToRecoveredProcessHandle(metadata);
    browser = connected.browser;
    context = connected.context;
    activePage = null;
    browser.on("disconnected", clearBrowserHandles);
    return true;
  };

  const clearBrowserHandles = () => {
    browserProcess = null;
    browser = null;
    context = null;
    activePage = null;
  };

  const closeBrowserHandles = async () => {
    const previousBrowser = browser;
    const previousProcess = browserProcess;
    clearBrowserHandles();
    await previousBrowser?.close().catch(() => undefined);
    await previousProcess?.dispose().catch(() => undefined);
    await removeRuntimeMetadata();
  };

  const getContext = async (): Promise<BrowserContext> => {
    await makeDirectory(profilePaths.defaultProfileDir);
    if (!context) {
      const reconnected = await reconnectFromRuntimeMetadata();
      if (!reconnected) {
        const launched = await launchBrowser({ userDataDir: profilePaths.defaultProfileDir });
        await writeRuntimeMetadata(launched);
        browserProcess = launched.browserProcess;
        browser = launched.browser;
        context = launched.context;
        browser.on("disconnected", clearBrowserHandles);
      }
    }

    const currentContext = context;
    if (!currentContext) {
      throw new Error(`${PRODUCT_BASE_NAME} browser did not expose a usable browser context.`);
    }
    return currentContext;
  };

  const getPage = async (): Promise<Page> => {
    const currentContext = await getContext();
    activePage =
      activePage && !activePage.isClosed() ? activePage : (currentContext.pages()[0] ?? null);
    if (!activePage || activePage.isClosed()) {
      activePage = await currentContext.newPage();
    }
    return activePage;
  };

  const snapshot = async (): Promise<BrowserProfileSnapshot> => {
    const page = activePage && !activePage.isClosed() ? activePage : null;
    const currentTitle = page ? await titleOf(page) : undefined;
    const currentUrl = page?.url();
    const recoveredMetadata = context ? null : await readRuntimeMetadata();
    const recoveredProbe = recoveredMetadata
      ? await probeEndpoint(recoveredMetadata.debuggingPort).catch(() => ({ ok: false }))
      : null;
    const snapshotProcess =
      browserProcess ??
      (recoveredMetadata && recoveredProbe?.ok
        ? metadataToRecoveredProcessHandle(recoveredMetadata)
        : null);
    return {
      profileId: "default",
      profilePath: profilePaths.defaultProfileDir,
      status: context || recoveredProbe?.ok ? "open" : "closed",
      ...(snapshotProcess
        ? {
            launchMode: "cdp-attached" as const,
            browserName: snapshotProcess.browserName,
            debuggingPort: snapshotProcess.debuggingPort,
          }
        : {}),
      ...(currentUrl && currentUrl !== "about:blank" ? { currentUrl } : {}),
      ...(currentTitle ? { currentTitle } : {}),
    };
  };

  return {
    context: getContext,
    snapshot,
    openLoginWindow: async (input) => {
      const url = trimText(input?.url);
      const page = await getPage();
      if (url) await page.goto(normalizePreviewUrl(url), { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      return snapshot();
    },
    closeBrowser: async () => {
      if (!context) {
        await reconnectFromRuntimeMetadata().catch(() => false);
      }
      await closeBrowserHandles();
      return snapshot();
    },
    clearProfileData: async () => {
      if (!context) {
        await reconnectFromRuntimeMetadata().catch(() => false);
      }
      await closeBrowserHandles();
      await removeDirectory(profilePaths.defaultProfileDir);
      await makeDirectory(profilePaths.defaultProfileDir);
      return snapshot();
    },
  } satisfies BrowserAutomationServiceShape;
}

export function getBrowserAutomationService(
  serverConfig: ServerConfig["Service"],
): BrowserAutomationServiceShape {
  const existing = browserAutomationServices.get(serverConfig.stateDir);
  if (existing) {
    return existing;
  }
  const created = createBrowserAutomationService(serverConfig);
  browserAutomationServices.set(serverConfig.stateDir, created);
  return created;
}
