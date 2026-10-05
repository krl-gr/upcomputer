// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PreviewAutomationSnapshot,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { afterAll, beforeAll, onTestFinished, test, type TestContext } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import * as PreviewAutomationBroker from "../../../../apps/server/src/mcp/PreviewAutomationBroker.ts";
import { computerUseSettingsPath } from "../settings/ComputerUseSettingsFile.ts";
import { createBrowserAutomationService } from "./BrowserAutomationService.ts";
import { readBrowserUseSettings } from "./BrowserUseSettings.ts";
import {
  createChromePreviewHost,
  serveChromePreviewHost,
  toPreviewAutomationRemoteError,
  type PreviewAutomationRemoteError,
} from "./ChromePreviewHost.ts";
import { PREVIEW_AUTOMATION_PAGE_SNAPSHOT_EXPRESSION } from "./previewAutomationPage.ts";

const decodeSnapshot = Schema.decodeUnknownSync(PreviewAutomationSnapshot);

const FIXTURE_PAGE = `<!doctype html>
<html>
  <head><title>Chrome host fixture</title></head>
  <body style="margin: 0">
    <h1>Fixture</h1>
    <input id="message" aria-label="Message" />
    <input id="fixed" aria-label="Fixed" value="fixed" readonly />
    <button id="send" onclick="document.querySelector('#status').textContent = 'Sent: ' + document.querySelector('#message').value">Send</button>
    <button>Twin</button>
    <button>Twin</button>
    <a href="/second">Second page</a>
    <p id="status">Idle</p>
    <div id="scroller" style="height: 100px; overflow: auto"><div style="height: 1000px">Tall</div></div>
    <div style="height: 3000px"></div>
    <script>
      console.warn("fixture warning");
      fetch("/missing");
    </script>
  </body>
</html>`;

let server: NodeHttp.Server;
let port = 0;
let browser: Browser | undefined;

