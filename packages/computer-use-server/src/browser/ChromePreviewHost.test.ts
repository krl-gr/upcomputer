// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING,
  PreviewTabId,
  PreviewAutomationSnapshot,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { chromium, type Browser, type BrowserContext, type CDPSession } from "playwright-core";
import { afterAll, beforeAll, onTestFinished, test, type TestContext } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import * as PreviewAutomationBroker from "../../../../apps/server/src/mcp/PreviewAutomationBroker.ts";
import { computerUseSettingsPath } from "../settings/ComputerUseSettingsFile.ts";
import { createBrowserAutomationService } from "./BrowserAutomationService.ts";
import {
  browserUseSettingsSection,
  DEFAULT_BROWSER_FOR_AGENTS,
  readBrowserUseSettings,
} from "./BrowserUseSettings.ts";
import type { BrowserForAgents } from "@t3tools/computer-use-contracts/rpc";
import {
  CHROME_TAB_IDLE_MS,
  chromeForAgents,
  chromePreference,
  chromeTabCleanup,
  createChromePreviewHost,
  serveChromePreviewHost,
  toPreviewAutomationRemoteError,
  type PreviewAutomationRemoteError,
} from "./ChromePreviewHost.ts";

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

const PARITY_PAGE = `<!doctype html>
<html>
  <head><title>Parity fixture</title></head>
  <body>
    <button id="alert" onclick="document.querySelector('#answer').textContent = String(confirm('Proceed?'))">Ask</button>
    <p id="answer">none</p>
    <div id="hover" onmouseenter="this.textContent = 'hovered'" style="width: 100px; height: 30px">hover me</div>
    <select id="size"><option value="s">Small</option><option value="l">Large</option></select>
    <div id="source" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'dragged')" style="width: 60px; height: 30px">drag</div>
    <div id="target" ondragover="event.preventDefault()" ondrop="this.textContent = event.dataTransfer.getData('text/plain')" style="width: 120px; height: 40px">drop here</div>
    <input id="file" type="file" onchange="document.querySelector('#files').textContent = Array.from(this.files, (file) => file.name).join(',')" />
    <button id="picker" onclick="document.querySelector('#file').click()">Choose</button>
    <p id="files"></p>
    <a id="download" href="/report.txt">Download</a>
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
    } else if (request.url === "/parity") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PARITY_PAGE);
    } else if (request.url === "/report.txt") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="report.txt"',
      });
      response.end("report body");
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
  // The key goes to its target, not to the field that still has focus.
  await host.execute(request("press", { selector: "#fixed", key: "Backspace" }));
  NodeAssert.equal(await evaluate("document.activeElement.id"), "fixed");
  NodeAssert.equal(await evaluate("document.querySelector('#message').value"), "replaced!");
  const pressMissing = await failure(
    host.execute(request("press", { selector: "#nowhere", key: "Enter" }, { timeoutMs: 2_000 })),
  );
  NodeAssert.equal(pressMissing._tag, "PreviewAutomationTargetNotFoundError");
  NodeAssert.deepEqual(
    await failure(host.execute(request("press", { selector: "#status", key: "Enter" }))),
    {
      _tag: "PreviewAutomationExecutionError",
      message: "The press target cannot take focus, so no key was pressed.",
    },
  );

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

  const newTabRequest = { tabId: newTab.tabId as PreviewAutomationRequest["tabId"] };
  const foreignClose = await failure(
    host.execute(
      request(
        "close",
        {},
        {
          ...newTabRequest,
          threadId: "thread-2" as PreviewAutomationRequest["threadId"],
        },
      ),
    ),
  );
  NodeAssert.equal(foreignClose._tag, "PreviewAutomationControlInterruptedError");
  NodeAssert.equal(foreignClose.detail, "agentMismatch");
  NodeAssert.equal(context.pages().length, 2);
  const isLive = () => host.liveTabs().some((tab) => tab.tabId === newTab.tabId);
  NodeAssert.ok(isLive());
  NodeAssert.deepEqual(await host.execute(request("close", {}, newTabRequest)), {});
  NodeAssert.equal(context.pages().length, 1);
  NodeAssert.ok(!isLive());
  NodeAssert.equal(
    (await failure(host.execute(request("close", {}, newTabRequest))))._tag,
    "PreviewAutomationTabNotFoundError",
  );
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

  NodeAssert.equal(snapshot.url, `http://localhost:${port}/`);
  NodeAssert.equal(snapshot.title, "Chrome host fixture");
  NodeAssert.match(snapshot.visibleText, /Sent:/u);
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
  // The full network log, not only failures.
  NodeAssert.ok(
    snapshot.networkEntries.some(
      (entry) => entry.url === `http://localhost:${port}/` && entry.status === 200,
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
  // The built-in browser's AI-mode tree: its refs work as locators in the next actions.
  const tree = snapshot.accessibilityTree as string;
  const ref = /button "Send" (?:\[active\] )?\[ref=(\S+?)\]/u.exec(tree)?.[1];
  NodeAssert.ok(ref, tree);
  await host.execute(request("type", { selector: "#message", text: "by ref", clear: true }));
  await host.execute(request("click", { locator: `aria-ref=${ref}` }));
  NodeAssert.equal(
    await host.execute(
      request("evaluate", { expression: "document.querySelector('#status').textContent" }),
    ),
    "Sent: by ref",
  );
  await host.execute(request("navigate", { url: `http://localhost:${port}/second` }));
  const stale = await failure(host.execute(request("click", { locator: `aria-ref=${ref}` })));
  NodeAssert.equal(stale._tag, "PreviewAutomationInvalidSelectorError");
  NodeAssert.deepEqual(stale.detail, { staleRef: true });
  const png = Buffer.from(snapshot.screenshot!.data, "base64");
  NodeAssert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  NodeAssert.deepEqual(
    { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    { width: snapshot.screenshot!.width, height: snapshot.screenshot!.height },
  );
});

test("dialogs, hover, select, drag, uploads and downloads work like the built-in browser", async (t) => {
  const context = await openContext(t, { acceptDownloads: true });
  if (!context) return;
  const downloadsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "chrome-downloads-"));
  onTestFinished(() => NodeFS.rmSync(downloadsDir, { recursive: true, force: true }));
  const host = createChromePreviewHost({ getContext: async () => context, downloadsDir });
  const evaluate = (expression: string) => host.execute(request("evaluate", { expression }));
  const text = (selector: string) => evaluate(`document.querySelector('${selector}').textContent`);
  await host.execute(request("open", { url: `localhost:${port}/parity` }));

  // The click returns while the dialog waits; the agent reads and answers it.
  await host.execute(request("click", { selector: "#alert" }));
  const pending = (await host.execute(request("status"))) as PreviewAutomationStatus;
  NodeAssert.deepEqual(pending.dialog, { type: "confirm", message: "Proceed?", defaultValue: "" });
  const blocked = await failure(host.execute(request("snapshot")));
  NodeAssert.equal(blocked._tag, "PreviewAutomationControlInterruptedError");
  NodeAssert.equal(blocked.detail, "dialogPending");
  const answered = (await host.execute(
    request("dialog", { accept: true }),
  )) as PreviewAutomationStatus;
  NodeAssert.equal(answered.dialog, null);
  NodeAssert.equal(await text("#answer"), "true");

  await host.execute(request("hover", { selector: "#hover" }));
  NodeAssert.equal(await text("#hover"), "hovered");
  NodeAssert.deepEqual(
    await host.execute(request("select", { selector: "#size", values: ["Large"] })),
    { selected: ["l"] },
  );
  await host.execute(request("drag", { source: "#source", target: "#target" }));
  NodeAssert.equal(await text("#target"), "dragged");

  const upload = NodePath.join(downloadsDir, "upload.txt");
  NodeFS.writeFileSync(upload, "upload body");
  await host.execute(request("upload", { selector: "#file", paths: [upload] }));
  NodeAssert.equal(await text("#files"), "upload.txt");
  // A picker the page opens is intercepted and answered with upload.
  await host.execute(request("click", { selector: "#picker" }));
  const picking = (await host.execute(request("status"))) as PreviewAutomationStatus;
  NodeAssert.deepEqual(picking.fileChooser, { multiple: false, accept: "" });
  await host.execute(request("upload", { paths: [upload] }));
  NodeAssert.equal(
    ((await host.execute(request("status"))) as PreviewAutomationStatus).fileChooser,
    null,
  );
  NodeAssert.equal(
    (await failure(host.execute(request("upload", { paths: ["relative.txt"] })))).message,
    "Upload paths must be absolute: relative.txt",
  );

  await host.execute(request("navigate", { url: `http://localhost:${port}/report.txt` }));
  const downloaded = (await host.execute(request("status"))) as PreviewAutomationStatus;
  const [download] = downloaded.downloads ?? [];
  NodeAssert.ok(download, "the download is listed");
  NodeAssert.equal(download.fileName, "report.txt");
  NodeAssert.equal(download.url, `http://localhost:${port}/report.txt`);
  NodeAssert.ok(download.path.startsWith(NodePath.join(downloadsDir, downloaded.tabId ?? "")));
  NodeAssert.equal(NodeFS.readFileSync(download.path, "utf8"), "report body");
});

