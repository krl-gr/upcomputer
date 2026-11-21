import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import * as ServerBrowserPage from "./ServerBrowserPage.ts";

const never = () => new Promise<never>(() => {});
const timedOut = () => Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" });

const failedSnapshot = async (options: {
  readonly evaluate?: () => Promise<unknown>;
  readonly ariaSnapshot?: () => Promise<string>;
  readonly advanceMs: number;
}) => {
  vi.useFakeTimers();
  try {
    const frame = {};
    const page = {
      viewportSize: () => ({ width: 1280, height: 800 }),
      mainFrame: () => frame,
      frames: () => [frame],
      on: () => {},
      evaluate:
        options.evaluate ??
        (async () => ({
          url: "about:blank",
          title: "",
          loading: false,
          visibleText: "",
          interactiveElements: [],
        })),
      ariaSnapshot: options.ariaSnapshot ?? (async () => ""),
    } as unknown as Page;
    const cdp = {
      send: async (method: string) => {
        if (method === "Page.captureScreenshot") return { data: "" };
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
        if (method === "Runtime.evaluate") return { result: { value: [] } };
        throw new Error(`Unexpected command: ${method}`);
      },
    } as unknown as CDPSession;
    const captured = ServerBrowserPage.snapshot({
      page,
      cdp,
      renderScale: 1,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(options.advanceMs);
    return (await captured) as ServerBrowserPage.ServerBrowserOperationError;
  } finally {
    vi.useRealTimers();
  }
};

describe("snapshot timeout reason for agents", () => {
  it("says the page was too busy, after how long, and what still works", async () => {
    const error = await failedSnapshot({ evaluate: never, advanceMs: 10_000 });
    expect(error.detail).toEqual({
      timeoutMs: 10_000,
      pendingStages: ["page state"],
      reason:
        "The page was too busy to answer, so the snapshot stopped after 10.0 s. preview_evaluate and preview_act typing still work: read the page or click elements with preview_evaluate, or take another snapshot in a moment.",
    });
  });

  it("reports the real elapsed time when a stage gives up before the deadline", async () => {
    // Each attempt's tree read times out after 3 s, so the retry ends the snapshot at 6 s.
    const error = await failedSnapshot({
      ariaSnapshot: async () => {
        vi.advanceTimersByTime(3_000);
        throw timedOut();
      },
      advanceMs: 0,
    });
    expect(error.detail).toMatchObject({
      timeoutMs: 10_000,
      pendingStages: expect.arrayContaining(["accessibility tree"]),
    });
    expect((error.detail as { reason: string }).reason).toMatch(
      /^The page was too busy to answer, so the snapshot stopped after 6\.0 s\. preview_evaluate /,
    );
  });
});

describe("server browser key press", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.setContent(
      `<textarea id="text">hello</textarea><input id="other" value="other" /><p id="plain">plain</p>
       <script>document.getElementById("text").setSelectionRange(5, 5)</script>`,
    );
    await page.focus("#other");
  });
  afterEach(async () => {
    await context.close();
  });

  const value = (selector: string) => page.locator(selector).inputValue();

  it("sends the key to its target instead of the field that has focus", async () => {
    await ServerBrowserPage.press(page, { selector: "#text", key: "Backspace" });
    expect(await value("#text")).toBe("hell");
    expect(await value("#other")).toBe("other");
  });

  it.each([
    { selector: "#missing", error: 'No element matches "#missing", so no key was pressed.' },
    { selector: "#plain", error: '"#plain" cannot take focus, so no key was pressed.' },
  ])("presses nothing when $selector cannot take the key", async ({ selector, error }) => {
    await expect(
      ServerBrowserPage.press(page, { selector, key: "Backspace", timeoutMs: 500 }),
    ).rejects.toThrow(error);
    expect(await value("#other")).toBe("other");
  });
});
