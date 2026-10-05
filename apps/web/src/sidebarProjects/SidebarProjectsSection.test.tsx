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
const spies = vi.hoisted(() => ({
  addProject: vi.fn(),
  newThreadFromHeader: vi.fn(),
  newThread: vi.fn(),
  navigate: vi.fn(),
  nativeContextMenu: vi.fn(),
}));

vi.mock("../components/ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../state/entities", () => ({
  useServerConfigs: () => new Map([[environmentId, { scratchWorkspaceRoot: "/home/scratch" }]]),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => environmentId }));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => spies.newThread }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: spies.nativeContextMenu } }),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: spies.navigate }) }));
const surface = vi.hoisted(() => ({ sidebarProjects: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", () => ({
  productSurface: () => surface.sidebarProjects,
}));

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

const { filterSidebarV2VisibleThreads } = await import("../components/Sidebar.logic");
const { SidebarProvider } = await import("../components/ui/sidebar");
const { useUiStateStore } = await import("../uiStateStore");
const { SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, SidebarProjectsSection } =
  await import("./SidebarProjectsSection");
const { SIDEBAR_THREADS_OPEN_STORAGE_KEY, SidebarThreadsSectionHeader, useSidebarThreadListShown } =
  await import("./SidebarThreadsSection");

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
        <SidebarProjectsSection projectGroups={PROJECTS} onAddProject={spies.addProject} />
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

/** Dispatches a right-click and reports whether the page's own menu was suppressed. */
const rightClick = async (element: HTMLElement) => {
  let suppressed = false;
  await act(async () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    suppressed = !element.dispatchEvent(event);
  });
  return suppressed;
};

function actionLabels(label: string) {
  return [...rowButton(label).querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-label"),
  );
}

const menuItemLabels = () =>
  [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].map((item) => item.textContent);

function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) throw new Error(`No "${label}" menu item`);
  return item;
}

beforeEach(() => {
  surface.sidebarProjects = "upcomputer";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
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

  it("gives project rows a new chat button and a menu, revealed on hover or focus", async () => {
    await render();
    expect(actionLabels("UpComputer")).toEqual([
      "Project actions for UpComputer",
      "New chat in UpComputer",
    ]);
    expect(actionLabels("Docs")).toEqual(["Project actions for Docs", "New chat in Docs"]);
    expect(actionLabels("No project")).toEqual(["New chat without a project"]);
    expect(actionLabels("All projects")).toEqual([]);
    expect(actionLabels("More")).toEqual([]);

    const actions = rowButton("UpComputer").querySelector<HTMLElement>(
      "[data-testid='sidebar-project-row-actions']",
    )!;
    expect(actions.classList).toContain("hidden");
    expect(actions.classList).toContain("group-any-hover/sidebar-row:flex");
    expect(actions.classList).toContain("group-focus-within/sidebar-row:flex");
  });

  it("starts a new thread in the row's project without changing the filter", async () => {
    await render();
    const pencil = rowButton("Site").querySelector<HTMLElement>("[aria-label='New chat in Site']")!;
    await click(pencil);
    expect(spies.newThread).toHaveBeenCalledExactlyOnceWith({ environmentId, projectId: "site" });
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBeNull();

    await click(
      rowButton("No project").querySelector<HTMLElement>(
        "[aria-label='New chat without a project']",
      )!,
    );
    expect(spies.newThread).toHaveBeenLastCalledWith({ environmentId, projectId: "scratch" });
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBeNull();
  });

  it("opens project settings from the row's menu", async () => {
    await render();
    await click(
      rowButton("UpComputer").querySelector<HTMLElement>(
        "[aria-label='Project actions for UpComputer']",
      )!,
    );
    expect(menuItemLabels()).toEqual(["Project settings", "Copy path"]);
    // The open menu keeps the row highlighted and its actions shown.
    expect(rowButton("UpComputer").classList).toContain("bg-sidebar-row-hover");
    expect(
      rowButton("UpComputer").querySelector("[data-testid='sidebar-project-row-actions']")
        ?.classList,
    ).not.toContain("hidden");

    await click(menuItem("Project settings"));
    expect(spies.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/projects/$projectKey",
      params: { projectKey: "key-upcomputer" },
    });
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBeNull();
  });

  it("opens the same menu on right-click instead of a native one", async () => {
    await render();
    expect(await rightClick(rowButton("Site"))).toBe(true);
    expect(menuItemLabels()).toEqual(["Project settings", "Copy path"]);
    expect(spies.nativeContextMenu).not.toHaveBeenCalled();

    await click(rowButton("More"));
    const design = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Design",
    )!;
    expect(await rightClick(design)).toBe(true);
    expect(spies.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/projects/$projectKey",
      params: { projectKey: "key-design" },
    });
    expect(spies.nativeContextMenu).not.toHaveBeenCalled();
  });
});