test("Chrome tabs have the built-in browser's limits, owners and idle cleanup", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  let clock = 0;
  let changes = 0;
  const host = createChromePreviewHost({ getContext: async () => context, now: () => clock });
  host.onTabsChanged(() => {
    changes += 1;
  });
  const opened: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const status = (await host.execute(
      request("open", { reuseExistingTab: false }),
    )) as PreviewAutomationStatus;
    opened.push(status.tabId ?? "");
  }
  const limited = await failure(host.execute(request("open", { reuseExistingTab: false })));
  NodeAssert.equal(limited._tag, "PreviewAutomationControlInterruptedError");
  NodeAssert.equal(limited.detail, "tabLimit");
  NodeAssert.match(limited.message, /8 per agent, 32 in all/u);
  const listed = (await host.execute(request("status"))) as PreviewAutomationStatus;
  NodeAssert.deepEqual(
    listed.tabs?.map((tab) => tab.tabId),
    opened,
  );

  // Another agent can neither act on nor read a tab it did not open.
  const foreign = await failure(
    host.execute(
      request(
        "snapshot",
        {},
        {
          threadId: "thread-2" as PreviewAutomationRequest["threadId"],
          tabId: opened[0] as PreviewAutomationRequest["tabId"],
        },
      ),
    ),
  );
  NodeAssert.equal(foreign.detail, "agentMismatch");

  // Only tabs nobody used for half an hour close.
  clock = CHROME_TAB_IDLE_MS - 1;
  await host.execute(
    request("status", {}, { tabId: opened[1] as PreviewAutomationRequest["tabId"] }),
  );
  clock = CHROME_TAB_IDLE_MS;
  await host.closeIdleTabs();
  NodeAssert.deepEqual(
    host.liveTabs().map((tab) => tab.tabId),
    [opened[1]],
  );
  NodeAssert.ok(changes > 0);

  await host.closeThreadTabs("thread-1" as PreviewAutomationRequest["threadId"]);
  NodeAssert.deepEqual(host.liveTabs(), []);
  NodeAssert.equal(context.pages().length, 0);
});

