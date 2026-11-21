// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import {
  errors,
  type BrowserContext,
  type CDPSession,
  type Dialog,
  type Download,
  type ElementHandle,
  type FileChooser,
  type Locator,
  type Page,
} from "playwright-core";

import {
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_AUTOMATION_V1_OPERATIONS,
  type BrowserNavigationTarget,
  type EnvironmentId,
  type OrchestrationV2DomainEvent,
  type PreviewAutomationActionEvent,
  type PreviewAutomationClickInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationDialogInput,
  type PreviewAutomationDragInput,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationHoverInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationHostFocus,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationOpenInput,
  type PreviewAutomationOperation,
  type PreviewAutomationPressInput,
  type PreviewAutomationRequest,
  type PreviewAutomationResponse,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSelectInput,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationSnapshotInput,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationUploadInput,
  type PreviewAutomationWaitForInput,
  type PreviewViewportSetting,
  type ThreadId,
  PreviewTabId,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  forkParked,
  isActiveRun,
  PreviewAutomationBroker,
  ServerEnvironment,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import type { PreviewAutomationServerHost } from "../../../../apps/server/src/mcp/PreviewAutomationBroker.ts";
import * as ServerBrowserPage from "../../../../apps/server/src/preview/ServerBrowserPage.ts";
import { BrowserAutomationService } from "./BrowserAutomationService.ts";
import { readBrowserUseSettings } from "./BrowserUseSettings.ts";
import type { BrowserForAgents } from "@t3tools/computer-use-contracts/rpc";

/** How a failed request is reported to the broker, with the tags desktop hosts use. */
export type PreviewAutomationRemoteError = NonNullable<PreviewAutomationResponse["error"]>;

const DIAGNOSTIC_BUFFER_LIMIT = 200;
/** Largest serialized `evaluate` result, as in the built-in browser. */
const MAX_EVALUATION_BYTES = 64_000;
/** Saved downloads a tab lists; older files are deleted. */
const DOWNLOAD_LIMIT = 20;
/** The built-in browser's limits, so an agent that loops cannot fill Chrome with tabs. */
const AGENT_TAB_LIMIT = 8;
const TOTAL_TAB_LIMIT = 32;
/** An agent tab nobody used this long is closed; workers that stop early leave tabs behind. */
export const CHROME_TAB_IDLE_MS = 30 * 60_000;
/** How long a locator may take to become actionable when the call sets no timeout. */
const LOCATOR_ACTION_TIMEOUT_MS = 5_000;
/** Leaves time to reply before the broker gives up on the request. */
const BROKER_REPLY_MARGIN_MS = 500;
const WAIT_FOR_POLL_INTERVAL_MS = 100;
const INVALID_SELECTOR_PATTERN =
  /strict mode violation|while parsing|unexpected token|unknown engine|not a valid selector/iu;

type SelectorKind = "locator" | "selector" | "focused-element";

interface LocatorInput {
  readonly selector?: string | undefined;
  readonly locator?: string | undefined;
}

type ChromeDownload = NonNullable<PreviewAutomationStatus["downloads"]>[number];

interface ChromeTab {
  readonly id: PreviewTabId;
  readonly threadId: ThreadId;
  readonly page: Page;
  viewportSetting: PreviewViewportSetting;
  cdp: Promise<CDPSession> | undefined;
  readonly consoleEntries: PreviewAutomationConsoleEntry[];
  readonly networkEntries: PreviewAutomationNetworkEntry[];
  readonly actionTimeline: PreviewAutomationActionEvent[];
  dialog: Dialog | null;
  fileChooser: { readonly chooser: FileChooser; readonly accept: string } | null;
  readonly downloads: ChromeDownload[];
  readonly savingDownloads: Set<Promise<void>>;
  usedAt: number;
}

/** A failure reported to agents with the same tags desktop hosts use. */
// @effect-diagnostics-next-line extendsNativeError:off - thrown in Playwright promise code; the tryPromise catch unwraps it.
export class ChromePreviewHostError extends Error {
  readonly remote: PreviewAutomationRemoteError;

  constructor(remote: PreviewAutomationRemoteError) {
    super(remote.message);
    this.name = "ChromePreviewHostError";
    this.remote = remote;
  }
}

const hostError = (_tag: string, message: string, detail?: unknown) =>
  new ChromePreviewHostError({ _tag, message, ...(detail === undefined ? {} : { detail }) });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const toPreviewAutomationRemoteError = (cause: unknown): PreviewAutomationRemoteError => {
  if (cause instanceof ChromePreviewHostError) return cause.remote;
  // The built-in browser's page actions, which this host shares, fail with their own tags.
  if (cause instanceof ServerBrowserPage.ServerBrowserOperationError) {
    const { tag, message, detail } = cause;
    return { _tag: tag, message, ...(detail === undefined ? {} : { detail }) };
  }
  return { _tag: "PreviewAutomationExecutionError", message: errorMessage(cause) };
};

/** Runs one of the built-in browser's page actions, with its error tags. */
const sharedAction = <A>(run: () => Promise<A>): Promise<A> =>
  run().catch((cause: unknown) => {
    throw ServerBrowserPage.toOperationError(cause);
  });

const DIALOG_PENDING_MESSAGE =
  "A browser dialog is pending. Read preview_status and use preview_dialog first.";

/** Same selector conventions as the desktop host: `selector` is legacy CSS; refs come from snapshots. */
const automationLocator = (page: Page, input: LocatorInput): Locator | null => {
  const locator = input.locator ?? (input.selector ? `css=${input.selector}` : undefined);
  return locator === undefined ? null : ServerBrowserPage.targetLocator(page, { locator });
};

const selectorDiagnostics = (
  input: LocatorInput,
): { readonly selectorKind: SelectorKind; readonly selectorLength?: number } => {
  if (input.locator !== undefined) {
    return { selectorKind: "locator", selectorLength: input.locator.length };
  }
  if (input.selector !== undefined) {
    return { selectorKind: "selector", selectorLength: input.selector.length };
  }
  return { selectorKind: "focused-element" };
};

const locatorFailure = (cause: unknown, input: LocatorInput): Error => {
  if (cause instanceof ChromePreviewHostError) return cause;
  if (cause instanceof ServerBrowserPage.ServerBrowserOperationError) return cause;
  const message = errorMessage(cause);
  if (INVALID_SELECTOR_PATTERN.test(message)) {
    return hostError("PreviewAutomationInvalidSelectorError", message, selectorDiagnostics(input));
  }
  if (cause instanceof errors.TimeoutError) {
    return hostError("PreviewAutomationTargetNotFoundError", message, selectorDiagnostics(input));
  }
  return hostError("PreviewAutomationExecutionError", message);
};

const replyBudgetMs = (request: PreviewAutomationRequest): number =>
  Math.max(1_000, request.timeoutMs - BROKER_REPLY_MARGIN_MS);

/** An explicit call timeout is honored; otherwise locators wait briefly, like Playwright MCP. */
const locatorTimeoutMs = (request: PreviewAutomationRequest, inputTimeoutMs?: number): number =>
  inputTimeoutMs === undefined
    ? Math.min(LOCATOR_ACTION_TIMEOUT_MS, replyBudgetMs(request))
    : replyBudgetMs(request);

const pushBounded = <A>(buffer: A[], entry: A): void => {
  buffer.push(entry);
  if (buffer.length > DIAGNOSTIC_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - DIAGNOSTIC_BUFFER_LIMIT);
  }
};

