// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import {
  errors,
  type BrowserContext,
  type CDPSession,
  type ElementHandle,
  type Locator,
  type Page,
} from "playwright-core";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import type { ExperimentalPreviewAutomationHost } from "../../../../apps/server/src/extensionApi.ts";
import {
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_AUTOMATION_OPERATIONS,
  type BrowserNavigationTarget,
  type PreviewAutomationActionEvent,
  type PreviewAutomationClickInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationOpenInput,
  type PreviewAutomationOperation,
  type PreviewAutomationPressInput,
  type PreviewAutomationRemoteError,
  type PreviewAutomationRequest,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationWaitForInput,
  type PreviewViewportSetting,
} from "@upcomputer/contracts";
import { normalizePreviewUrl } from "@upcomputer/shared/preview";
import {
  PREVIEW_AUTOMATION_MAX_EVALUATION_BYTES,
  PREVIEW_AUTOMATION_MAX_SCREENSHOT_WIDTH,
  PREVIEW_AUTOMATION_PAGE_SNAPSHOT_EXPRESSION,
} from "@upcomputer/shared/previewAutomationPage";
import { resolvePreviewViewport } from "@upcomputer/shared/previewViewport";
import { getBrowserAutomationService } from "./BrowserAutomationService.ts";
import { readBrowserUseSettings } from "./BrowserUseSettings.ts";

const DIAGNOSTIC_BUFFER_LIMIT = 200;
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

interface ChromeTab {
  readonly id: string;
  readonly page: Page;
  viewportSetting: PreviewViewportSetting;
  cdp: Promise<CDPSession> | undefined;
  readonly consoleEntries: PreviewAutomationConsoleEntry[];
  readonly networkEntries: PreviewAutomationNetworkEntry[];
  readonly actionTimeline: PreviewAutomationActionEvent[];
}

/** A failure reported to agents with the same tags desktop hosts use. */
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

export const toPreviewAutomationRemoteError = (cause: unknown): PreviewAutomationRemoteError =>
  cause instanceof ChromePreviewHostError
    ? cause.remote
    : { _tag: "PreviewAutomationExecutionError", message: errorMessage(cause) };

/** Same selector conventions as the desktop host: `selector` is legacy CSS. */
const automationLocator = (input: LocatorInput): string | null =>
  input.locator ?? (input.selector ? `css=${input.selector}` : null);

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