beforeAll(async () => {
  server = NodeHttp.createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(FIXTURE_PAGE);
    } else if (request.url === "/second") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Second</title><p>Second page</p>");
    } else {
      response.writeHead(404);
      response.end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  port = (server.address() as NodeNet.AddressInfo).port;
  // Prefer the installed Chrome; fall back to Playwright's Chromium.
  for (const channel of ["chrome", undefined]) {
    try {
      browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
      break;
    } catch {
      // Try the next browser.
    }
  }
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let requestSequence = 0;
const request = (
  operation: PreviewAutomationOperation,
  input: unknown = {},
  overrides: Partial<Pick<PreviewAutomationRequest, "tabId" | "threadId" | "timeoutMs">> = {},
) =>
  ({
    requestId: `request-${(requestSequence += 1)}`,
    threadId: "thread-1",
    operation,
    input,
    timeoutMs: 15_000,
    ...overrides,
  }) as PreviewAutomationRequest;

async function failure(promise: Promise<unknown>): Promise<PreviewAutomationRemoteError> {
  try {
    await promise;
  } catch (cause) {
    return toPreviewAutomationRemoteError(cause);
  }
  return NodeAssert.fail("Expected the Chrome host to fail.");
}

async function openContext(
  t: TestContext,
  options?: Parameters<Browser["newContext"]>[0],
): Promise<BrowserContext | undefined> {
  if (!browser) {
    t.skip("Neither Google Chrome nor Playwright's Chromium is installed.");
    return undefined;
  }
  const context = await browser.newContext(options);
  onTestFinished(() => context.close());
  return context;
}

test("runs every preview operation in Chrome against a local page", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  const host = createChromePreviewHost({ getContext: async () => context });
  const evaluate = (expression: string) => host.execute(request("evaluate", { expression }));

  NodeAssert.deepEqual(await host.execute(request("status")), {
    available: true,
    visible: false,
    tabId: null,
    url: null,
    title: null,
    loading: false,
  });
  NodeAssert.equal(
    (await failure(host.execute(request("snapshot"))))._tag,
    "PreviewAutomationTabNotFoundError",
  );

  // Bare local hosts resolve like the built-in browser: no allowlist, http for loopback.
  const opened = (await host.execute(
    request("open", { url: `0.0.0.0:${port}`, show: true, reuseExistingTab: true }),
  )) as PreviewAutomationStatus;
  NodeAssert.match(opened.tabId ?? "", /^chrome-/u);
  NodeAssert.equal(opened.url, `http://localhost:${port}/`);
  NodeAssert.equal(opened.title, "Chrome host fixture");
  NodeAssert.equal(opened.loading, false);
  NodeAssert.deepEqual(opened.viewportSetting, { _tag: "fill" });
  NodeAssert.ok((opened.viewport?.width ?? 0) > 0);

  const second = (await host.execute(
    request("navigate", { target: { kind: "environment-port", port, path: "/second" } }),
  )) as PreviewAutomationStatus;
  NodeAssert.equal(second.url, `http://localhost:${port}/second`);
  NodeAssert.equal(second.title, "Second");
  await host.execute(request("navigate", { url: `http://localhost:${port}/` }));

  await host.execute(request("type", { locator: "role=textbox[name='Message']", text: "hel" }));
  await host.execute(request("type", { selector: "#message", text: "lo" }));
  await host.execute(request("click", { locator: "role=button[name='Send']" }));
  NodeAssert.equal(await evaluate("document.querySelector('#status').textContent"), "Sent: hello");
  await host.execute(request("waitFor", { text: "Sent: hello", urlIncludes: "localhost" }));

  await host.execute(request("type", { selector: "#message", text: "replaced", clear: true }));
  NodeAssert.equal(await evaluate("document.querySelector('#message').value"), "replaced");
  await host.execute(request("press", { key: "!" }));
  NodeAssert.equal(await evaluate("document.querySelector('#message').value"), "replaced!");

  NodeAssert.deepEqual(
    await failure(host.execute(request("type", { selector: "#fixed", text: "x" }))),
    {
      _tag: "PreviewAutomationTargetNotEditableError",
      message: "The type target is not an editable text field.",
      detail: { selectorKind: "selector", selectorLength: 6 },
    },
  );
  const missing = await failure(
    host.execute(request("click", { locator: "text=Nowhere" }, { timeoutMs: 2_000 })),
  );
  NodeAssert.equal(missing._tag, "PreviewAutomationTargetNotFoundError");
  NodeAssert.deepEqual(missing.detail, { selectorKind: "locator", selectorLength: 12 });
  NodeAssert.equal(
    (await failure(host.execute(request("click", { locator: "text=Twin" }))))._tag,
    "PreviewAutomationInvalidSelectorError",
  );
  NodeAssert.equal(
    (await failure(host.execute(request("click", { locator: "role=[" }))))._tag,
    "PreviewAutomationInvalidSelectorError",
  );

  await host.execute(request("scroll", { deltaY: 400 }));
  NodeAssert.equal(await evaluate("scrollY"), 400);
  await host.execute(request("scroll", { selector: "#scroller", deltaY: 50 }));
  NodeAssert.equal(await evaluate("document.querySelector('#scroller').scrollTop"), 50);
  await host.execute(request("click", { x: 5, y: 5 }));
  NodeAssert.equal(
    (await failure(host.execute(request("click", { x: 50_000, y: 5 }))))._tag,
    "PreviewAutomationExecutionError",
  );

  NodeAssert.deepEqual(await evaluate("({ answer: 6 * 7, when: Promise.resolve(1) })"), {
    answer: 42,
    when: {},
  });
  NodeAssert.equal(await evaluate("Promise.resolve('awaited')"), "awaited");
  NodeAssert.match(
    (await failure(evaluate("missingFunction()"))).message,
    /JavaScript evaluation failed: ReferenceError: missingFunction is not defined/u,
  );
  NodeAssert.deepEqual(await failure(evaluate("'x'.repeat(70000)")), {
    _tag: "PreviewAutomationResultTooLargeError",
    message: "The evaluation result is 70002 bytes; the limit is 64000.",
    detail: { maximumBytes: 64_000 },
  });
  NodeAssert.equal(
    (await failure(host.execute(request("waitFor", { text: "Never shown" }, { timeoutMs: 1_600 }))))
      ._tag,
    "PreviewAutomationTimeoutError",
  );

  const resized = await host.execute(
    request("resize", { mode: "freeform", width: 800, height: 600 }),
  );
  NodeAssert.deepEqual(resized, {
    tabId: opened.tabId,
    setting: { _tag: "freeform", width: 800, height: 600 },
    viewport: { width: 800, height: 600 },
  });
  const phone = (await host.execute(
    request("resize", { mode: "preset", preset: "iphone-12-pro", orientation: "landscape" }),
  )) as { readonly viewport: { readonly width: number; readonly height: number } };
  NodeAssert.ok(phone.viewport.width > phone.viewport.height);
  await host.execute(request("resize", { mode: "fill" }));

  await host.execute(request("setColorScheme", { colorScheme: "dark" }));
  NodeAssert.equal(await evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), true);
  await host.execute(request("setColorScheme", { colorScheme: "light" }));
  NodeAssert.equal(await evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), false);

  const recording = await failure(host.execute(request("recordingStart")));
  NodeAssert.equal(recording._tag, "PreviewAutomationUnsupportedClientError");
  NodeAssert.match(recording.message, /not supported by the Chrome host/u);

  const newTab = (await host.execute(
    request("open", { reuseExistingTab: false, show: false }),
  )) as PreviewAutomationStatus;
  NodeAssert.notEqual(newTab.tabId, opened.tabId);
  NodeAssert.equal(newTab.url, "about:blank");
  const firstTab = (await host.execute(
    request("status", {}, { tabId: opened.tabId as PreviewAutomationRequest["tabId"] }),
  )) as PreviewAutomationStatus;
  NodeAssert.equal(firstTab.url, `http://localhost:${port}/`);
  NodeAssert.equal(
    (
      await failure(
        host.execute(
          request("snapshot", {}, { threadId: "thread-2" as PreviewAutomationRequest["threadId"] }),
        ),
      )
    )._tag,
    "PreviewAutomationTabNotFoundError",
  );
});