/** Resolves a URL the way the built-in browser does; any http(s) destination is allowed. */
const resolveUrl = (rawUrl: string): string => {
  let url: URL;
  try {
    url = new URL(normalizePreviewUrl(rawUrl));
  } catch (cause) {
    throw hostError("PreviewAutomationExecutionError", errorMessage(cause));
  }
  // Dev servers bound to every interface are reachable through localhost.
  if (url.hostname === "0.0.0.0") url.hostname = "localhost";
  return url.href;
};

/** The Chrome host runs on the server machine, so environment ports are local. */
const resolveNavigationTarget = (target: BrowserNavigationTarget): string => {
  if (target.kind === "url") return resolveUrl(target.url);
  const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
  return new URL(path, `${target.protocol ?? "http"}://localhost:${target.port}`).href;
};

interface EditableCandidate {
  readonly tagName: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

// Runs in the page. Mirrors the desktop host's check in apps/desktop/src/preview/Manager.ts.
const isEditableTextTarget = (element: EditableCandidate): boolean => {
  const tagName = element.tagName.toLowerCase();
  const textControl =
    tagName === "textarea" ||
    (tagName === "input" &&
      ![
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].includes(element.type ?? ""));
  return (
    (textControl || element.isContentEditable === true) &&
    element.disabled !== true &&
    element.readOnly !== true
  );
};

interface FocusCandidate {
  readonly focus?: () => void;
  readonly getRootNode: () => { readonly activeElement?: unknown };
  readonly contains: (other: unknown) => boolean;
}

// Runs in the page. A key meant for a target that cannot take focus would go elsewhere.
const focusPressTarget = (element: FocusCandidate): boolean => {
  element.focus?.();
  const active = element.getRootNode().activeElement;
  return active != null && (active === element || element.contains(active));
};

interface ScrollTarget {
  readonly scrollBy: (options: { left: number; top: number; behavior: "instant" }) => void;
}

// Runs in the page.
const scrollTarget = (target: ScrollTarget, delta: { left: number; top: number }): void =>
  target.scrollBy({ ...delta, behavior: "instant" });

/** A download's suggested name as a plain file name. */
const downloadFileName = (suggested: string): string =>
  NodePath.basename(suggested.replaceAll("\\", "/"))
    .replace(/[<>:"|?*\u0000-\u001f]/gu, "_")
    .slice(0, 200) || "download";

export interface ChromePreviewHostOptions {
  /** Opens the managed browser on first use and returns its persistent profile context. */
  readonly getContext: () => Promise<BrowserContext>;
  /** Where agents' downloads are saved, one folder per tab. Unset leaves them to Chrome. */
  readonly downloadsDir?: string;
  readonly now?: () => number;
}

export interface ChromePreviewHost {
  readonly supportedOperations: ReadonlyArray<PreviewAutomationOperation>;
  readonly execute: (request: PreviewAutomationRequest) => Promise<unknown>;
  readonly liveTabs: () => NonNullable<PreviewAutomationHostFocus["liveTabs"]>;
  /** Closes the thread's tabs, for a deleted thread or a finished worker. */
  readonly closeThreadTabs: (threadId: ThreadId) => Promise<void>;
  /** Closes tabs no call used for `CHROME_TAB_IDLE_MS`. */
  readonly closeIdleTabs: () => Promise<void>;
  /** Called when a tab opens or closes outside a request, such as the user closing it. */
  readonly onTabsChanged: (listener: () => void) => () => void;
}

/**
 * Runs preview automation requests in the managed external Chrome. Tabs,
 * results and errors follow the desktop host's contract, and permissions are
 * the built-in browser's: any URL, local dev servers included, no prompts.
 */
export function createChromePreviewHost(options: ChromePreviewHostOptions): ChromePreviewHost {
  const tabs = new Map<string, ChromeTab>();
  const threadTabIds = new Map<string, string>();
  let actionSequence = 0;
  let downloadSequence = 0;
  const now = options.now ?? Date.now;
  const tabsChangedListeners = new Set<() => void>();
  const tabsChanged = () => {
    for (const listener of tabsChangedListeners) listener();
  };

  const openTabs = () => [...tabs.values()].filter((tab) => !tab.page.isClosed());
  const threadTabs = (threadId: ThreadId) => openTabs().filter((tab) => tab.threadId === threadId);

  const registerTab = (page: Page, threadId: ThreadId): ChromeTab => {
    const tab: ChromeTab = {
      id: PreviewTabId.make(`chrome-${NodeCrypto.randomUUID().slice(0, 8)}`),
      threadId,
      page,
      viewportSetting: FILL_PREVIEW_VIEWPORT,
      cdp: undefined,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
      dialog: null,
      fileChooser: null,
      downloads: [],
      savingDownloads: new Set(),
      usedAt: now(),
    };
    const timestamp = () => new Date().toISOString();
    page.on("console", (message) =>
      pushBounded(tab.consoleEntries, {
        level: message.type(),
        text: message.text(),
        timestamp: timestamp(),
        source: "console",
      }),
    );
    page.on("pageerror", (error) =>
      pushBounded(tab.consoleEntries, {
        level: "error",
        text: error.message,
        timestamp: timestamp(),
        source: "exception",
      }),
    );
    page.on("response", (response) =>
      pushBounded(tab.networkEntries, {
        url: ServerBrowserPage.withoutDataPayload(response.url()),
        method: response.request().method(),
        status: response.status(),
        failed: response.status() >= 400,
        timestamp: timestamp(),
      }),
    );
    page.on("requestfailed", (request) =>
      pushBounded(tab.networkEntries, {
        url: ServerBrowserPage.withoutDataPayload(request.url()),
        method: request.method(),
        status: null,
        failed: true,
        errorText: request.failure()?.errorText ?? "Network request failed",
        timestamp: timestamp(),
      }),
    );
    // Listening keeps Playwright from dismissing dialogs, so the agent sees and answers them.
    page.on("dialog", (dialog) => {
      tab.dialog = dialog;
    });
    // The user can answer a dialog in the Chrome window too.
    void cdpSession(tab)
      .then(async (cdp) => {
        cdp.on("Page.javascriptDialogClosed", () => {
          tab.dialog = null;
        });
        await cdp.send("Page.enable");
      })
      .catch(() => undefined);
    // Listening also intercepts the native picker, so the agent answers it with upload.
    page.on("filechooser", (chooser) => void offerFileChooser(tab, chooser));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) tab.fileChooser = null;
    });
    page.on("download", (download) => {
      const saving = saveDownload(tab, download).finally(() => tab.savingDownloads.delete(saving));
      tab.savingDownloads.add(saving);
    });
    page.on("close", () => {
      tabs.delete(tab.id);
      tabsChanged();
    });
    tabs.set(tab.id, tab);
    return tab;
  };