const sectionHeader = (testId: string) => {
  const toggle = container.querySelector<HTMLElement>(`[data-testid='${testId}']`)!;
  return {
    toggle,
    title: () => toggle.firstElementChild?.textContent,
    chevronOpen: () =>
      toggle
        .querySelector("[data-testid='sidebar-section-chevron']")!
        .classList.contains("rotate-90"),
    action: (label: string) =>
      toggle.parentElement!.querySelector<HTMLElement>(`button[aria-label='${label}']`),
  };
};

describe("SidebarSectionHeader", () => {
  it("shows the title, a chevron that turns with the section, and the action", async () => {
    await render();
    const header = sectionHeader("sidebar-projects-toggle");
    expect(header.title()).toBe("Projects");
    expect(header.chevronOpen()).toBe(true);
    expect(header.action("Add project")).not.toBeNull();

    await click(header.toggle);
    expect(header.toggle.getAttribute("aria-expanded")).toBe("false");
    expect(header.chevronOpen()).toBe(false);
    expect(header.action("Add project")).not.toBeNull();
  });

  it("runs upstream's add project action without toggling the section", async () => {
    await render();
    const header = sectionHeader("sidebar-projects-toggle");
    await click(header.action("Add project")!);
    expect(spies.addProject).toHaveBeenCalledOnce();
    expect(header.toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

/** Stands in for upstream's thread list, which the Sidebar shows with the same hook. */
function ThreadList() {
  return useSidebarThreadListShown() ? <ul data-testid="thread-list" /> : null;
}

function renderThreads(props: { newThreadDisabled?: boolean } = {}) {
  return act(async () => {
    root.render(
      <SidebarProvider>
        <SidebarThreadsSectionHeader
          onNewThread={spies.newThreadFromHeader}
          newThreadDisabled={props.newThreadDisabled ?? false}
          newThreadShortcutLabel="⌘N"
        />
        <ThreadList />
      </SidebarProvider>,
    );
  });
}

const threadList = () => container.querySelector("[data-testid='thread-list']");

describe("SidebarThreadsSectionHeader", () => {
  it("runs upstream's new thread action with the click", async () => {
    await renderThreads();
    const header = sectionHeader("sidebar-threads-toggle");
    expect(header.title()).toBe("Threads");
    await click(header.action("New thread")!);
    expect(spies.newThreadFromHeader).toHaveBeenCalledOnce();
    expect(spies.newThreadFromHeader.mock.calls[0]![0]).toHaveProperty("shiftKey", false);
    expect(header.toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("has no new thread action while upstream disables it", async () => {
    await renderThreads({ newThreadDisabled: true });
    expect(sectionHeader("sidebar-threads-toggle").action("New thread")).toBeNull();
  });

  it("collapses the thread list and remembers it", async () => {
    await renderThreads();
    expect(threadList()).not.toBeNull();
    const header = sectionHeader("sidebar-threads-toggle");
    await click(header.toggle);
    expect(header.chevronOpen()).toBe(false);
    expect(threadList()).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_THREADS_OPEN_STORAGE_KEY)).toBe("false");

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderThreads();
    expect(sectionHeader("sidebar-threads-toggle").toggle.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(threadList()).toBeNull();

    await click(sectionHeader("sidebar-threads-toggle").toggle);
    expect(threadList()).not.toBeNull();
  });

  it("always shows upstream's thread list with upstream's surface", async () => {
    window.localStorage.setItem(SIDEBAR_THREADS_OPEN_STORAGE_KEY, "false");
    surface.sidebarProjects = "upstream";
    await act(async () => {
      root.render(<ThreadList />);
    });
    expect(threadList()).not.toBeNull();
  });
});
