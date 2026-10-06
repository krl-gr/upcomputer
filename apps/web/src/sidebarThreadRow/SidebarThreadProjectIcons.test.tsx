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
});

const { act, cloneElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactElement = import("react").ReactElement;
type ReactNode = import("react").ReactNode;

const environmentId = "env-local";
const SCRATCH_ROOT = "/home/scratch";

function project(id: string, title: string, workspaceRoot = `/work/${id}`) {
  return { id, environmentId, title, workspaceRoot };
}

const PROJECTS = [
  project("scratch", "No project", SCRATCH_ROOT),
  project("upcomputer", "UpComputer"),
  project("life", "Life OS"),
  project("site", "Site"),
  project("docs", "Docs"),
  project("infra", "Infra"),
];

const state = vi.hoisted(() => ({ projects: [] as ReadonlyArray<unknown> }));

vi.mock("../product/productFlags", () => ({ productSurface: () => "upcomputer" }));
vi.mock("../product/ProductSlots", () => ({
  ProductThreadRowAccessory: (props: { fallback: unknown }) => props.fallback,
}));
// Tooltips render their text next to the trigger, so a test can read it.
vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));
// Stands in for the project icon or monogram with the project's initials.
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: ({ project }: { project: { title: string } }) => (
    <span data-testid="project-icon">{project.title.slice(0, 2).toUpperCase()}</span>
  ),
}));
vi.mock("../state/entities", () => ({
  useProjects: () => state.projects,
  useServerConfigs: () => new Map([[environmentId, { scratchWorkspaceRoot: SCRATCH_ROOT }]]),
}));

import type { SidebarCompactThreadRowProps } from "./SidebarCompactThreadRow";

const { SidebarCompactThreadRow } = await import("./SidebarCompactThreadRow");
const { useUiStateStore } = await import("../uiStateStore");
const { resolveThreadProjectIconStack } = await import("./threadProjectIcons.logic");