  const offerFileChooser = async (tab: ChromeTab, chooser: FileChooser) => {
    const accept =
      (await chooser
        .element()
        .getAttribute("accept")
        .catch(() => null)) ?? "";
    tab.fileChooser = { chooser, accept: accept.slice(0, 1024) };
  };

  const saveDownload = async (tab: ChromeTab, download: Download): Promise<void> => {
    const downloadsDir = options.downloadsDir;
    if (downloadsDir === undefined) return;
    const fileName = downloadFileName(download.suggestedFilename());
    const directory = NodePath.join(downloadsDir, tab.id);
    const path = NodePath.join(directory, `${++downloadSequence}-${fileName}`);
    try {
      await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
      await download.saveAs(path);
      if (await download.failure()) return;
      const { size } = await NodeFSP.stat(path);
      tab.downloads.push({
        fileName,
        path,
        sizeBytes: size,
        url: ServerBrowserPage.withoutDataPayload(download.url()).slice(0, 2048),
        completedAt: new Date().toISOString(),
      });
      for (const evicted of tab.downloads.splice(0, tab.downloads.length - DOWNLOAD_LIMIT)) {
        await NodeFSP.rm(evicted.path, { force: true }).catch(() => undefined);
      }
    } catch {
      await NodeFSP.rm(path, { force: true }).catch(() => undefined);
    }
  };

  const currentTab = (request: PreviewAutomationRequest): ChromeTab | undefined => {
    const tabId = request.tabId ?? threadTabIds.get(request.threadId);
    const tab = tabId === undefined ? undefined : tabs.get(tabId);
    if (!tab || tab.page.isClosed()) return undefined;
    if (tab.threadId !== request.threadId) {
      throw hostError(
        "PreviewAutomationControlInterruptedError",
        "This Chrome tab belongs to another agent. Open your own tab.",
        "agentMismatch",
      );
    }
    tab.usedAt = now();
    return tab;
  };

  const requireTab = (request: PreviewAutomationRequest): ChromeTab => {
    const tab = currentTab(request);
    if (tab) return tab;
    throw hostError(
      "PreviewAutomationTabNotFoundError",
      request.tabId === undefined
        ? "No Chrome tab is open for this thread. Call preview_open first."
        : `Chrome tab ${request.tabId} is closed or unknown.`,
    );
  };

