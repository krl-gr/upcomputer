import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

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

// The UpComputer build: its flags and surfaces, and the Tasks feature's
// navigation. Its run count badges load data, so they stay out; they sit at
// the right end of a row and do not move the left edges measured here.
vi.mock("../product/productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("../product/WebProduct");
  const { TASKS_WEB_FEATURE } = await import("@t3tools/tasks-web/feature");
  const { UPCOMPUTER_PRODUCT_FLAGS, UPCOMPUTER_PRODUCT_SURFACES } =
    await import("@t3tools/shared/productFlags");
  const { threadRowAccessory: _row, chatHeaderAccessory: _header, ...tasks } = TASKS_WEB_FEATURE;
  return {
    WEB_PRODUCT: composeExperimentalWebFeatures(
      [
        {
          ...tasks,
          navigation: (tasks.navigation ?? []).map(({ id, label, path, order, icon }) => ({
            id,
            label,
            path,
            order,
            icon,
          })),
        },
      ],
      { flags: UPCOMPUTER_PRODUCT_FLAGS, surfaces: UPCOMPUTER_PRODUCT_SURFACES },
    ),
  };
});
vi.mock("@tanstack/react-router", () => ({
  useLocation: (options: { select: (location: { pathname: string }) => string }) =>
    options.select({ pathname: "/tasks" }),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
}));
// A box of the size the caller asks for, where the project's icon would load.
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: (props: { className?: string }) => (
    <span data-project-icon className={`inline-block ${props.className ?? ""}`} />
  ),
}));
const environmentId = "env-local";
vi.mock("../state/entities", () => ({
  useServerConfigs: () => new Map([["env-local", { scratchWorkspaceRoot: "/home/scratch" }]]),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-local" }));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => () => undefined }));
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: (current: string | null) => current,
    startScratchThread: () => undefined,
  }),
}));

import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser } from "playwright-core";
import { createServer } from "vite-plus";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { SidebarCompactThreadRowProps } from "../sidebarThreadRow/SidebarCompactThreadRow";

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarContent, SidebarGroup, SidebarProvider } = await import("../components/ui/sidebar");
const { SidebarThreadHeader } = await import("../components/sidebar/SidebarThreadHeader");
const { ProductSidebarNavigation } = await import("../product/ProductSlots");
const { SidebarProjectsSection } = await import("../sidebarProjects/SidebarProjectsSection");
const { SidebarThreadsSectionHeader } = await import("../sidebarProjects/SidebarThreadsSection");
const { SidebarCompactThreadRow } = await import("../sidebarThreadRow/SidebarCompactThreadRow");

const WEB_ROOT = NodeURL.fileURLToPath(new URL("../..", import.meta.url));

function project(id: string, title: string, workspaceRoot = `/work/${id}`) {
  const member = { environmentId, id, workspaceRoot, title };
  return {
    ...member,
    projectKey: `key-${id}`,
    displayName: title,
    memberProjects: [member],
    memberProjectRefs: [{ environmentId, projectId: id }],
  } as unknown as SidebarProjectSnapshot;
}

// Three preview rows, the scratch project as "No project", and one under "More".
const PROJECTS = [
  project("upcomputer", "UpComputer"),
  project("scratch", "scratch", "/home/scratch"),
  project("site", "Site"),
  project("docs", "Docs"),
  project("infra", "Infra"),
];

const THREAD_TITLES = ["Review the release", "Port the sidebar", "Plan the cutover"];

