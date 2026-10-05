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
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;

const environmentId = "env-local";

vi.mock("../components/ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../state/entities", () => ({
  useServerConfigs: () => new Map([[environmentId, { scratchWorkspaceRoot: "/home/scratch" }]]),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => environmentId }));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("../localApi", () => ({ readLocalApi: () => null }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

const { filterSidebarV2VisibleThreads } = await import("../components/Sidebar.logic");
const { SidebarProvider } = await import("../components/ui/sidebar");
const { useUiStateStore } = await import("../uiStateStore");
const { SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, SidebarProjectsSection } =
  await import("./SidebarProjectsSection");

function group(id: string, title: string, workspaceRoot = `/work/${id}`): SidebarProjectSnapshot {
  const member = { environmentId, id, workspaceRoot, title };
  return {
    ...member,
    projectKey: `key-${id}`,
    displayName: title,
    memberProjects: [member],
    memberProjectRefs: [{ environmentId, projectId: id }],
  } as unknown as SidebarProjectSnapshot;
}

const PROJECTS = [
  group("upcomputer", "UpComputer"),
  group("scratch", "scratch", "/home/scratch"),
  group("site", "Site"),
  group("docs", "Docs"),
  group("infra", "Infra"),
  group("design", "Design"),
];

const thread = (id: string, projectId: string, linkedProjectIds: string[] = []) => ({
  id,
  environmentId,
  projectId,
  linkedProjectIds,
  archivedAt: null,
  sidebarHidden: false,
  lineage: { relationshipToParent: null },
});

const THREADS = [
  thread("in-upcomputer", "upcomputer"),
  thread("in-site", "site"),
  thread("scratch-linked-to-upcomputer", "scratch", ["upcomputer"]),
  thread("in-scratch", "scratch"),
];

/** The threads upstream's sidebar shows under the persisted scope, derived as the sidebar does. */
function visibleThreadIds() {
  const scopeKey = useUiStateStore.getState().sidebarProjectScopeKey;
  const scoped = PROJECTS.find((project) => project.projectKey === scopeKey);
  const keys = scoped
    ? new Set(scoped.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;
  return filterSidebarV2VisibleThreads(THREADS as never[], keys).map(
    (entry: { id: string }) => entry.id,
  );
}

let root: Root;
let container: HTMLDivElement;

function render() {
  return act(async () => {
    root.render(
      <SidebarProvider>
        <SidebarProjectsSection projectGroups={PROJECTS} />
      </SidebarProvider>,
    );
  });
}

function rowLabels() {
  return [...container.querySelectorAll("[data-sidebar='menu-button']")].map(
    (row) => row.textContent,
  );
}

function rowButton(label: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>("[data-sidebar='menu-button']")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!row) throw new Error(`No "${label}" row`);
  return row;
}

const click = (element: HTMLElement) =>
  act(async () => {
    element.click();
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  useUiStateStore.setState({ sidebarProjectScopeKey: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SidebarProjectsSection", () => {
  it("lists All projects, the first projects, No project and More", async () => {
    await render();
    expect(rowLabels()).toEqual([
      "All projects",
      "UpComputer",
      "Site",
      "Docs",
      "No project",
      "More",
    ]);
  });

  it("filters the thread list through upstream's project scope", async () => {
    await render();
    await click(rowButton("UpComputer"));
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("key-upcomputer");
    expect(visibleThreadIds()).toEqual(["in-upcomputer", "scratch-linked-to-upcomputer"]);
    expect(rowButton("UpComputer").dataset.active).toBe("true");

    await click(rowButton("All projects"));
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBeNull();
    expect(visibleThreadIds()).toHaveLength(THREADS.length);
  });

  it("filters No project to the Scratch project's threads", async () => {
    await render();
    await click(rowButton("No project"));
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("key-scratch");
    expect(visibleThreadIds()).toEqual(["scratch-linked-to-upcomputer", "in-scratch"]);
  });

  it("lists the remaining projects under More and keeps a chosen one visible", async () => {
    await render();
    await click(rowButton("More"));
    const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
    expect(options.map((option) => option.textContent)).toEqual(["Infra", "Design"]);

    await click(options[1]!);
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("key-design");
    expect(rowLabels()).toEqual([
      "All projects",
      "UpComputer",
      "Site",
      "Design",
      "No project",
      "More",
    ]);
  });

  it("remembers that the section is collapsed", async () => {
    await render();
    const toggle = container.querySelector<HTMLElement>("[data-testid='sidebar-projects-toggle']")!;
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY)).toBe("false");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(
      container
        .querySelector("[data-testid='sidebar-projects-toggle']")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(rowLabels()).toEqual([]);
  });
});