  const cdpSession = (tab: ChromeTab): Promise<CDPSession> => {
    tab.cdp ??= tab.page.context().newCDPSession(tab.page);
    return tab.cdp;
  };

  const evaluateInPage = async (
    tab: ChromeTab,
    expression: string,
    evaluation: { readonly returnByValue: boolean; readonly awaitPromise: boolean },
  ): Promise<unknown> => {
    const cdp = await cdpSession(tab);
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      ...evaluation,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw hostError(
        "PreviewAutomationExecutionError",
        `JavaScript evaluation failed: ${details.exception?.description ?? details.text}`,
      );
    }
    return response.result.value;
  };

  const withAction = async <A>(
    tab: ChromeTab,
    action: string,
    run: () => Promise<A>,
  ): Promise<A> => {
    actionSequence += 1;
    const event: PreviewAutomationActionEvent = {
      id: `browser-action-${Date.now().toString(36)}-${actionSequence.toString(36)}`,
      action,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    pushBounded(tab.actionTimeline, event);
    const settle = (next: PreviewAutomationActionEvent) => {
      const index = tab.actionTimeline.findIndex((candidate) => candidate.id === event.id);
      if (index >= 0) tab.actionTimeline[index] = next;
    };
    try {
      const result = await run();
      settle({ ...event, status: "succeeded", completedAt: new Date().toISOString() });
      return result;
    } catch (cause) {
      settle({
        ...event,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: errorMessage(cause).split("\n", 1)[0] ?? "",
      });
      throw cause;
    }
  };

  /** Whether the tab's window is on screen; a tab behind another one in it still counts. */
  const windowShown = async (tab: ChromeTab): Promise<boolean> => {
    const window = await cdpSession(tab)
      .then((cdp) => cdp.send("Browser.getWindowForTarget"))
      .catch(() => null);
    return window !== null && window.bounds.windowState !== "minimized";
  };

  const status = async (tab: ChromeTab): Promise<PreviewAutomationStatus> => {
    // A pending dialog blocks page script, so status reads nothing from the page.
    const page = tab.dialog
      ? null
      : ((await tab.page
          .evaluate("({ readyState: document.readyState, width: innerWidth, height: innerHeight })")
          .catch(() => null)) as {
          readonly readyState: string;
          readonly width: number;
          readonly height: number;
        } | null);
    const title = tab.dialog ? "" : await tab.page.title().catch(() => "");
    return {
      available: true,
      visible: await windowShown(tab),
      tabId: tab.id,
      url: tab.page.url() || null,
      title: title || null,
      loading: page?.readyState !== "complete",
      dialog: tab.dialog
        ? {
            type: tab.dialog.type(),
            message: tab.dialog.message().slice(0, 4000),
            defaultValue: tab.dialog.defaultValue().slice(0, 4000),
          }
        : null,
      fileChooser: tab.fileChooser
        ? { multiple: tab.fileChooser.chooser.isMultiple(), accept: tab.fileChooser.accept }
        : null,
      downloads: [...tab.downloads],
      tabs: await Promise.all(
        threadTabs(tab.threadId).map(async (candidate) => ({
          tabId: candidate.id,
          url: candidate.page.url() || null,
          owner: "agent" as const,
          ownedByCaller: true,
          visible: await windowShown(candidate),
        })),
      ),
      viewportSetting: tab.viewportSetting,
      ...(page && page.width > 0 && page.height > 0
        ? { viewport: { width: page.width, height: page.height } }
        : {}),
    };
  };

  const navigate = async (
    tab: ChromeTab,
    url: string,
    readiness: NonNullable<PreviewAutomationNavigateInput["readiness"]>,
    timeout: number,
  ): Promise<void> => {
    try {
      await tab.page.goto(url, {
        waitUntil:
          readiness === "none"
            ? "commit"
            : readiness === "domContentLoaded"
              ? "domcontentloaded"
              : "load",
        timeout,
      });
    } catch (cause) {
      // A URL Chrome downloads instead of showing; preview_status lists the file.
      if (errorMessage(cause).includes("Download is starting")) {
        await Promise.race([
          Promise.all(tab.savingDownloads),
          new Promise((resolve) => setTimeout(resolve, timeout)),
        ]);
        return;
      }
      if (cause instanceof errors.TimeoutError) {
        throw hostError(
          "PreviewAutomationTimeoutError",
          `Chrome did not reach ${readiness} readiness for ${url} within ${timeout}ms.`,
        );
      }
      throw hostError(
        "PreviewAutomationExecutionError",
        `Chrome could not open ${url}: ${errorMessage(cause)}`,
      );
    }
  };

  const open = async (request: PreviewAutomationRequest): Promise<PreviewAutomationStatus> => {
    const input = request.input as PreviewAutomationOpenInput;
    const existing = (input.reuseExistingTab ?? true) ? currentTab(request) : undefined;
    if (existing?.dialog) {
      throw hostError(
        "PreviewAutomationControlInterruptedError",
        DIALOG_PENDING_MESSAGE,
        "dialogPending",
      );
    }
    if (
      !existing &&
      (threadTabs(request.threadId).length >= AGENT_TAB_LIMIT ||
        openTabs().length >= TOTAL_TAB_LIMIT)
    ) {
      throw hostError(
        "PreviewAutomationControlInterruptedError",
        `Too many Chrome tabs are open (${AGENT_TAB_LIMIT} per agent, ${TOTAL_TAB_LIMIT} in all). Close one with t3_preview_close, or reuse a tabId from preview_status tabs.`,
        "tabLimit",
      );
    }
    const tab =
      existing ?? registerTab(await (await options.getContext()).newPage(), request.threadId);
    threadTabIds.set(request.threadId, tab.id);
    if (input.url !== undefined) {
      await navigate(tab, resolveUrl(input.url), "load", replyBudgetMs(request));
    }
    // Only an explicit request raises the window: agents work while the user does something else.
    if ((input.open ?? input.show) === true) await tab.page.bringToFront().catch(() => undefined);
    return status(tab);
  };

  const resize = async (
    tab: ChromeTab,
    input: PreviewAutomationResizeInput,
  ): Promise<PreviewAutomationResizeResult> => {
    const setting = resolvePreviewViewport(input);
    const cdp = await cdpSession(tab);
    if (setting._tag === "fill") {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    } else {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: setting.width,
        height: setting.height,
        deviceScaleFactor: 0,
        mobile: false,
      });
    }
    tab.viewportSetting = setting;
    const viewport = (await evaluateInPage(tab, "({ width: innerWidth, height: innerHeight })", {
      returnByValue: true,
      awaitPromise: false,
    })) as PreviewAutomationResizeResult["viewport"];
    return { tabId: tab.id, setting, viewport };
  };

  /** The built-in browser's snapshot: an AI-mode tree with refs that actions accept. */
  const snapshot = async (tab: ChromeTab, input: PreviewAutomationSnapshotInput | undefined) => {
    const rendering = {
      page: tab.page,
      cdp: await cdpSession(tab),
      renderScale: "display",
      fullScreenshot: input?.fullScreenshot,
      consoleEntries: tab.consoleEntries,
      networkEntries: tab.networkEntries,
      actionTimeline: tab.actionTimeline,
    } as const;
    return sharedAction(() =>
      input?.pixelsRequired === false
        ? ServerBrowserPage.snapshotMetadata(rendering)
        : ServerBrowserPage.snapshot(rendering),
    );
  };

  const click = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationClickInput,
  ): Promise<void> => {
    const locator = automationLocator(tab.page, input);
    const options = { button: input.button ?? "left", clickCount: input.clickCount ?? 1 } as const;
    let clicked: Promise<void>;
    if (locator === null) {
      const x = input.x ?? 0;
      const y = input.y ?? 0;
      const viewport = (await tab.page.evaluate(
        "({ width: innerWidth, height: innerHeight })",
      )) as {
        readonly width: number;
        readonly height: number;
      };
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) {
        throw hostError(
          "PreviewAutomationExecutionError",
          `Click point (${x}, ${y}) is outside the ${viewport.width}x${viewport.height} viewport.`,
        );
      }
      clicked = tab.page.mouse.click(x, y, options);
    } else {
      clicked = locator
        .click({ ...options, timeout: locatorTimeoutMs(request, input.timeoutMs) })
        .catch((cause: unknown) => {
          throw locatorFailure(cause, input);
        });
    }
    // A dialog blocks the click until it is answered, so the click returns when one opens.
    let onDialog = () => {};
    const dialogOpened = new Promise<"dialog">((resolve) => {
      onDialog = () => resolve("dialog");
      tab.page.once("dialog", onDialog);
    });
    try {
      if ((await Promise.race([clicked, dialogOpened])) === "dialog") {
        void clicked.catch(() => undefined);
      }
    } finally {
      tab.page.off("dialog", onDialog);
    }
  };

  const typeText = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationTypeInput,
  ): Promise<void> => {
    const locator = automationLocator(tab.page, input);
    const timeout = locatorTimeoutMs(request, input.timeoutMs);
    let target: Locator | ElementHandle;
    if (locator === null) {
      const focused = (await tab.page.evaluateHandle("document.activeElement")).asElement();
      if (focused === null) {
        throw hostError(
          "PreviewAutomationTargetNotEditableError",
          "No element is focused to type into.",
          selectorDiagnostics(input),
        );
      }
      target = focused;
    } else {
      target = locator;
    }
    try {
      const editable =
        locator === null
          ? await (target as ElementHandle).evaluate(isEditableTextTarget)
          : await (target as Locator).evaluate(isEditableTextTarget, undefined, { timeout });
      if (!editable) {
        throw hostError(
          "PreviewAutomationTargetNotEditableError",
          "The type target is not an editable text field.",
          selectorDiagnostics(input),
        );
      }
      if (input.clear) {
        await target.fill(input.text, { timeout });
      } else {
        await target.focus({ timeout });
        await tab.page.keyboard.insertText(input.text);
      }
    } catch (cause) {
      throw locatorFailure(cause, input);
    }
  };

  const press = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationPressInput,
  ): Promise<void> => {
    const locator = automationLocator(tab.page, input);
    if (locator !== null) {
      const focused = await locator
        .evaluate(focusPressTarget, undefined, {
          timeout: locatorTimeoutMs(request, input.timeoutMs),
        })
        .catch((cause: unknown) => {
          throw locatorFailure(cause, input);
        });
      if (!focused) {
        throw hostError(
          "PreviewAutomationExecutionError",
          "The press target cannot take focus, so no key was pressed.",
        );
      }
    }
    await tab.page.keyboard.press([...(input.modifiers ?? []), input.key].join("+"));
  };

  const scroll = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationScrollInput,
  ): Promise<void> => {
    const delta = { left: input.deltaX ?? 0, top: input.deltaY ?? 0 };
    const locator = automationLocator(tab.page, input);
    if (locator === null) {
      await tab.page.evaluate(`scrollBy(${JSON.stringify({ ...delta, behavior: "instant" })})`);
      return;
    }
    await locator
      .evaluate(scrollTarget, delta, { timeout: locatorTimeoutMs(request) })
      .catch((cause: unknown) => {
        throw locatorFailure(cause, input);
      });
  };

  const evaluate = async (
    tab: ChromeTab,
    input: PreviewAutomationEvaluateInput,
  ): Promise<unknown> => {
    const value = await evaluateInPage(tab, input.expression, {
      returnByValue: true,
      awaitPromise: input.awaitPromise ?? true,
    });
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
    if (bytes > MAX_EVALUATION_BYTES) {
      throw hostError(
        "PreviewAutomationResultTooLargeError",
        `The evaluation result is ${bytes} bytes; the limit is ${MAX_EVALUATION_BYTES}.`,
        { maximumBytes: MAX_EVALUATION_BYTES },
      );
    }
    return value;
  };

  const waitFor = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationWaitForInput,
  ): Promise<void> => {
    const locator = automationLocator(tab.page, input);
    const pageConditions = `(${
      input.text === undefined
        ? "true"
        : `(document.body?.innerText || "").includes(${JSON.stringify(input.text)})`
    }) && (${
      input.urlIncludes === undefined
        ? "true"
        : `location.href.includes(${JSON.stringify(input.urlIncludes)})`
    })`;
    const timeoutMs = replyBudgetMs(request);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const selectorMatched =
        locator === null
          ? true
          : (await locator.count().catch((cause: unknown) => {
              if (INVALID_SELECTOR_PATTERN.test(errorMessage(cause))) {
                throw locatorFailure(cause, input);
              }
              return 0;
            })) > 0;
      // A navigation can replace the document mid-check; poll again.
      const pageMatched = await tab.page.evaluate(pageConditions).catch(() => false);
      if (selectorMatched && pageMatched === true) return;
      await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_POLL_INTERVAL_MS));
    }
    throw hostError(
      "PreviewAutomationTimeoutError",
      `The wait conditions did not match within ${timeoutMs}ms.`,
    );
  };

  const answerDialog = async (tab: ChromeTab, input: PreviewAutomationDialogInput) => {
    const dialog = tab.dialog;
    if (!dialog) throw hostError("PreviewAutomationExecutionError", "No dialog is pending.");
    if (input.accept) await dialog.accept(input.promptText);
    else await dialog.dismiss();
    if (tab.dialog === dialog) tab.dialog = null;
    return status(tab);
  };

  const upload = async (tab: ChromeTab, input: PreviewAutomationUploadInput) => {
    const relative = input.paths.find((path) => !NodePath.isAbsolute(path));
    if (relative !== undefined) {
      throw hostError(
        "PreviewAutomationExecutionError",
        `Upload paths must be absolute: ${relative}`,
      );
    }
    if (await sharedAction(() => ServerBrowserPage.setInputFiles(tab.page, input)))
      return undefined;
    const open = tab.fileChooser;
    if (!open) {
      throw hostError(
        "PreviewAutomationExecutionError",
        "No file picker is open. Click the page's upload control first, or pass the file input's locator.",
      );
    }
    if (input.paths.length > 1 && !open.chooser.isMultiple()) {
      throw hostError("PreviewAutomationExecutionError", "This file picker accepts one file.");
    }
    await sharedAction(() =>
      open.chooser.setFiles([...input.paths], { timeout: input.timeoutMs ?? 15_000 }),
    );
    if (tab.fileChooser === open) tab.fileChooser = null;
    return undefined;
  };

  const close = async (request: PreviewAutomationRequest): Promise<Record<string, never>> => {
    const tab = requireTab(request);
    try {
      await tab.page.close();
    } catch (cause) {
      throw hostError(
        "PreviewAutomationExecutionError",
        `Chrome could not close tab ${tab.id}: ${errorMessage(cause)}`,
      );
    }
    tabs.delete(tab.id);
    if (threadTabIds.get(request.threadId) === tab.id) threadTabIds.delete(request.threadId);
    return {};
  };

  /** A pending dialog blocks the page, so every other action waits for its answer. */
  const actionTab = (request: PreviewAutomationRequest): ChromeTab => {
    const tab = requireTab(request);
    if (tab.dialog) {
      throw hostError(
        "PreviewAutomationControlInterruptedError",
        DIALOG_PENDING_MESSAGE,
        "dialogPending",
      );
    }
    return tab;
  };

  const execute = async (request: PreviewAutomationRequest): Promise<unknown> => {
    switch (request.operation) {
      case "status": {
        const tab = currentTab(request);
        return tab
          ? status(tab)
          : {
              available: true,
              visible: false,
              tabId: null,
              url: null,
              title: null,
              loading: false,
            };
      }
      case "open":
        return open(request);
      case "close":
        return close(request);
      case "dialog":
        return answerDialog(requireTab(request), request.input as PreviewAutomationDialogInput);
      case "navigate": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationNavigateInput;
        await navigate(
          tab,
          input.target ? resolveNavigationTarget(input.target) : resolveUrl(input.url ?? ""),
          input.readiness ?? "load",
          replyBudgetMs(request),
        );
        return status(tab);
      }
      case "resize":
        return resize(actionTab(request), request.input as PreviewAutomationResizeInput);
      case "setColorScheme": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationSetColorSchemeInput;
        await tab.page.emulateMedia({
          colorScheme: input.colorScheme === "system" ? null : input.colorScheme,
        });
        return {
          tabId: tab.id,
          colorScheme: input.colorScheme,
        } satisfies PreviewAutomationSetColorSchemeResult;
      }
      case "snapshot": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationSnapshotInput | undefined;
        return withAction(tab, "snapshot", () => snapshot(tab, input));
      }
      case "click": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationClickInput;
        return withAction(tab, "click", () => click(tab, request, input));
      }
      case "type": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationTypeInput;
        return withAction(tab, "type", () => typeText(tab, request, input));
      }
      case "press": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationPressInput;
        return withAction(tab, "press", () => press(tab, request, input));
      }
      case "scroll": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationScrollInput;
        return withAction(tab, "scroll", () => scroll(tab, request, input));
      }
      case "evaluate": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationEvaluateInput;
        return withAction(tab, "evaluate", () => evaluate(tab, input));
      }
      case "waitFor": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationWaitForInput;
        return withAction(tab, "waitFor", () => waitFor(tab, request, input));
      }
      case "hover": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationHoverInput;
        return withAction(tab, "hover", () =>
          sharedAction(() => ServerBrowserPage.hover(tab.page, input)),
        );
      }
      case "select": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationSelectInput;
        return withAction(tab, "select", () =>
          sharedAction(() => ServerBrowserPage.select(tab.page, input)),
        );
      }
      case "drag": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationDragInput;
        return withAction(tab, "drag", () =>
          sharedAction(() => ServerBrowserPage.drag(tab.page, input)),
        );
      }
      case "upload": {
        const tab = actionTab(request);
        const input = request.input as PreviewAutomationUploadInput;
        return withAction(tab, "upload", () => upload(tab, input));
      }
      case "recordingStart":
      case "recordingStop":
        throw hostError(
          "PreviewAutomationUnsupportedClientError",
          "Browser recording is not supported by the Chrome host. Record in the desktop app's built-in browser instead.",
        );
    }
  };

  const liveTabs = () => openTabs().map((tab) => ({ threadId: tab.threadId, tabId: tab.id }));

  const closeTabs = async (closing: ReadonlyArray<ChromeTab>) => {
    await Promise.all(
      closing.map(async (tab) => {
        tabs.delete(tab.id);
        if (threadTabIds.get(tab.threadId) === tab.id) threadTabIds.delete(tab.threadId);
        await tab.page.close().catch(() => undefined);
      }),
    );
    if (closing.length > 0) tabsChanged();
  };

  return {
    supportedOperations: CHROME_PREVIEW_HOST_OPERATIONS,
    execute,
    liveTabs,
    closeThreadTabs: (threadId) => closeTabs(threadTabs(threadId)),
    closeIdleTabs: () =>
      closeTabs(openTabs().filter((tab) => now() - tab.usedAt >= CHROME_TAB_IDLE_MS)),
    onTabsChanged: (listener) => {
      tabsChangedListeners.add(listener);
      return () => tabsChangedListeners.delete(listener);
    },
  };
}