test("a deleted thread's Chrome tabs close, and a worker's when its work ends", async () => {
  const closed: string[] = [];
  const workLeft = new Set<string>();
  const cleanup = chromeTabCleanup({
    host: {
      liveTabs: () =>
        ["chat", "worker"].map((thread) => ({
          threadId: ThreadId.make(thread),
          tabId: PreviewTabId.make(`chrome-${thread}`),
        })),
      closeThreadTabs: async (threadId) => {
        closed.push(threadId);
      },
    },
    isWorker: async (threadId) => threadId === "worker",
    hasWorkLeft: async (threadId) => workLeft.has(threadId),
  });
  const event = (type: string, threadId: string, status?: string) =>
    ({ type, threadId, payload: { status } }) as unknown as OrchestrationV2DomainEvent;
  // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- A plain Effect.promise.
  const handle = (next: OrchestrationV2DomainEvent) => Effect.runPromise(cleanup(next));

  await handle(event("run.updated", "worker", "running"));
  await handle(event("run.updated", "chat", "completed"));
  await handle(event("run.updated", "other", "completed"));
  // A person may continue an interrupted worker; the idle sweep covers it.
  await handle(event("run.updated", "worker", "interrupted"));
  // A queued follow-up or a running delegated task belongs to the same worker run.
  workLeft.add("worker");
  await handle(event("run.updated", "worker", "completed"));
  NodeAssert.deepEqual(closed, []);
  workLeft.delete("worker");
  await handle(event("run.updated", "worker", "completed"));
  await handle(event("thread.deleted", "chat"));
  NodeAssert.deepEqual(closed, ["worker", "chat"]);
});