function rowProps(
  projectId: string,
  linkedProjectIds?: ReadonlyArray<string>,
): SidebarCompactThreadRowProps {
  const now = new Date().toISOString();
  return {
    thread: {
      id: "thread",
      environmentId,
      projectId,
      title: "Chat",
      latestRun: null,
      runtime: null,
      latestUserMessageAt: now,
      updatedAt: now,
      titleRegeneration: null,
      ...(linkedProjectIds ? { linkedProjectIds } : {}),
    } as unknown as SidebarCompactThreadRowProps["thread"],
    variantAction: "settle",
    isPinned: false,
    dropVerb: null,
    sweepAction: null,
    snoozeWakeLabelText: null,
    isActive: false,
    jumpLabel: null,
    project: (PROJECTS.find((entry) => entry.id === projectId) ??
      null) as unknown as SidebarCompactThreadRowProps["project"],
    projectDisplayName: null,
    isRenaming: false,
    renamingTitle: "",
    onThreadClick: vi.fn(),
    onThreadActivate: vi.fn(),
    onStartRename: vi.fn(),
    onRenameTitleChange: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onContextMenu: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

function render(props: SidebarCompactThreadRowProps) {
  return act(async () => {
    root.render(
      <ul>
        <SidebarCompactThreadRow {...props} />
      </ul>,
    );
  });
}

/** The row's leading icons: their initials, the tooltip, and whether the chat icon shows. */
function leadingIcons() {
  const row = container.querySelector("[data-testid='sidebar-row-compact']")!;
  const marker = row.querySelector("[role='img']");
  return {
    initials: [...row.querySelectorAll("[data-testid='project-icon']")].map(
      (icon) => icon.textContent,
    ),
    tooltip:
      marker?.nextElementSibling?.getAttribute("data-testid") === "tooltip"
        ? marker.nextElementSibling.textContent
        : null,
    label: marker?.getAttribute("aria-label") ?? null,
    chatIcon: row.querySelector(".lucide-message-square-dashed") !== null,
    text: row.textContent,
  };
}

beforeEach(() => {
  state.projects = PROJECTS;
  useUiStateStore.setState({ sidebarProjectScopeKey: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SidebarThreadProjectIcons", () => {
  it("shows a thread's own project", async () => {
    await render(rowProps("upcomputer"));
    expect(leadingIcons()).toMatchObject({
      initials: ["UP"],
      tooltip: "UpComputer",
      chatIcon: false,
    });
  });

  it("shows a chat without a project as its linked project, never NP", async () => {
    await render(rowProps("scratch", ["life"]));
    const icons = leadingIcons();
    expect(icons).toMatchObject({ initials: ["LI"], tooltip: "Life OS", chatIcon: false });
    expect(icons.text).not.toContain("NO");
  });

  it("stacks at most three linked projects and names all of them", async () => {
    await render(rowProps("scratch", ["life", "site", "docs", "infra"]));
    expect(leadingIcons()).toMatchObject({
      initials: ["LI", "SI", "DO"],
      tooltip: "Life OS, Site, Docs, Infra",
      label: "Life OS, Site, Docs, Infra",
      chatIcon: false,
    });
  });

  it("shows the muted chat icon for a chat without a project or links", async () => {
    await render(rowProps("scratch"));
    expect(leadingIcons()).toMatchObject({
      initials: [],
      tooltip: "No project",
      label: "No project",
      chatIcon: true,
    });
  });

  it("follows links and unlinks as the thread shell changes", async () => {
    await render(rowProps("scratch"));
    expect(leadingIcons().chatIcon).toBe(true);

    await render(rowProps("scratch", ["life"]));
    expect(leadingIcons()).toMatchObject({ initials: ["LI"], chatIcon: false });

    await render(rowProps("scratch", ["life", "site"]));
    expect(leadingIcons()).toMatchObject({ initials: ["LI", "SI"], tooltip: "Life OS, Site" });

    await render(rowProps("scratch", []));
    expect(leadingIcons()).toMatchObject({ initials: [], chatIcon: true });
  });

  it("resolves a linked project that loads after the row", async () => {
    state.projects = PROJECTS.filter((entry) => entry.id !== "life");
    await render(rowProps("scratch", ["life"]));
    expect(leadingIcons().chatIcon).toBe(true);

    state.projects = PROJECTS;
    await render(rowProps("scratch", ["life"]));
    expect(leadingIcons()).toMatchObject({ initials: ["LI"], chatIcon: false });
  });

  it("hides the icons in a project-scoped list, as V1's filtered list did", async () => {
    useUiStateStore.setState({ sidebarProjectScopeKey: "key-life" });
    await render(rowProps("scratch", ["life"]));
    expect(leadingIcons()).toMatchObject({ initials: [], chatIcon: false, label: null });
  });
});

describe("resolveThreadProjectIconStack", () => {
  const projectById = (id: string) => PROJECTS.find((entry) => entry.id === id);
  const isScratchProject = (entry: { workspaceRoot: string }) =>
    entry.workspaceRoot === SCRATCH_ROOT;

  it("puts the own project first, then thread links, then its project's links", () => {
    const own = { ...project("upcomputer", "UpComputer"), linkedProjectIds: ["docs"] };
    const stack = resolveThreadProjectIconStack({
      thread: { environmentId, linkedProjectIds: ["site", "docs", "missing"] },
      ownProject: own,
      projectById,
      isScratchProject,
    });
    expect(stack.allProjects.map((entry) => entry.id)).toEqual(["upcomputer", "site", "docs"]);
    expect(stack.showScratchIcon).toBe(false);
  });

  it("folds a project nested in another listed project into it", () => {
    const nested = project("web", "Web", "/work/upcomputer/apps/web");
    const stack = resolveThreadProjectIconStack({
      thread: { environmentId, linkedProjectIds: ["web"] },
      ownProject: project("upcomputer", "UpComputer"),
      projectById: (id) => (id === "web" ? nested : projectById(id)),
      isScratchProject,
    });
    expect(stack.allProjects.map((entry) => entry.id)).toEqual(["upcomputer"]);
  });
});