/** What this host serves; the server's own browser serves the rest. */
const CHROME_PREVIEW_HOST_OPERATIONS = [
  ...PREVIEW_AUTOMATION_V1_OPERATIONS,
  "resize",
  "setColorScheme",
  "close",
  "dialog",
  "hover",
  "select",
  "drag",
  "upload",
] as const;

export const CHROME_PREVIEW_HOST_CLIENT_ID = "upcomputer-chrome";

/**
 * Connects a Chrome host to the broker as a server-side host and answers its
 * requests, each in its own fiber. The broker ends the stream when it evicts a
 * host that did not answer in time; the host then connects again.
 */
export const serveChromePreviewHost = Effect.fn("ChromePreviewHost.serve")(function* (input: {
  readonly host: ChromePreviewHost;
  readonly environmentId: EnvironmentId;
  readonly preferred: PreviewAutomationServerHost["preferred"];
}) {
  const broker = yield* PreviewAutomationBroker;
  const events = yield* broker.connect(
    {
      clientId: CHROME_PREVIEW_HOST_CLIENT_ID,
      environmentId: input.environmentId,
      supportedOperations: input.host.supportedOperations,
    },
    { serverHost: { preferred: input.preferred } },
  );
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  let connectionId: string | undefined;
  const reportTabs = (reportConnectionId: string) =>
    Effect.suspend(() =>
      broker.focusHost({
        clientId: CHROME_PREVIEW_HOST_CLIENT_ID,
        environmentId: input.environmentId,
        connectionId: reportConnectionId,
        focused: false,
        liveTabs: input.host.liveTabs(),
      }),
    );
  yield* Effect.gen(function* () {
    // Tabs closed without a request (the user, cleanup) must stop routing named-tab calls here.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        input.host.onTabsChanged(() => {
          if (connectionId !== undefined) runFork(reportTabs(connectionId));
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Stream.runForEach(events, (event) => {
      if (event.type === "connected") connectionId = event.connectionId;
      if (event.type !== "request") return Effect.void;
      const reply = (fields: Pick<PreviewAutomationResponse, "ok" | "result" | "error">) =>
        broker
          .respond({
            clientId: CHROME_PREVIEW_HOST_CLIENT_ID,
            connectionId: event.connectionId,
            requestId: event.request.requestId,
            ...fields,
          })
          .pipe(Effect.ignore);
      // The broker routes a named tab by these, so they are current before the agent sees a reply.
      const reportLiveTabs = reportTabs(event.connectionId);
      return Effect.tryPromise({
        try: () => input.host.execute(event.request),
        catch: toPreviewAutomationRemoteError,
      }).pipe(
        Effect.matchEffect({
          onSuccess: (result) => Effect.andThen(reportLiveTabs, reply({ ok: true, result })),
          onFailure: (error) => Effect.andThen(reportLiveTabs, reply({ ok: false, error })),
        }),
        Effect.forkScoped,
      );
    });
  }).pipe(Effect.scoped);
});

