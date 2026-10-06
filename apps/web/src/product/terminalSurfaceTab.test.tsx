import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget", "KeyboardEvent"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const fakes = vi.hoisted(() => ({
  hidden: true,
  queries: [] as unknown[],
  attached: [] as unknown[],
  written: [] as string[],
  surfaceOptions: null as null | { onData: (data: string) => void },
  surfaceOutput: [] as string[],
}));

vi.mock("./productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("./WebProduct");
  const { UPCOMPUTER_PRODUCT_FLAGS, UPSTREAM_PRODUCT_FLAGS } =
    await import("@t3tools/shared/productFlags");
  return {
    WEB_PRODUCT: {
      ...composeExperimentalWebFeatures([]),
      get flags() {
        return fakes.hidden ? UPCOMPUTER_PRODUCT_FLAGS : UPSTREAM_PRODUCT_FLAGS;
      },
    },
  };
});

// A fake Ghostty surface: no WASM, it records what the terminal writes to it.
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: {
    create: async (_mount: HTMLElement, options: { onData: (data: string) => void }) => {
      fakes.surfaceOptions = options;
      return new Proxy(
        {
          resetAndWrite: (data: string) => fakes.surfaceOutput.push(data),
          write: (data: string) => fakes.surfaceOutput.push(data),
          hasSelection: () => false,
        } as Record<string, unknown>,
        {
          get: (target, key) =>
            key === "then" ? undefined : (target[key as string] ?? (() => undefined)),
        },
      );
    },
  },
}));

// A fake server session: the attach stream already holds a prompt.
vi.mock("../state/terminalSessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/terminalSessions")>();
  const { EMPTY_TERMINAL_SESSION_STATE } = await import("@t3tools/client-runtime/state/terminal");
  return {
    ...actual,
    useAttachedTerminalSession: (input: { terminal: unknown }) => {
      fakes.attached.push(input.terminal);
      return {
        ...EMPTY_TERMINAL_SESSION_STATE,
        status: "running",
        version: 1,
        output: {
          generation: 1,
          chunks: [{ startOffset: 0, data: "~/repo $ ", byteLength: 9 }],
          retainedBytes: 9,
          resetVersion: 0,
          nextOffset: 9,
        },
      };
    },
  };
});
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    fakes.queries.push(query);
    return { data: null, error: null };
  },
}));
vi.mock("../state/terminal", () => ({
  terminalEnvironment: {
    metadata: (request: unknown) => ({ metadata: request }),
    write: "write",
    resize: "resize",
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => async (request: { input: { data?: string } }) => {
    if (command === "write" && request.input.data) fakes.written.push(request.input.data);
    return { _tag: "Success" };
  },
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => null,
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: Record<string, unknown>) => unknown) =>
    select({ fontFamilyCode: "", fontSizeCode: 12, fontFamilyTerminal: "", fontSizeTerminal: 12 }),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => async () => null }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { default: ThreadTerminalDrawer } = await import("../components/ThreadTerminalDrawer");
const { useKnownTerminalSessions, useThreadRunningTerminalIds } =
  await import("../state/terminalSessions");
const { withoutHiddenProductKeybindings } = await import("./productFlags");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const environmentId = EnvironmentId.make("env-local");
const threadId = ThreadId.make("thread-1");
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  fakes.hidden = true;
  fakes.queries = [];
  fakes.attached = [];
  fakes.written = [];
  fakes.surfaceOptions = null;
  fakes.surfaceOutput = [];
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
}

describe("the right-panel terminal tab in the UpComputer product", () => {
  it("attaches to its session, shows the output and sends what the user types", async () => {
    await render(
      <ThreadTerminalDrawer
        mode="panel"
        threadRef={{ environmentId, threadId }}
        threadId={threadId}
        cwd="/repo"
        height={0}
        terminalIds={["term-1"]}
        activeTerminalId="term-1"
        terminalGroups={[{ id: "terminal:term-1", terminalIds: ["term-1"] }]}
        activeTerminalGroupId="terminal:term-1"
        focusRequestId={0}
        onSplitTerminal={() => undefined}
        onSplitTerminalVertical={() => undefined}
        onNewTerminal={() => undefined}
        onActiveTerminalChange={() => undefined}
        onCloseTerminal={() => undefined}
        onHeightChange={() => undefined}
        onAddTerminalContext={() => undefined}
        keybindings={withoutHiddenProductKeybindings(mergeWithDefaultKeybindings([]))}
      />,
    );

    expect(fakes.attached).toContainEqual(
      expect.objectContaining({ threadId, terminalId: "term-1", cwd: "/repo" }),
    );
    expect(fakes.surfaceOutput).toEqual(["~/repo $ "]);

    await act(async () => fakes.surfaceOptions?.onData("ls\r"));
    expect(fakes.written).toEqual(["ls\r"]);
  });

  it("subscribes to terminal metadata for the tab, but not for thread rows", async () => {
    function Probe() {
      useKnownTerminalSessions({ environmentId, threadId });
      useThreadRunningTerminalIds({ environmentId, threadId });
      return null;
    }
    await render(<Probe />);
    // The tab's labels and working directories, but no running-terminal row badge.
    expect(fakes.queries).toEqual([{ metadata: { environmentId, input: null } }, null]);

    act(() => root?.unmount());
    root = null;
    fakes.hidden = false;
    fakes.queries = [];
    await render(<Probe />);
    expect(fakes.queries).toEqual([
      { metadata: { environmentId, input: null } },
      { metadata: { environmentId, input: null } },
    ]);
  });
});
