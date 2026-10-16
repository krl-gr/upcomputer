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
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  // Base UI's combobox waits for its popup's animations.
  window.Element.prototype.getAnimations = () => [];
  // Upstream's context strip measures its labels.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(window.document, "fonts", {
    configurable: true,
    value: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
});

const { act, cloneElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactNode = import("react").ReactNode;
type ReactElement = import("react").ReactElement;

const state = vi.hoisted(() => ({
  serverThread: null as Record<string, unknown> | null,
  draftThread: null as Record<string, unknown> | null,
  draftId: null as string | null,
  projects: [] as Array<Record<string, unknown>>,
  scratchRoot: "/scratch",
  updateMetadata: vi.fn(async (_input: unknown) => ({ _tag: "Success" })),
  retargetDraft: vi.fn(),
  openCommandPalette: vi.fn(),
}));

// Tooltips render their text next to the trigger, so a test can read it.
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: ({ project }: { project: { title: string } }) => (
    <span data-testid="favicon">{project.title.slice(0, 2).toUpperCase()}</span>
  ),
}));
vi.mock("../components/Sidebar.logic", () => ({
  sortScopedProjectsForSidebar: (projects: unknown[]) => projects,
}));
vi.mock("../state/entities", () => ({
  useThreadShell: () => state.serverThread,
  useProject: (ref: { projectId: string } | null) =>
    ref === null ? null : (state.projects.find((project) => project.id === ref.projectId) ?? null),
  useProjects: () => state.projects,
  useThreadShells: () => [],
}));
vi.mock("../composerDraftStore", () => {
  const store = {
    getDraftThreadByRef: () => state.draftThread,
    getDraftIdByRef: () => state.draftId,
  };
  return { useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store) };
});
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ scratchWorkspaceRootFor: () => state.scratchRoot }),
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.updateMetadata }));
vi.mock("./useRetargetDraftToProject", () => ({
  useRetargetDraftToProject: () => state.retargetDraft,
}));
vi.mock("../commandPaletteBus", () => ({ openCommandPalette: state.openCommandPalette }));

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

const { ThreadHeaderProjects } = await import("./ThreadHeaderProjects");

const ENV = EnvironmentId.make("env-1");
const THREAD = ThreadId.make("thread-1");

const project = (id: string, title: string, workspaceRoot = `/work/${id}`) => ({
  id,
  environmentId: ENV,
  title,
  workspaceRoot,
});
const UPCOMPUTER = project("p-up", "UpComputer");
const KV = project("p-kv", "Kv store");
const RELAY = project("p-relay", "Relay");
const WEB = project("p-web", "Web");
const DOCS = project("p-docs", "Docs");
const SCRATCH = project("p-scratch", "No project", "/scratch");

let container: HTMLDivElement;
let root: Root;

function render() {
  return act(async () =>
    root.render(
      <ol>
        <ThreadHeaderProjects environmentId={ENV} threadId={THREAD} />
      </ol>,
    ),
  );
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function trigger() {
  return container.querySelector<HTMLElement>("[data-thread-header-projects]")!;
}

/** The text a user sees in an element, without the tooltips this file renders inline. */
function visibleText(element: Element | null) {
  const copy = element?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll("[data-testid=tooltip]").forEach((tooltip) => tooltip.remove());
  return copy?.textContent;
}

/** Each option as its title, with `✓` when it is checked and `(off)` when it cannot change. */
function options() {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=option]")).map(
    (option) =>
      `${option.textContent?.slice(2)}${option.querySelector("svg") ? " ✓" : ""}${
        option.getAttribute("aria-disabled") === "true" ? " (off)" : ""
      }`,
  );
}

function optionByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=option]")).find((option) =>
    option.textContent?.includes(text),
  );
}

beforeEach(() => {
  state.serverThread = null;
  state.draftThread = null;
  state.draftId = null;
  state.projects = [UPCOMPUTER, KV, RELAY, SCRATCH];
  state.updateMetadata.mockClear();
  state.retargetDraft.mockClear();
  state.openCommandPalette.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("the chat's projects in the header", () => {
  it("shows the own project with its name and the linked ones, and links and unlinks from the list", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      linkedProjectIds: [KV.id, "deleted-project"],
    };
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Projects: UpComputer, Kv store");
    expect(visibleText(trigger())).toBe("UPUpComputerKV");
    expect(container.querySelector("[data-thread-header-no-project]")).toBeNull();

    await click(trigger());
    // The own project first and fixed, never the scratch folder.
    expect(options()).toEqual(["UpComputer ✓ (off)", "Kv store ✓", "Relay"]);
    await click(optionByText("Relay")!);
    expect(state.updateMetadata).toHaveBeenLastCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, linkProjectIds: [RELAY.id] },
    });
    await click(optionByText("Kv store")!);
    expect(state.updateMetadata).toHaveBeenLastCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, unlinkProjectIds: [KV.id] },
    });
    expect(state.updateMetadata).toHaveBeenCalledTimes(2);
  });

  it("shows the no-project square for a chat without projects, and links one", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: SCRATCH.id,
      linkedProjectIds: [],
    };
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Projects: No project");
    expect(container.querySelector("[data-thread-header-no-project]")).not.toBeNull();
    expect(container.querySelector("[data-testid=favicon]")).toBeNull();

    await click(trigger());
    expect(options()).toEqual(["UpComputer", "Kv store", "Relay"]);
    await click(optionByText("Kv store")!);
    expect(state.updateMetadata).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, linkProjectIds: [KV.id] },
    });
  });

  it("shows only the icons of a chat without a project once it links some, up to three", async () => {
    state.projects = [UPCOMPUTER, KV, RELAY, WEB, DOCS, SCRATCH];
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: SCRATCH.id,
      linkedProjectIds: [UPCOMPUTER.id, KV.id, RELAY.id, WEB.id],
    };
    await render();
    expect(container.querySelector("[data-thread-header-no-project]")).toBeNull();
    expect(visibleText(trigger())).toBe("UPKVRE+1");
  });

  it("moves an unsent chat without a project into the chosen one", async () => {
    state.draftThread = { environmentId: ENV, threadId: THREAD, projectId: SCRATCH.id };
    state.draftId = "draft-1";
    await render();
    expect(container.querySelector("[data-thread-header-no-project]")).not.toBeNull();
    await click(trigger());
    await click(optionByText("Kv store")!);
    expect(state.retargetDraft).toHaveBeenCalledWith("draft-1", KV);
    expect(state.updateMetadata).not.toHaveBeenCalled();
  });

  it("links more projects to an unsent chat in a project only after its first message", async () => {
    state.draftThread = { environmentId: ENV, threadId: THREAD, projectId: UPCOMPUTER.id };
    state.draftId = "draft-2";
    await render();
    await click(trigger());
    expect(options()).toEqual(["UpComputer ✓ (off)", "Kv store (off)", "Relay (off)"]);
    expect(document.body.textContent).toContain("Link more projects after the first message.");
    await click(optionByText("Kv store")!);
    expect(state.updateMetadata).not.toHaveBeenCalled();
    expect(state.retargetDraft).not.toHaveBeenCalled();
  });

  it("offers New project from the list", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      linkedProjectIds: [],
    };
    await render();
    await click(trigger());
    const newProject = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "New project…",
    )!;
    await click(newProject);
    expect(state.openCommandPalette).toHaveBeenCalledWith({ open: "add-project" });
  });
});