test("only an explicit open raises the Chrome window", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  let raised = 0;
  const newPage = context.newPage.bind(context);
  context.newPage = async () => {
    const page = await newPage();
    const bringToFront = page.bringToFront.bind(page);
    page.bringToFront = async () => {
      raised += 1;
      await bringToFront();
    };
    return page;
  };
  const host = createChromePreviewHost({ getContext: async () => context });
  await host.execute(request("open", { url: `localhost:${port}` }));
  await host.execute(request("open", { url: `localhost:${port}`, open: false, show: false }));
  // A background tab still answers a snapshot with pixels, without being raised.
  await host.execute(request("open", { reuseExistingTab: false }));
  await host.execute(request("snapshot"));
  NodeAssert.equal(raised, 0);
  await host.execute(request("open", { open: true, show: true }));
  NodeAssert.equal(raised, 1);
});

test("snapshot screenshots are scaled to the desktop host's maximum width", async (t) => {
  for (const [options, expected] of [
    [{ viewport: { width: 1000, height: 500 } }, { width: 1000, height: 500 }],
    [{ viewport: { width: 1600, height: 900 } }, { width: 1280, height: 720 }],
  ] as const) {
    const context = await openContext(t, options);
    if (!context) return;
    const host = createChromePreviewHost({ getContext: async () => context });
    await host.execute(request("open", { url: `localhost:${port}` }));
    await host.execute(request("scroll", { deltaY: 1200 }));
    const snapshot = (await host.execute(request("snapshot"))) as PreviewAutomationSnapshot;
    NodeAssert.deepEqual(
      { width: snapshot.screenshot!.width, height: snapshot.screenshot!.height },
      expected,
    );
  }
});

test("a snapshot whose screenshot fails still returns the page text and tree", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  const newCDPSession = context.newCDPSession.bind(context);
  context.newCDPSession = async (page) => {
    const session = await newCDPSession(page);
    const send = session.send.bind(session);
    // What Chromium answers when the display is asleep and nothing composites.
    session.send = ((method: string, params?: object) =>
      method === "Page.captureScreenshot"
        ? Promise.reject(new Error("Protocol error: Unable to capture screenshot"))
        : send(method as never, params as never)) as CDPSession["send"];
    return session;
  };
  const host = createChromePreviewHost({ getContext: async () => context });
  await host.execute(request("open", { url: `localhost:${port}` }));
  const snapshot = (await host.execute(request("snapshot"))) as PreviewAutomationSnapshot;
  NodeAssert.equal(snapshot.title, "Chrome host fixture");
  NodeAssert.match(snapshot.accessibilityTree as string, /textbox "Message"/u);
  NodeAssert.equal(snapshot.screenshot, null);
  NodeAssert.equal(snapshot.warning, PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING);
});

