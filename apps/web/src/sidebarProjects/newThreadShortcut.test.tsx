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
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget", "KeyboardEvent"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;

const spies = vi.hoisted(() => ({
  handleNewThread: vi.fn(),
  openCommandPalette: vi.fn(),
  startNewThreadFromContext: vi.fn(),
  startScratchThread: vi.fn(),
}));
const state = vi.hoisted(() => ({
  surface: "upcomputer" as "upstream" | "upcomputer",
  legacySidebar: false,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({ options }),
  Outlet: () => null,
  useParams: () => null,
}));
vi.mock("../components/ThreadRouteView", () => ({ ThreadRouteView: () => null }));
vi.mock("../commandPaletteBus", () => ({
  isCommandPaletteOpen: () => false,
  openCommandPalette: spies.openCommandPalette,
}));
// The pressed key stands for the command its binding resolves to.
vi.mock("../keybindings", () => ({
  resolveShortcutCommand: (event: KeyboardEvent) => event.key,
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: () => ({}),
  useLegacySidebarEnabled: () => state.legacySidebar,
}));
vi.mock("../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-local" }));
// Several projects, so upstream's chat.new opens the "New thread in..." picker.
vi.mock("../sidebarProjectGrouping", () => ({
  buildSidebarProjectSnapshots: () => [{}, {}],
}));
vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: { environmentId: "env-local", projectId: "site" },
    handleNewThread: spies.handleNewThread,
    routeThreadRef: null,
  }),
}));
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: (current: string | null) => current,
    startScratchThread: spies.startScratchThread,
  }),
}));
vi.mock("../lib/chatThreadActions", () => ({
  startNewThreadFromContext: spies.startNewThreadFromContext,
}));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));

const { Route } = await import("../routes/_chat");
// The router plugin splits route components into lazy chunks; load it up front.
const ChatRouteLayout = (
  Route as unknown as {
    options: { component: (() => React.ReactNode) & { preload?: () => Promise<void> } };
  }
).options.component;
await ChatRouteLayout.preload?.();

let root: Root;
let container: HTMLDivElement;

async function press(command: string) {
  await act(async () => root.render(<ChatRouteLayout />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: command, cancelable: true }));
  });
}

beforeEach(() => {
  state.surface = "upcomputer";
  state.legacySidebar = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("New thread shortcuts", () => {
  it("chat.new starts a thread without a project under the UpComputer surface", async () => {
    await press("chat.new");
    expect(spies.startScratchThread).toHaveBeenCalledExactlyOnceWith("env-local");
    expect(spies.openCommandPalette).not.toHaveBeenCalled();
  });

  it("chat.new opens upstream's picker under the upstream surface", async () => {
    state.surface = "upstream";
    await press("chat.new");
    expect(spies.openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
    expect(spies.startScratchThread).not.toHaveBeenCalled();
  });

  it("chat.new keeps upstream's behaviour in the legacy sidebar", async () => {
    state.legacySidebar = true;
    await press("chat.new");
    expect(spies.startNewThreadFromContext).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();
  });

  it("chat.newLocal still creates in the current project", async () => {
    await press("chat.newLocal");
    expect(spies.startNewThreadFromContext).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();
    expect(spies.openCommandPalette).not.toHaveBeenCalled();
  });
});
