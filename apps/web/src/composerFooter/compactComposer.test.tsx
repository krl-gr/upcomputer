import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React loads.
await vi.hoisted(async () => {
  // @ts-expect-error jsdom ships no type declarations and this repo has no @types/jsdom.
  const { JSDOM } = await import("jsdom");
  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const source = window as unknown as Record<string, unknown>;
  // Node's own event classes cannot be dispatched on jsdom nodes.
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

const surface = vi.hoisted(() => ({ composerFooter: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => surface.composerFooter,
}));

const { act, useEffect } = await import("react");
const { createRoot } = await import("react-dom/client");
const { isComposerCompact, useCompactComposerChat, useIsCompactComposerChat } =
  await import("./compactComposer");
const { scopedThreadKey, scopeThreadRef } = await import("@t3tools/client-runtime/environment");
const { EnvironmentId, ThreadId } = await import("@t3tools/contracts");
type CompactComposerInput = import("./compactComposer").CompactComposerInput;

const idle: CompactComposerInput = {
  isBotChat: true,
  enabled: true,
  hasMultilinePrompt: false,
  hasAttachments: false,
  hasPendingRequest: false,
  hasExpandedChrome: false,
};

afterEach(() => {
  surface.composerFooter = "upcomputer";
});

describe("isComposerCompact", () => {
  it("compacts a bot chat's composer whose content fits one row", () => {
    expect(isComposerCompact(idle)).toBe(true);
  });

  it.each([
    ["the chat is an ordinary thread", { isBotChat: false }],
    ["full composer in bot chats is on", { enabled: false }],
    ["the prompt runs past one line", { hasMultilinePrompt: true }],
    ["the draft has attachments", { hasAttachments: true }],
    ["an approval or question waits", { hasPendingRequest: true }],
    ["its controls, a menu, drag or error are up", { hasExpandedChrome: true }],
  ])("stays full when %s", (_reason, override) => {
    expect(isComposerCompact({ ...idle, ...override })).toBe(false);
  });

  it("leaves upstream's composer alone", () => {
    surface.composerFooter = "upstream";
    expect(isComposerCompact(idle)).toBe(false);
  });
});

describe("useIsCompactComposerChat", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const threadId = ThreadId.make("thread-1");
  let container: HTMLDivElement;
  let root: import("react-dom/client").Root;
  let compact: boolean | null = null;

  function Chat(props: { readonly marked: boolean }) {
    useCompactComposerChat(
      props.marked ? scopedThreadKey(scopeThreadRef(environmentId, threadId)) : null,
    );
    const isCompact = useIsCompactComposerChat(environmentId, threadId);
    useEffect(() => {
      compact = isCompact;
    }, [isCompact]);
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("follows the bot header's mark on the chat", async () => {
    await act(async () => root.render(<Chat marked={false} />));
    expect(compact).toBe(false);
    await act(async () => root.render(<Chat marked />));
    expect(compact).toBe(true);
    await act(async () => root.render(<Chat marked={false} />));
    expect(compact).toBe(false);
  });
});
