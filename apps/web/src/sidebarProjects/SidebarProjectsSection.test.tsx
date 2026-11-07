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
  createInCurrentProject: vi.fn(),
  openNewThreadPicker: vi.fn(),
  startScratchThread: vi.fn(),
  newThread: vi.fn(),
  navigate: vi.fn(),
  nativeContextMenu: vi.fn(),
}));

vi.mock("../components/ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../state/entities", () => ({
  useServerConfigs: () => new Map([[environmentId, { scratchWorkspaceRoot: "/home/scratch" }]]),
  useQuietThreadShells: () => [],
  useDelegatedUnderParent: () => new Set(),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => environmentId }));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => spies.newThread }));
// Environments offering a thread without a project (upstream's scratch project).
const scratch = vi.hoisted(() => ({ environmentIds: new Set<string | null>(["env-local"]) }));
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: (current: string | null) =>
      scratch.environmentIds.has(current) ? current : null,
    startScratchThread: spies.startScratchThread,
  }),
}));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: spies.nativeContextMenu } }),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: spies.navigate }) }));
const surface = vi.hoisted(() => ({ sidebarProjects: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", () => ({
  productSurface: () => surface.sidebarProjects,
}));

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

const { filterSidebarV2VisibleThreads, shouldCreateNewThreadInCurrentProject } =
  await import("../components/Sidebar.logic");
const { SidebarProvider } = await import("../components/ui/sidebar");
const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
const { __setClientSettingsForTests } = await import("../hooks/useSettings");
const { ALL_PROJECTS_ROW_KEY } = await import("./sidebarProjects.logic");
const { useUiStateStore } = await import("../uiStateStore");
const { SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, SidebarProjectsSection } =
  await import("./SidebarProjectsSection");
const { SIDEBAR_THREADS_OPEN_STORAGE_KEY, SidebarThreadsSectionHeader, useSidebarThreadListShown } =
  await import("./SidebarThreadsSection");