/**
 * Which calls Chrome claims from the built-in browser: a thread it should
 * serve gets Chrome for a new tab while Chrome is installed and starts, and
 * keeps Chrome for the tabs it has there. Anything else stays where it is,
 * so a thread working in the built-in browser is never moved mid-task.
 */
export const chromePreference =
  (input: {
    readonly host: Pick<ChromePreviewHost, "liveTabs">;
    readonly wantsChrome: (scope: PreviewScope) => Promise<boolean>;
    readonly ensureAvailable: () => Promise<boolean>;
  }): PreviewAutomationServerHost["preferred"] =>
  ({ scope, operation }) =>
    Effect.promise(async () => {
      if (!(await input.wantsChrome(scope))) return false;
      if (operation === "open") return input.ensureAvailable();
      return input.host.liveTabs().some((tab) => tab.threadId === scope.thread.threadId);
    });

type PreviewScope = Parameters<PreviewAutomationServerHost["preferred"]>[0]["scope"];

/**
 * Whether "Browser for agents" gives a caller Chrome. Automatic gives it to
 * workers and delegated runs, which run unattended and keep working in Chrome
 * while the screen is off; chats keep the built-in browser the user watches.
 */
export const chromeForAgents =
  (input: {
    readonly browserForAgents: () => Promise<BrowserForAgents>;
    readonly isWorker: (threadId: ThreadId) => Promise<boolean>;
  }) =>
  async (scope: PreviewScope): Promise<boolean> => {
    const choice = await input.browserForAgents();
    if (choice !== "automatic") return choice === "chrome";
    return scope.thread.subagent === true || input.isWorker(scope.thread.threadId);
  };

