import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React and Base UI load.
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

const { act, cloneElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactNode = import("react").ReactNode;
type ReactElement = import("react").ReactElement;

const state = vi.hoisted(() => ({
  surface: "upcomputer" as "upstream" | "upcomputer",
  thread: null as Record<string, unknown> | null,
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: ({ project }: { project: { title: string } }) => (
    <span data-testid="favicon">{project.title.slice(0, 2).toUpperCase()}</span>
  ),
}));
vi.mock("../state/entities", () => ({
  useThreadShell: () => state.thread,
  useProjects: () => state.projects,
  useServerConfigs: () => new Map(),
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../hooks/useThreadActionMenu", () => ({
  useThreadActionMenu: () => ({ openMenu: vi.fn(), closeMenu: vi.fn() }),
}));
// The header's product accessories: the task-run badge stands in as a fixed
// "1 13", next to the real linked-projects accessory.
vi.mock("../product/ProductSlots", async () => {
  const { default: ThreadLinkedProjects } = await import("../linkedProjects/ThreadLinkedProjects");
  return {
    ProductChatHeaderAccessory: (
      props: import("../product/WebFeature").ExperimentalWebThreadAccessoryProps,
    ) => (
      <>
        <span data-testid="run-badge">1 13</span>
        <ThreadLinkedProjects {...props} />
      </>
    ),
  };
});

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

const { ChatHeader } = await import("../components/chat/ChatHeader");

const ENV = EnvironmentId.make("env-1");
const THREAD = ThreadId.make("thread-1");
const project = (id: string, title: string) => ({
  id,
  environmentId: ENV,
  title,
  workspaceRoot: `/work/${id}`,
});
const NO_PROJECT = project("p-np", "No project");
const UPCOMPUTER = project("p-up", "UpComputer");
const KV = project("p-kv", "Kv store");

let container: HTMLDivElement;
let root: Root;

async function renderHeader() {
  await act(async () =>
    root.render(
      <ChatHeader
        activeThreadEnvironmentId={ENV}
        activeThreadId={THREAD}
        activeThreadTitle="Find the worktree fixes"
        isServerThread
        activeProject={NO_PROJECT as never}
        rightPanelOpen={false}
        onNewThreadInProject={vi.fn()}
      />,
    ),
  );
}

beforeEach(() => {
  state.thread = {
    environmentId: ENV,
    id: THREAD,
    projectId: NO_PROJECT.id,
    linkedProjectIds: [UPCOMPUTER.id, KV.id],
  };
  state.projects = [NO_PROJECT, UPCOMPUTER, KV];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the chat header", () => {
  it("shows only the thread title and the run badge under the UpComputer row", async () => {
    state.surface = "upcomputer";
    await renderHeader();
    expect(container.textContent).toBe("Find the worktree fixes1 13");
    expect(container.querySelector('[aria-label="New thread in No project"]')).toBeNull();
    expect(container.querySelector('[data-testid="favicon"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Thread actions for Find the worktree fixes"]'),
    ).not.toBeNull();
  });

  it("keeps upstream's project breadcrumb and linked-project chips with the upstream surface", async () => {
    state.surface = "upstream";
    await renderHeader();
    expect(container.querySelector('[aria-label="New thread in No project"]')?.textContent).toBe(
      "NONo project",
    );
    expect(
      container.querySelector('[aria-label="Linked projects: UpComputer, Kv store"]')?.textContent,
    ).toBe("UPKV");
    expect(container.querySelector('[data-testid="run-badge"]')).not.toBeNull();
  });
});