function group(
  id: string,
  title: string,
  workspaceRoot = `/work/${id}`,
  updatedAt?: string,
): SidebarProjectSnapshot {
  const member = { environmentId, id, workspaceRoot, title, physicalProjectKey: `physical-${id}` };
  return {
    ...member,
    ...(updatedAt === undefined ? {} : { createdAt: updatedAt, updatedAt }),
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
  const scopeKey = useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null;
  const scoped = PROJECTS.find((project) => project.projectKey === scopeKey);
  const keys = scoped
    ? new Set(scoped.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;
  return filterSidebarV2VisibleThreads(THREADS as never[], keys, new Set()).map(
    (entry: { id: string }) => entry.id,
  );
}

let root: Root;
let container: HTMLDivElement;

function render(projectGroups = PROJECTS, loaded = true) {
  return act(async () => {
    root.render(
      <SidebarProvider>
        {/* The sidebar's surface, which the rows hold still under the pointer in. */}
        <div data-sidebar="sidebar" data-testid="sidebar-surface">
          <SidebarProjectsSection
            projectGroups={projectGroups}
            onAddProject={spies.addProject}
            loaded={loaded}
          />
        </div>
      </SidebarProvider>,
    );
  });
}

const moreOption = (label: string) => {
  const option = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!option) throw new Error(`No "${label}" option`);
  return option;
};

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
  scratch.environmentIds = new Set(["env-local", "env-remote"]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  window.localStorage.clear();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useUiStateStore.setState({ sidebarProjectScopeKeys: [], projectOrder: [] });
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
  it("lists the first three rows of one order, All projects first on a fresh install, then More", async () => {
    await render();
    expect(rowLabels()).toEqual(["All projects", "UpComputer", "No project", "More"]);
  });

  it("keeps All projects first in an activity order, whatever was picked or active since", async () => {
    const recent = (id: string, title: string, day: number) =>
      group(id, title, undefined, `2099-02-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    // All projects used to sort by this pick time, so newer activity elsewhere (a new bot's
    // thread in No project) moved it down.
    window.localStorage.setItem(
      "upcomputer:sidebar-all-projects-selected-at",
      JSON.stringify("2026-11-01T00:00:00.000Z"),
    );
    await render([recent("upcomputer", "UpComputer", 9), recent("site", "Site", 8), PROJECTS[1]!]);
    expect(rowLabels().slice(0, 2)).toEqual(["All projects", "UpComputer"]);
  });

  it("places All projects at its entry in the manual order", async () => {
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, sidebarProjectSortOrder: "manual" });
    useUiStateStore.setState({
      projectOrder: ["physical-upcomputer", "physical-scratch", ALL_PROJECTS_ROW_KEY],
    });
    await render();
    expect(rowLabels()).toEqual(["UpComputer", "No project", "All projects", "More"]);
  });

  it("filters the thread list through upstream's project scope", async () => {
    await render();
    await click(rowButton("UpComputer"));
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBe("key-upcomputer");
    expect(visibleThreadIds()).toEqual(["in-upcomputer", "scratch-linked-to-upcomputer"]);
    expect(rowButton("UpComputer").dataset.active).toBe("true");

    await click(rowButton("All projects"));
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBeNull();
    expect(visibleThreadIds()).toHaveLength(THREADS.length);
  });

  it("filters No project to the Scratch project's threads", async () => {
    await render();
    await click(rowButton("No project"));
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBe("key-scratch");
    expect(visibleThreadIds()).toEqual(["scratch-linked-to-upcomputer", "in-scratch"]);
  });

  it("lists the remaining rows under More and keeps a chosen one visible", async () => {
    await render();
    await click(rowButton("More"));
    const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
    expect(options.map((option) => option.textContent)).toEqual([
      "Site",
      "Docs",
      "Infra",
      "Design",
    ]);

    await click(moreOption("Design"));
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBe("key-design");
    expect(rowLabels()).toEqual(["All projects", "UpComputer", "Design", "More"]);
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
    const pencil = rowButton("UpComputer").querySelector<HTMLElement>(
      "[aria-label='New chat in UpComputer']",
    )!;
    await click(pencil);
    expect(spies.newThread).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      projectId: "upcomputer",
    });
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBeNull();

    await click(
      rowButton("No project").querySelector<HTMLElement>(
        "[aria-label='New chat without a project']",
      )!,
    );
    expect(spies.newThread).toHaveBeenLastCalledWith({ environmentId, projectId: "scratch" });
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBeNull();
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
    expect(useUiStateStore.getState().sidebarProjectScopeKeys[0] ?? null).toBeNull();
  });

  it("opens the same menu on right-click instead of a native one", async () => {
    await render();
    expect(await rightClick(rowButton("UpComputer"))).toBe(true);
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

  it("offers New project as its only row with no projects, once loaded", async () => {
    await render([], false);
    const header = sectionHeader("sidebar-projects-toggle");
    expect(header.title()).toBe("Projects");
    expect(rowLabels()).toEqual([]);
    await click(header.action("Add project")!);
    expect(spies.addProject).toHaveBeenCalledOnce();

    await render([]);
    expect(rowLabels()).toEqual(["New project"]);
    await click(container.querySelector<HTMLElement>("[data-sidebar='menu-button']")!);
    expect(spies.addProject).toHaveBeenCalledTimes(2);
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

/** Upstream's Sidebar `handleNewThreadClick` with several open projects, on its real routing rule. */
function upstreamNewThreadClick(event?: { readonly shiftKey: boolean }) {
  if (
    shouldCreateNewThreadInCurrentProject(
      event?.shiftKey ?? false,
      PROJECTS.length,
      PROJECTS.length,
    )
  ) {
    spies.createInCurrentProject();
  } else {
    spies.openNewThreadPicker();
  }
}

function renderThreads(
  props: { newThreadDisabled?: boolean; currentEnvironmentId?: string | null } = {},
) {
  return act(async () => {
    root.render(
      <SidebarProvider>
        <SidebarThreadsSectionHeader
          onNewThread={upstreamNewThreadClick}
          currentEnvironmentId={(props.currentEnvironmentId ?? null) as never}
          newThreadDisabled={props.newThreadDisabled ?? false}
          newThreadShortcutLabel="⇧⌘O"
          placement="list"
        />
        <ThreadList />
      </SidebarProvider>,
    );
  });
}

const threadList = () => container.querySelector("[data-testid='thread-list']");

const shiftClick = (element: HTMLElement) =>
  act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
  });

describe("SidebarThreadsSectionHeader", () => {
  it("starts a thread without a project in the primary environment, with no picker", async () => {
    await renderThreads();
    const header = sectionHeader("sidebar-threads-toggle");
    expect(header.title()).toBe("Threads");
    await click(header.action("New thread")!);
    expect(spies.startScratchThread).toHaveBeenCalledExactlyOnceWith(environmentId);
    expect(spies.openNewThreadPicker).not.toHaveBeenCalled();
    expect(spies.createInCurrentProject).not.toHaveBeenCalled();
    expect(header.toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("starts it in the open thread's environment, as the command palette does", async () => {
    await renderThreads({ currentEnvironmentId: "env-remote" });
    await click(sectionHeader("sidebar-threads-toggle").action("New thread")!);
    expect(spies.startScratchThread).toHaveBeenCalledExactlyOnceWith("env-remote");
  });

  it("opens upstream's project picker on Shift+click", async () => {
    await renderThreads();
    await shiftClick(sectionHeader("sidebar-threads-toggle").action("New thread")!);
    expect(spies.openNewThreadPicker).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();
  });

  it("stays enabled with no projects", async () => {
    await renderThreads({ newThreadDisabled: true });
    await click(sectionHeader("sidebar-threads-toggle").action("New thread")!);
    expect(spies.startScratchThread).toHaveBeenCalledExactlyOnceWith(environmentId);
  });

  it("falls back to upstream's action where no environment offers a thread without a project", async () => {
    scratch.environmentIds = new Set();
    await renderThreads();
    await click(sectionHeader("sidebar-threads-toggle").action("New thread")!);
    expect(spies.openNewThreadPicker).toHaveBeenCalledOnce();
    expect(spies.startScratchThread).not.toHaveBeenCalled();

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