/**
 * The managed Chrome as a server-side preview host: upstream's environment
 * browser and desktop apps serve agents first, and Chrome takes the calls
 * `chromePreference` gives it.
 */
export const ChromePreviewHostLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const browser = yield* BrowserAutomationService;
    const environmentId = yield* (yield* ServerEnvironment).getEnvironmentId;
    const downloadsDir = NodePath.join(serverConfig.stateDir, "browser-downloads");
    // Downloads are listed per tab in memory, so an earlier run's files are never listed again.
    yield* Effect.promise(() =>
      NodeFSP.rm(downloadsDir, { recursive: true, force: true }).catch(() => undefined),
    );
    const host = createChromePreviewHost({ getContext: browser.context, downloadsDir });
    const threads = yield* ThreadManagementService;
    const workers = workerThreads(threads);
    const preferred = chromePreference({
      host,
      wantsChrome: chromeForAgents({
        browserForAgents: () =>
          readBrowserUseSettings(serverConfig.settingsPath).then(
            (settings) => settings.browserForAgents,
          ),
        isWorker: workers.isWorker,
      }),
      ensureAvailable: browser.ensureAvailable,
    });
    yield* forkParked(
      serveChromePreviewHost({ host, environmentId, preferred }).pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.forever,
      ),
    );
    yield* forkParked(
      Effect.promise(() => host.closeIdleTabs()).pipe(Effect.repeat(Schedule.spaced("1 minute"))),
    );
    yield* forkParked(
      Stream.runForEach(
        threads.streamDomainEvents,
        chromeTabCleanup({ host, isWorker: workers.isWorker }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Chrome tab cleanup stopped reading thread events", { cause }),
        ),
        Effect.andThen(Effect.sleep("5 seconds")),
        Effect.forever,
      ),
    );
  }),
);