test("snapshots follow the desktop host's contract", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  const host = createChromePreviewHost({ getContext: async () => context });
  await host.execute(request("open", { url: `localhost:${port}` }));
  await host.execute(request("waitFor", { locator: "#status" }));
  await host.execute(request("click", { locator: "role=button[name='Send']" }));

  const snapshot = decodeSnapshot(await host.execute(request("snapshot")));

  // The page fields come from the same expression the desktop host evaluates.
  const page = context.pages()[0];
  NodeAssert.ok(page);
  NodeAssert.deepEqual(
    {
      url: snapshot.url,
      title: snapshot.title,
      loading: snapshot.loading,
      visibleText: snapshot.visibleText,
      interactiveElements: snapshot.interactiveElements,
    },
    await page.evaluate(PREVIEW_AUTOMATION_PAGE_SNAPSHOT_EXPRESSION),
  );
  NodeAssert.equal(snapshot.title, "Chrome host fixture");
  NodeAssert.match(snapshot.visibleText, /Sent:/u);
  NodeAssert.ok(
    snapshot.interactiveElements.some(
      (element) =>
        element.tag === "button" && element.selector === "#send" && element.name === "Send",
    ),
  );
  NodeAssert.ok(
    snapshot.consoleEntries.some(
      (entry) => entry.level === "warning" && entry.text === "fixture warning",
    ),
  );
  NodeAssert.ok(
    snapshot.networkEntries.some(
      (entry) => entry.url.endsWith("/missing") && entry.status === 404 && entry.failed,
    ),
  );
  NodeAssert.deepEqual(
    snapshot.actionTimeline.map(({ action, status }) => [action, status]),
    [
      ["waitFor", "succeeded"],
      ["click", "succeeded"],
      ["snapshot", "running"],
    ],
  );
  NodeAssert.ok(Array.isArray((snapshot.accessibilityTree as { nodes?: unknown }).nodes));
  const png = Buffer.from(snapshot.screenshot.data, "base64");
  NodeAssert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  NodeAssert.deepEqual(
    { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    { width: snapshot.screenshot.width, height: snapshot.screenshot.height },
  );
});

test("snapshot screenshots are scaled to the desktop host's maximum width", async (t) => {
  for (const [options, expected] of [
    [{ viewport: { width: 1000, height: 500 } }, { width: 1000, height: 500 }],
    [{ viewport: { width: 1600, height: 900 } }, { width: 1280, height: 720 }],
    [
      { viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 },
      { width: 1280, height: 960 },
    ],
  ] as const) {
    const context = await openContext(t, options);
    if (!context) return;
    const host = createChromePreviewHost({ getContext: async () => context });
    await host.execute(request("open", { url: `localhost:${port}` }));
    await host.execute(request("scroll", { deltaY: 1200 }));
    const snapshot = (await host.execute(request("snapshot"))) as PreviewAutomationSnapshot;
    NodeAssert.deepEqual(
      { width: snapshot.screenshot.width, height: snapshot.screenshot.height },
      expected,
    );
  }
});

test("the Always use Chrome preference is read from its own file, then from a V1 settings.json", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "browser-use-settings-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const settingsPath = NodePath.join(directory, "settings.json");

  NodeAssert.deepEqual(await readBrowserUseSettings(settingsPath), { alwaysUseChrome: false });
  NodeFS.writeFileSync(settingsPath, JSON.stringify({ browser: { alwaysUseChrome: true } }));
  NodeAssert.deepEqual(await readBrowserUseSettings(settingsPath), { alwaysUseChrome: true });
  NodeFS.writeFileSync(computerUseSettingsPath(settingsPath), "{ not json");
  NodeAssert.deepEqual(await readBrowserUseSettings(settingsPath), { alwaysUseChrome: false });
});