function threadRow(title: string, index: number): SidebarCompactThreadRowProps {
  const at = new Date(Date.now() - (index + 1) * 60 * 60 * 1000).toISOString();
  const noop = () => undefined;
  return {
    thread: {
      id: `thread-${index}`,
      environmentId,
      projectId: "upcomputer",
      title,
      lastVisitedAt: at,
      latestRun: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      runtime: null,
      latestUserMessageAt: at,
      updatedAt: at,
      titleRegeneration: null,
    } as unknown as SidebarCompactThreadRowProps["thread"],
    variantAction: "settle",
    isPinned: false,
    dropVerb: null,
    sweepAction: null,
    snoozeWakeLabelText: null,
    isActive: index === 0,
    jumpLabel: null,
    project: { id: "upcomputer" } as unknown as SidebarCompactThreadRowProps["project"],
    projectDisplayName: "UpComputer",
    isRenaming: false,
    renamingTitle: "",
    onThreadClick: noop,
    onThreadActivate: noop,
    onStartRename: noop,
    onRenameTitleChange: noop,
    onCommitRename: noop,
    onCancelRename: noop,
    onContextMenu: noop,
  };
}

/**
 * The sidebar's composition (`components/Sidebar.tsx`): upstream's fixed
 * header group with the Search row and our sections after it, then the thread
 * list group with upstream's list classes, holding our compact rows.
 */
function SidebarUnderTest() {
  const noop = () => undefined;
  return (
    <SidebarProvider>
      <div data-sidebar-under-test className="flex h-[48rem] w-64 flex-col bg-sidebar">
        <SidebarContent
          fixedHeader={
            <SidebarGroup className="z-[1]">
              <SidebarThreadHeader
                hasProjects
                projectScope={null}
                onNewProject={noop}
                onNewThread={noop}
                newThreadDisabled={false}
                newThreadShortcutLabel={null}
                newThreadInProjectShortcutLabel={null}
                showNewThreadInProjectHint={false}
                searchInputRef={{ current: null }}
                searchQuery=""
                onSearchQueryChange={noop}
                onSearchKeyDown={noop}
                isSearching={false}
                searchResultCount={0}
                activeSearchResultIndex={0}
                onClearSearch={noop}
              />
              <ProductSidebarNavigation />
              <SidebarProjectsSection projectGroups={PROJECTS} onAddProject={noop} />
              <SidebarThreadsSectionHeader
                onNewThread={noop}
                currentEnvironmentId={null}
                newThreadDisabled={false}
                newThreadShortcutLabel={null}
              />
            </SidebarGroup>
          }
        >
          <SidebarGroup className="flex-1" role="presentation">
            <ul role="presentation" className="relative flex flex-1 flex-col gap-px">
              {THREAD_TITLES.map((title, index) => (
                <SidebarCompactThreadRow key={title} {...threadRow(title, index)} />
              ))}
            </ul>
          </SidebarGroup>
        </SidebarContent>
      </div>
    </SidebarProvider>
  );
}

async function renderSidebarMarkup(): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SidebarUnderTest />);
  });
  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return html;
}

/** The app stylesheet, compiled by the app's Tailwind plugin over the app's sources. */
async function compileAppCss(): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: WEB_ROOT,
    logLevel: "silent",
    appType: "custom",
    // Off the app's own cache, which the dev server uses.
    cacheDir: `${NodeOS.tmpdir()}/upcomputer-sidebar-alignment-vite`,
    plugins: [tailwindcss()],
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const module = await server.ssrLoadModule("/src/index.css?inline");
    return module.default as string;
  } finally {
    await server.close();
  }
}

/** Prefers the installed Chrome, then Playwright's Chromium. */
async function launchBrowser(): Promise<Browser | null> {
  for (const channel of ["chrome", undefined]) {
    try {
      return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    } catch {
      // Try the next browser.
    }
  }
  return null;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}
interface MeasuredRow {
  readonly name: string;
  readonly row: Box;
  readonly icon: Box | null;
  readonly label: Box;
}