/** A deleted thread's tabs close, and so do a worker's once its run ends. */
export const chromeTabCleanup =
  (input: {
    readonly host: Pick<ChromePreviewHost, "liveTabs" | "closeThreadTabs">;
    readonly isWorker: (threadId: ThreadId) => Promise<boolean>;
  }) =>
  (event: OrchestrationV2DomainEvent): Effect.Effect<void> => {
    const { host } = input;
    if (!host.liveTabs().some((tab) => tab.threadId === event.threadId)) return Effect.void;
    if (event.type === "thread.deleted") {
      return Effect.promise(() => host.closeThreadTabs(event.threadId));
    }
    if (
      event.type === "run.updated" &&
      !isActiveRun(event.payload) &&
      event.payload.status !== "queued"
    ) {
      return Effect.promise(async () => {
        if (await input.isWorker(event.threadId)) await host.closeThreadTabs(event.threadId);
      });
    }
    return Effect.void;
  };

/**
 * Worker (task-agent run) threads are created hidden from the sidebar, and
 * stay that way, so the answer is cached per thread.
 */
const workerThreads = (threads: ThreadManagementService["Service"]) => {
  const known = new Map<ThreadId, boolean>();
  const runPromise = Effect.runPromise;
  return {
    isWorker: async (threadId: ThreadId): Promise<boolean> => {
      const cached = known.get(threadId);
      if (cached !== undefined) return cached;
      const shell = await runPromise(
        threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null)),
      );
      if (shell === null) return false;
      const worker = shell.sidebarHidden === true;
      known.set(threadId, worker);
      return worker;
    },
  };
};