test("agents reach Chrome through the preview broker unless a desktop app serves them", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  let alwaysUseChrome = false;
  const environmentId = EnvironmentId.make("environment-1");
  const scope = {
    environmentId,
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "codex-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["preview"] as const),
    issuedAt: 0,
  };
  const laterSession = { ...scope, providerSessionId: "codex-session-2" };

  // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- The Chrome host is Promise-based.
  await Effect.runPromise(
    Effect.gen(function* () {
      const broker = yield* PreviewAutomationBroker.make;
      yield* serveChromePreviewHost({
        host: createChromePreviewHost({ getContext: async () => context }),
        environmentId,
        preferred: Effect.sync(() => alwaysUseChrome),
      }).pipe(
        Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      const opened = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        operation: "open",
        input: { url: `localhost:${port}`, show: true, reuseExistingTab: true },
      });
      NodeAssert.match(opened.tabId ?? "", /^chrome-/u);
      yield* broker.invoke({
        scope,
        operation: "type",
        input: { locator: "role=textbox[name='Message']", text: "from the agent" },
      });
      yield* broker.invoke({
        scope,
        operation: "click",
        input: { locator: "role=button[name='Send']" },
      });
      NodeAssert.equal(
        yield* broker.invoke<string>({
          scope,
          operation: "evaluate",
          input: { expression: "document.querySelector('#status').textContent" },
        }),
        "Sent: from the agent",
      );
      const snapshot = yield* broker.invoke<PreviewAutomationSnapshot>({
        scope,
        operation: "snapshot",
        input: {},
      });
      NodeAssert.match(snapshot.visibleText, /Sent: from the agent/u);

      // Chrome's failures reach the agent with the desktop host's error tags.
      const recording = yield* broker
        .invoke({ scope, operation: "recordingStart", input: {} })
        .pipe(Effect.flip);
      NodeAssert.equal(recording._tag, "PreviewAutomationUnsupportedClientError");

      // A connected desktop app serves new sessions; a session already in Chrome stays there.
      const desktop = yield* broker.connect({ clientId: "desktop-1", environmentId });
      yield* Stream.runForEach(desktop, (event) =>
        event.type === "request"
          ? broker.respond({
              clientId: "desktop-1",
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: true,
              result: "built-in browser",
            })
          : Effect.void,
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      NodeAssert.equal(
        yield* broker.invoke<unknown>({ scope: laterSession, operation: "status", input: {} }),
        "built-in browser",
      );
      const stayed = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        operation: "status",
        input: {},
      });
      NodeAssert.equal(stayed.tabId, opened.tabId);

      // "Always use Chrome" moves every call to Chrome.
      alwaysUseChrome = true;
      const preferred = yield* broker.invoke<PreviewAutomationStatus>({
        scope: laterSession,
        operation: "status",
        input: {},
      });
      NodeAssert.equal(preferred.available, true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

test("the Chrome host opens the managed profile browser once and reuses it", async (t) => {
  if (!browser) {
    t.skip("Neither Google Chrome nor Playwright's Chromium is installed.");
    return;
  }
  const sharedBrowser = browser;
  const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "chrome-preview-host-"));
  onTestFinished(() => NodeFS.rmSync(stateDir, { recursive: true, force: true }));
  const launchedUserDataDirs: string[] = [];
  const service = createBrowserAutomationService(
    { stateDir, settingsPath: NodePath.join(stateDir, "settings.json") } as ServerConfig["Service"],
    {
      probeCdpEndpoint: async () => ({ ok: false }),
      launchCdpBrowser: async ({ userDataDir }) => {
        launchedUserDataDirs.push(userDataDir);
        const context = await sharedBrowser.newContext();
        onTestFinished(() => context.close());
        return {
          browserProcess: {
            browserName: "chrome",
            executablePath: "/test/chrome",
            debuggingPort: 9_222,
            userDataDir,
            dispose: async () => undefined,
          },
          browser: sharedBrowser,
          context,
        };
      },
    },
  );
  const host = createChromePreviewHost({ getContext: service.context });

  await host.execute(request("open", { url: `localhost:${port}` }));
  await host.execute(request("open", { reuseExistingTab: false, show: false }));

  NodeAssert.deepEqual(launchedUserDataDirs, [
    NodePath.join(stateDir, "browser-profiles", "default"),
  ]);
  NodeAssert.equal((await service.snapshot()).status, "open");
});