test("Chrome claims a thread's new tabs while it starts, and its own tabs' calls", async () => {
  let wantsChrome = true;
  let available = true;
  let liveTabs: Array<{ threadId: ThreadId; tabId: PreviewTabId }> = [];
  const preferred = chromePreference({
    host: { liveTabs: () => liveTabs },
    wantsChrome: async () => wantsChrome,
    ensureAvailable: async () => available,
  });
  const scope = {
    environmentId: EnvironmentId.make("environment-1"),
    requestNamespace: "session-1",
    thread: {
      threadId: ThreadId.make("thread-1"),
      providerSessionId: "session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    capabilities: new Set(["preview"] as const),
    issuedAt: 0,
  };
  const claims = (operation: PreviewAutomationOperation) =>
    // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- A plain Effect.promise.
    Effect.runPromise(preferred({ scope, operation }));

  NodeAssert.equal(await claims("open"), true);
  // A thread working in the built-in browser keeps it until it opens a tab.
  NodeAssert.equal(await claims("snapshot"), false);
  liveTabs = [{ threadId: scope.thread.threadId, tabId: PreviewTabId.make("chrome-1") }];
  NodeAssert.equal(await claims("snapshot"), true);
  available = false;
  NodeAssert.equal(await claims("open"), false);
  wantsChrome = false;
  NodeAssert.equal(await claims("snapshot"), false);
});

test("Browser for agents is read from its own file, then from a V1 settings.json, and keeps an old Always use Chrome", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "browser-use-settings-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const settingsPath = NodePath.join(directory, "settings.json");
  const read = async () => (await readBrowserUseSettings(settingsPath)).browserForAgents;

  NodeAssert.equal(await read(), DEFAULT_BROWSER_FOR_AGENTS);
  NodeFS.writeFileSync(settingsPath, JSON.stringify({ browser: { alwaysUseChrome: true } }));
  NodeAssert.equal(await read(), "chrome");
  const own = computerUseSettingsPath(settingsPath);
  NodeFS.writeFileSync(own, JSON.stringify({ browser: { alwaysUseChrome: false } }));
  NodeAssert.equal(await read(), "builtin");
  NodeFS.writeFileSync(own, JSON.stringify({ browser: browserUseSettingsSection("automatic") }));
  NodeAssert.equal(await read(), "automatic");
  NodeFS.writeFileSync(own, "{ not json");
  NodeAssert.equal(await read(), DEFAULT_BROWSER_FOR_AGENTS);
});

test("Automatic gives workers and delegated runs Chrome, and chats the built-in browser", async () => {
  let choice: BrowserForAgents = "automatic";
  const wantsChrome = chromeForAgents({
    browserForAgents: async () => choice,
    isWorker: async (threadId) => threadId === "worker",
  });
  const scope = (threadId: string, subagent?: boolean) => ({
    environmentId: EnvironmentId.make("environment-1"),
    requestNamespace: "session-1",
    thread: {
      threadId: ThreadId.make(threadId),
      providerSessionId: "session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
      ...(subagent === undefined ? {} : { subagent }),
    },
    client: undefined,
    capabilities: new Set(["preview"] as const),
    issuedAt: 0,
  });
  NodeAssert.equal(await wantsChrome(scope("worker")), true);
  NodeAssert.equal(await wantsChrome(scope("delegated", true)), true);
  NodeAssert.equal(await wantsChrome(scope("chat")), false);
  choice = "chrome";
  NodeAssert.equal(await wantsChrome(scope("chat")), true);
  choice = "builtin";
  NodeAssert.equal(await wantsChrome(scope("worker")), false);
});

test("agents reach Chrome through the preview broker unless a desktop app serves them", async (t) => {
  const context = await openContext(t);
  if (!context) return;
  let alwaysUseChrome = false;
  const environmentId = EnvironmentId.make("environment-1");
  const scope = {
    environmentId,
    requestNamespace: "codex-session-1",
    thread: {
      threadId: ThreadId.make("thread-1"),
      providerSessionId: "codex-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    capabilities: new Set(["preview"] as const),
    issuedAt: 0,
  };
  const laterSession = {
    ...scope,
    requestNamespace: "codex-session-2",
    thread: { ...scope.thread, providerSessionId: "codex-session-2" },
  };

  // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- The Chrome host is Promise-based.
  await Effect.runPromise(
    Effect.gen(function* () {
      const broker = yield* PreviewAutomationBroker.make;
      yield* serveChromePreviewHost({
        host: createChromePreviewHost({ getContext: async () => context }),
        environmentId,
        preferred: () => Effect.sync(() => alwaysUseChrome),
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

      // "Always Chrome" moves every call to Chrome.
      alwaysUseChrome = true;
      const preferred = yield* broker.invoke<PreviewAutomationStatus>({
        scope: laterSession,
        operation: "status",
        input: {},
      });
      NodeAssert.equal(preferred.available, true);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
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