const locatorFailure = (cause: unknown, input: LocatorInput): ChromePreviewHostError => {
  if (cause instanceof ChromePreviewHostError) return cause;
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

interface ScrollTarget {
  readonly scrollBy: (options: { left: number; top: number; behavior: "instant" }) => void;
}

// Runs in the page.
const scrollTarget = (target: ScrollTarget, delta: { left: number; top: number }): void =>
  target.scrollBy({ ...delta, behavior: "instant" });

const pngSize = (png: Buffer): { readonly width: number; readonly height: number } => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

export interface ChromePreviewHostOptions {
  /** Opens the managed browser on first use and returns its persistent profile context. */
  readonly getContext: () => Promise<BrowserContext>;
}

export interface ChromePreviewHost {
  readonly supportedOperations: ReadonlyArray<PreviewAutomationOperation>;
  readonly execute: (request: PreviewAutomationRequest) => Promise<unknown>;
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

  const registerTab = (page: Page): ChromeTab => {
    const tab: ChromeTab = {
      id: `chrome-${NodeCrypto.randomUUID().slice(0, 8)}`,
      page,
      viewportSetting: FILL_PREVIEW_VIEWPORT,
      cdp: undefined,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
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
    page.on("response", (response) => {
      if (response.status() < 400) return;
      pushBounded(tab.networkEntries, {
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        failed: true,
        timestamp: timestamp(),
      });
    });
    page.on("requestfailed", (request) =>
      pushBounded(tab.networkEntries, {
        url: request.url(),
        method: request.method(),
        status: null,
        failed: true,
        errorText: request.failure()?.errorText ?? "Network request failed",
        timestamp: timestamp(),
      }),
    );
    page.on("close", () => tabs.delete(tab.id));
    tabs.set(tab.id, tab);
    return tab;
  };

  const currentTab = (request: PreviewAutomationRequest): ChromeTab | undefined => {
    const tabId = request.tabId ?? threadTabIds.get(request.threadId);
    const tab = tabId === undefined ? undefined : tabs.get(tabId);
    return tab && !tab.page.isClosed() ? tab : undefined;
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

  const status = async (tab: ChromeTab): Promise<PreviewAutomationStatus> => {
    const page = (await tab.page
      .evaluate("({ readyState: document.readyState, width: innerWidth, height: innerHeight })")
      .catch(() => null)) as {
      readonly readyState: string;
      readonly width: number;
      readonly height: number;
    } | null;
    const title = await tab.page.title().catch(() => "");
    return {
      available: true,
      visible: true,
      tabId: tab.id,
      url: tab.page.url() || null,
      title: title || null,
      loading: page?.readyState !== "complete",
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
    const tab = existing ?? registerTab(await (await options.getContext()).newPage());
    threadTabIds.set(request.threadId, tab.id);
    if (input.url !== undefined) {
      await navigate(tab, resolveUrl(input.url), "load", replyBudgetMs(request));
    }
    if (input.show ?? true) await tab.page.bringToFront().catch(() => undefined);
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

  const captureScreenshot = async (
    tab: ChromeTab,
  ): Promise<PreviewAutomationSnapshot["screenshot"]> => {
    const cdp = await cdpSession(tab);
    const page = (await evaluateInPage(
      tab,
      "({ devicePixelRatio, hidden: document.visibilityState !== 'visible' })",
      { returnByValue: true, awaitPromise: false },
    )) as { readonly devicePixelRatio: number; readonly hidden: boolean };
    // A background tab of a headed browser renders no frames to capture.
    if (page.hidden) await tab.page.bringToFront();
    const { cssVisualViewport: viewport } = await cdp.send("Page.getLayoutMetrics");
    const capture = async (scale: number) => {
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
        clip: {
          x: viewport.pageX,
          y: viewport.pageY,
          width: viewport.clientWidth,
          height: viewport.clientHeight,
          scale,
        },
      });
      return { data, ...pngSize(Buffer.from(data, "base64")) };
    };
    // Like the desktop host: device pixels, scaled down to the maximum width.
    const targetWidth = Math.min(
      PREVIEW_AUTOMATION_MAX_SCREENSHOT_WIDTH,
      Math.round(viewport.clientWidth * page.devicePixelRatio),
    );
    const scale = targetWidth / viewport.clientWidth;
    let screenshot = await capture(scale);
    // Some displays apply their pixel ratio on top of the clip scale.
    if (screenshot.width > PREVIEW_AUTOMATION_MAX_SCREENSHOT_WIDTH) {
      screenshot = await capture((scale * targetWidth) / screenshot.width);
    }
    return { mimeType: "image/png", ...screenshot };
  };

  const snapshot = async (tab: ChromeTab): Promise<PreviewAutomationSnapshot> => {
    const cdp = await cdpSession(tab);
    await cdp.send("Accessibility.enable");
    const page = (await evaluateInPage(tab, PREVIEW_AUTOMATION_PAGE_SNAPSHOT_EXPRESSION, {
      returnByValue: true,
      awaitPromise: true,
    })) as Pick<
      PreviewAutomationSnapshot,
      "url" | "title" | "loading" | "visibleText" | "interactiveElements"
    >;
    const accessibilityTree = await cdp.send("Accessibility.getFullAXTree");
    const screenshot = await captureScreenshot(tab);
    return {
      ...page,
      accessibilityTree,
      consoleEntries: [...tab.consoleEntries],
      networkEntries: [...tab.networkEntries],
      actionTimeline: [...tab.actionTimeline],
      screenshot,
    };
  };

  const click = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationClickInput,
  ): Promise<void> => {
    const locator = automationLocator(input);
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
      await tab.page.mouse.click(x, y);
      return;
    }
    await tab.page
      .locator(locator)
      .click({ timeout: locatorTimeoutMs(request, input.timeoutMs) })
      .catch((cause: unknown) => {
        throw locatorFailure(cause, input);
      });
  };

  const typeText = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationTypeInput,
  ): Promise<void> => {
    const locator = automationLocator(input);
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
      target = tab.page.locator(locator);
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

  const scroll = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationScrollInput,
  ): Promise<void> => {
    const delta = { left: input.deltaX ?? 0, top: input.deltaY ?? 0 };
    const locator = automationLocator(input);
    if (locator === null) {
      await tab.page.evaluate(`scrollBy(${JSON.stringify({ ...delta, behavior: "instant" })})`);
      return;
    }
    await tab.page
      .locator(locator)
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
      returnByValue: input.returnByValue ?? true,
      awaitPromise: input.awaitPromise ?? true,
    });
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
    if (bytes > PREVIEW_AUTOMATION_MAX_EVALUATION_BYTES) {
      throw hostError(
        "PreviewAutomationResultTooLargeError",
        `The evaluation result is ${bytes} bytes; the limit is ${PREVIEW_AUTOMATION_MAX_EVALUATION_BYTES}.`,
        { maximumBytes: PREVIEW_AUTOMATION_MAX_EVALUATION_BYTES },
      );
    }
    return value;
  };

  const waitFor = async (
    tab: ChromeTab,
    request: PreviewAutomationRequest,
    input: PreviewAutomationWaitForInput,
  ): Promise<void> => {
    const locator = automationLocator(input);
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
          : (await tab.page
              .locator(locator)
              .count()
              .catch((cause: unknown) => {
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
      case "navigate": {
        const tab = requireTab(request);
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
        return resize(requireTab(request), request.input as PreviewAutomationResizeInput);
      case "setColorScheme": {
        const tab = requireTab(request);
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
        const tab = requireTab(request);
        return withAction(tab, "snapshot", () => snapshot(tab));
      }
      case "click": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationClickInput;
        return withAction(tab, "click", () => click(tab, request, input));
      }
      case "type": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationTypeInput;
        return withAction(tab, "type", () => typeText(tab, request, input));
      }
      case "press": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationPressInput;
        return withAction(tab, "press", () =>
          tab.page.keyboard.press([...(input.modifiers ?? []), input.key].join("+")),
        );
      }
      case "scroll": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationScrollInput;
        return withAction(tab, "scroll", () => scroll(tab, request, input));
      }
      case "evaluate": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationEvaluateInput;
        return withAction(tab, "evaluate", () => evaluate(tab, input));
      }
      case "waitFor": {
        const tab = requireTab(request);
        const input = request.input as PreviewAutomationWaitForInput;
        return withAction(tab, "waitFor", () => waitFor(tab, request, input));
      }
      case "recordingStart":
      case "recordingStop":
        throw hostError(
          "PreviewAutomationUnsupportedClientError",
          "Browser recording is not supported by the Chrome host. Record in the desktop app's built-in browser instead.",
        );
    }
  };

  return { supportedOperations: PREVIEW_AUTOMATION_OPERATIONS, execute };
}

/** Adapts a Chrome host to the server's preview automation host contract. */
export const toPreviewAutomationHost = (
  host: ChromePreviewHost,
  isPreferred: () => Promise<boolean>,
): ExperimentalPreviewAutomationHost => ({
  supportedOperations: host.supportedOperations,
  preferred: Effect.promise(isPreferred),
  execute: (request) =>
    Effect.tryPromise({
      try: () => host.execute(request),
      catch: toPreviewAutomationRemoteError,
    }),
});

/** Builds the product's server-side preview host on the managed Chrome profile. */
export const makeChromePreviewAutomationHost = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const browser = getBrowserAutomationService(serverConfig);
  return toPreviewAutomationHost(createChromePreviewHost({ getContext: browser.context }), () =>
    readBrowserUseSettings(serverConfig.settingsPath).then((settings) => settings.alwaysUseChrome),
  );
});