/** Runs in the page: the row, icon and label boxes of each named row, relative to the sidebar. */
function measureRows(names: ReadonlyArray<string>): MeasuredRow[] {
  const sidebar = document.querySelector("[data-sidebar-under-test]")!.getBoundingClientRect();
  const box = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - sidebar.left,
      top: rect.top - sidebar.top,
      bottom: rect.bottom - sidebar.top,
    };
  };
  const leaves = [...document.querySelectorAll("span, input")].filter(
    (element) => element.childElementCount === 0,
  );
  return names.map((name) => {
    if (name === "Search") {
      const input = document.querySelector('input[aria-label="Search threads"]')!;
      let row = input.parentElement!;
      while (row.querySelector("svg") === null) row = row.parentElement!;
      return { name, row: box(row), icon: box(row.querySelector("svg")!), label: box(input) };
    }
    const label = leaves.find((element) => element.textContent === name);
    if (label === undefined) throw new Error(`No row labelled "${name}"`);
    const row = label.closest('[data-sidebar="menu-button"], [data-testid="sidebar-row-compact"]');
    if (row === null) {
      // A section header has no icon: its title starts where icons do. Its row
      // is the header, the toggle's parent.
      const header = label.closest("button[aria-expanded]")!.parentElement!;
      return { name, row: box(header), icon: null, label: box(label) };
    }
    const icon = row.querySelector("svg, [data-project-icon]")!;
    return { name, row: box(row), icon: box(icon), label: box(label) };
  });
}

const NAV = ["Tasks", "Agents", "Automations"];
const PROJECT_ROWS = ["All projects", "UpComputer", "Site", "Docs", "No project", "More"];
const ROWS = ["Search", ...NAV, "Projects", ...PROJECT_ROWS, "Threads", ...THREAD_TITLES];

/** The space between each row and the next, rounded to 0.1px. */
const gapsBetween = (rows: ReadonlyArray<MeasuredRow>) =>
  rows.slice(1).map((row, index) => Math.round((row.row.top - rows[index]!.row.bottom) * 10) / 10);

const expectWithinPixel = (what: string, actual: number, expected: number) =>
  expect(
    Math.abs(actual - expected),
    `${what} at ${actual}px, expected ${expected}px`,
  ).toBeLessThanOrEqual(1);

const browser = await launchBrowser();

describe.skipIf(browser === null)("sidebar alignment (real layout in Chromium)", () => {
  let rows: Map<string, MeasuredRow>;

  beforeAll(async () => {
    const [markup, css] = await Promise.all([renderSidebarMarkup(), compileAppCss()]);
    const page = await browser!.newPage({ viewport: { width: 800, height: 900 } });
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body>${markup}</body></html>`,
    );
    rows = new Map((await page.evaluate(measureRows, ROWS)).map((row) => [row.name, row]));
    await page.close();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const row = (name: string) => rows.get(name)!;

  it("starts every row's icon and label where the Search row's do", () => {
    const search = row("Search");
    for (const name of ROWS) {
      const measured = row(name);
      if (measured.icon === null) {
        // Section headers: the title starts at the icon edge.
        expectWithinPixel(`${name} title`, measured.label.left, search.icon!.left);
      } else {
        expectWithinPixel(`${name} icon`, measured.icon.left, search.icon!.left);
        expectWithinPixel(`${name} label`, measured.label.left, search.label.left);
      }
    }
  });

  it("spaces the rows of every section alike, the thread rows included", () => {
    const rowGaps = [NAV, PROJECT_ROWS, THREAD_TITLES].flatMap((names) =>
      gapsBetween(names.map(row)),
    );
    expect(new Set(rowGaps)).toEqual(new Set([rowGaps[0]]));
    expect(rowGaps[0]).toBeGreaterThan(0);
    // A section header sits the same row gap above its first row.
    expect(gapsBetween([row("Projects"), row("All projects")])).toEqual([rowGaps[0]]);
    expect(gapsBetween([row("Threads"), row(THREAD_TITLES[0]!)])).toEqual([rowGaps[0]]);
  });

  it("puts one gap between Search, the nav rows, Projects and Threads", () => {
    const sectionGaps = gapsBetween([row("Search"), row("Tasks")])
      .concat(gapsBetween([row("Automations"), row("Projects")]))
      .concat(gapsBetween([row("More"), row("Threads")]));
    expect(sectionGaps).toEqual([sectionGaps[0], sectionGaps[0], sectionGaps[0]]);
    expect(sectionGaps[0]).toBeGreaterThan(0);
  });
});
