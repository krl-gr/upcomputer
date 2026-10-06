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
  // Upstream's sidebar measures its brand; the markup is measured in Chromium instead.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
  // Base UI's scroll area asks for running animations, which jsdom does not track.
  window.Element.prototype.getAnimations = () => [];
});

// The UpComputer build: its flags and surfaces, and the Tasks feature's
// navigation. Its run count badges load data, so they stay out; they sit at
// the right end of a row and do not move the left edges measured here.
// `product.upstreamSurfaces` switches to upstream's surfaces for one render.
const product = vi.hoisted(() => ({ upstreamSurfaces: false }));
vi.mock("../product/productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("../product/WebProduct");
  const { TASKS_WEB_FEATURE } = await import("@t3tools/tasks-web/feature");
  const { UPCOMPUTER_PRODUCT_FLAGS, UPCOMPUTER_PRODUCT_SURFACES, UPSTREAM_PRODUCT_SURFACES } =
    await import("@t3tools/shared/productFlags");
  const { threadRowAccessory: _row, chatHeaderAccessory: _header, ...tasks } = TASKS_WEB_FEATURE;
  const composed = composeExperimentalWebFeatures(
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
  );
  return {
    WEB_PRODUCT: {
      ...composed,
      get surfaces() {
        return product.upstreamSurfaces ? UPSTREAM_PRODUCT_SURFACES : composed.surfaces;
      },
    },
  };
});
vi.mock("@tanstack/react-router", () => ({
  useLocation: (options: { select: (location: { pathname: string }) => string }) =>
    options.select({ pathname: "/tasks" }),
  useNavigate: () => () => undefined,
  useParams: (options: { select: (params: object) => unknown }) => options.select({}),
  useRouter: () => ({ navigate: () => undefined }),
  Link: (props: { className?: string; children?: ReactNode; "aria-label"?: string }) => (
    <a aria-label={props["aria-label"]} className={props.className}>
      {props.children}
    </a>
  ),
}));
// Upstream's layout renders the thread sidebar (`components/Sidebar.tsx`); it is
// replaced by the same composition with the data filled in (`ThreadSidebarUnderTest`).
const threadSidebar = vi.hoisted(() => ({ render: (): unknown => null }));
vi.mock("../components/Sidebar", () => ({ default: () => threadSidebar.render() }));
vi.mock("../components/LegacySidebar", () => ({ default: () => null }));
vi.mock("../components/settings/SettingsSidebarNav", () => ({ SettingsSidebarNav: () => null }));
// A box of the size the caller asks for, where the project's icon would load.
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: (props: { className?: string }) => (
    <span data-project-icon className={`inline-block ${props.className ?? ""}`} />
  ),
}));
const environmentId = "env-local";
vi.mock("../state/entities", () => ({
  useServerConfigs: () => new Map([["env-local", { scratchWorkspaceRoot: "/home/scratch" }]]),
  useProjects: () => [],
}));
vi.mock("../hooks/useThreadVisitedMigration", () => ({
  useThreadVisitedMigration: () => undefined,
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
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer } from "vite-plus";

import type { ReactElement, ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { SidebarCompactThreadRowProps } from "../sidebarThreadRow/SidebarCompactThreadRow";

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarContent, SidebarGroup, SidebarProvider } = await import("../components/ui/sidebar");
const { AppSidebarLayout } = await import("../components/AppSidebarLayout");
const { SidebarChromeHeader } = await import("../components/sidebar/SidebarChrome");
const { SidebarThreadHeader } = await import("../components/sidebar/SidebarThreadHeader");
const { ProductSidebarNavigation } = await import("../product/ProductSlots");
const { SidebarProjectsSection } = await import("../sidebarProjects/SidebarProjectsSection");
const { SidebarThreadsSectionHeader } = await import("../sidebarProjects/SidebarThreadsSection");
const { SidebarCompactThreadRow } = await import("../sidebarThreadRow/SidebarCompactThreadRow");
const { WorkspaceViewLayout } = await import("@t3tools/tasks-web");
const { getThemeColorsForMode, getThemeColorVariable, UPCOMPUTER_THEME } =
  await import("../themePalette");

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
 * The thread sidebar's composition (`components/Sidebar.tsx`): upstream's
 * chrome header, its fixed header group with the Search row and our sections
 * after it, then the thread list group with upstream's list classes, holding
 * our compact rows. Upstream's layout around it adds the sidebar toggle.
 */
function ThreadSidebarUnderTest() {
  const noop = () => undefined;
  return (
    <>
      <SidebarChromeHeader isElectron={false} />
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
    </>
  );
}

threadSidebar.render = () => <ThreadSidebarUnderTest />;

function SearchRowUnderTest() {
  const noop = () => undefined;
  return (
    <SidebarProvider>
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
    </SidebarProvider>
  );
}

function SidebarUnderTest() {
  return (
    <AppSidebarLayout>
      <main />
    </AppSidebarLayout>
  );
}

async function renderMarkup(element: ReactElement): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
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

let appCss: Promise<string> | undefined;
const compiledAppCss = () => (appCss ??= compileAppCss());

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
  const sidebar = document.querySelector('[data-slot="sidebar-inner"]')!.getBoundingClientRect();
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

interface MeasuredHeader {
  /** The sidebar toggle's icon, relative to the sidebar. */
  readonly toggleIconLeft: number;
  readonly headerHeight: number;
  readonly topbarHeight: number;
  readonly hasBrand: boolean;
}

/** Runs in the page: upstream's sidebar toggle and the chrome header above the Search row. */
function measureHeader(): MeasuredHeader {
  const sidebar = document.querySelector('[data-slot="sidebar-inner"]')!;
  const toggleIcon = document.querySelector('[data-sidebar-control] [data-sidebar="trigger"] svg')!;
  const header = sidebar.firstElementChild!;
  const probe = document.createElement("div");
  probe.style.height = "var(--workspace-topbar-height)";
  sidebar.append(probe);
  const topbarHeight = probe.getBoundingClientRect().height;
  probe.remove();
  return {
    toggleIconLeft: toggleIcon.getBoundingClientRect().left - sidebar.getBoundingClientRect().left,
    headerHeight: header.getBoundingClientRect().height,
    topbarHeight,
    hasBrand:
      header.querySelector('a[aria-label="Go to threads"]') !== null ||
      header.textContent!.includes("Up.computer") ||
      header.querySelector("[data-environment-identification]") !== null,
  };
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

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(browser === null)("sidebar alignment (real layout in Chromium)", () => {
  let page: Page;
  let rows: Map<string, MeasuredRow>;
  let header: MeasuredHeader;

  beforeAll(async () => {
    const [markup, css] = await Promise.all([renderMarkup(<SidebarUnderTest />), compiledAppCss()]);
    page = await browser!.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body>${markup}</body></html>`,
    );
    rows = new Map((await page.evaluate(measureRows, ROWS)).map((row) => [row.name, row]));
    header = await page.evaluate(measureHeader);
  }, 60_000);

  afterAll(async () => {
    await page?.close();
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

  it("continues the Search row into the nav rows at the row gap", () => {
    expect(gapsBetween([row("Search"), row("Tasks")])).toEqual(
      gapsBetween(NAV.map(row)).slice(0, 1),
    );
  });

  it("puts one gap between the nav rows, Projects and Threads", () => {
    const sectionGaps = gapsBetween([row("Automations"), row("Projects")]).concat(
      gapsBetween([row("More"), row("Threads")]),
    );
    expect(sectionGaps).toEqual([sectionGaps[0], sectionGaps[0]]);
    expect(sectionGaps[0]).toBeGreaterThan(gapsBetween(NAV.map(row))[0]!);
  });

  it("starts the sidebar toggle's icon where the row icons do", () => {
    expectWithinPixel("sidebar toggle icon", header.toggleIconLeft, row("Search").icon!.left);
  });

  it("shows no brand or stage badge above Search, in a titlebar-high header", () => {
    expect(header.hasBrand).toBe(false);
    expect(header.topbarHeight).toBeGreaterThan(0);
    expectWithinPixel("header height", header.headerHeight, header.topbarHeight);
  });

  /** The computed colour of an element in the sidebar. */
  const colorOf = (selector: string) =>
    page.$eval(selector, (element) => getComputedStyle(element).color);
  const opacityOf = (selector: string) =>
    page.$eval(selector, (element) => getComputedStyle(element).opacity);
  /** The colour `text-foreground` gives, read off a probe in the sidebar. */
  const brightColor = () =>
    page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-foreground";
      document.querySelector('[data-slot="sidebar-inner"]')!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
  const pointAt = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };

  it("keeps every icon button dim until the pointer is on that button", async () => {
    // The section titles' dim tone, read while nothing is hovered.
    await page.mouse.move(1100, 800);
    const dim = await colorOf('[data-testid="sidebar-threads-toggle"]');
    const bright = await brightColor();
    expect(dim).not.toBe(bright);
    const buttons = [
      {
        reveal: '[data-testid="sidebar-threads-toggle"]',
        button: 'button[aria-label="New thread"]',
      },
      {
        reveal: '[data-testid="sidebar-projects-toggle"]',
        button: 'button[aria-label="Add project"]',
      },
      {
        reveal: '[data-sidebar="menu-button"]:has-text("UpComputer")',
        button:
          '[data-sidebar="menu-button"]:has-text("UpComputer") [data-testid="sidebar-project-row-actions"] button >> nth=0',
      },
      {
        reveal: '[data-sidebar="menu-button"]:has-text("UpComputer")',
        button:
          '[data-sidebar="menu-button"]:has-text("UpComputer") [data-testid="sidebar-project-row-actions"] button >> nth=1',
      },
      {
        reveal: '[data-testid="sidebar-row-compact"]:has-text("Port the sidebar")',
        button: 'button[aria-label="Thread actions for Port the sidebar"]',
      },
    ];
    for (const { reveal, button } of buttons) {
      await pointAt(reveal);
      expect(await opacityOf(button), `${button} revealed`).toBe("1");
      expect(await colorOf(button), `${button} with its row hovered`).toBe(dim);
      await pointAt(button);
      expect(await colorOf(button), `${button} hovered`).toBe(bright);
    }
  });
});

/** The `<html>` attributes `applyThemePalette` sets for the Up.computer theme in `mode`. */
function upcomputerThemeRoot(mode: "light" | "dark"): string {
  const colors = getThemeColorsForMode(UPCOMPUTER_THEME, mode)!;
  const variables = Object.entries(colors)
    .map(([role, value]) => `${getThemeColorVariable(role as keyof typeof colors)}:${value}`)
    .join(";");
  return `data-theme-id="${UPCOMPUTER_THEME.id}" class="${mode}" style="${variables}"`;
}

interface MeasuredText {
  readonly color: string;
  readonly weight: string;
  /** The colour as painted on the sidebar background, in sRGB channels. */
  readonly painted: ReadonlyArray<number>;
  /** WCAG contrast of `painted` against the sidebar background. */
  readonly contrast: number;
}

/**
 * Runs in the page: the text colour and weight of each named row label, the
 * Search row's placeholder for "Search", and V1's row tone (`text-foreground`
 * at `alpha`), each painted on the sidebar background.
 */
function measureText(input: { readonly names: ReadonlyArray<string>; readonly alpha: number }) {
  const sidebar = document.querySelector('[data-slot="sidebar-inner"]')!;
  const background = getComputedStyle(sidebar).backgroundColor;
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const paint = (color: string, alpha = 1) => {
    context.globalAlpha = 1;
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.subarray(0, 3));
  };
  const luminance = (channels: ReadonlyArray<number>) =>
    channels
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const backgroundLuminance = luminance(paint(background));
  const measure = (style: CSSStyleDeclaration): MeasuredText => {
    const painted = paint(style.color);
    const [lighter, darker] = [luminance(painted), backgroundLuminance].toSorted((a, b) => b - a);
    return {
      color: style.color,
      weight: style.fontWeight,
      painted,
      contrast: (lighter! + 0.05) / (darker! + 0.05),
    };
  };
  const leaves = [...document.querySelectorAll("span")].filter(
    (element) => element.childElementCount === 0,
  );
  const probe = document.createElement("span");
  probe.className = "text-foreground";
  sidebar.append(probe);
  const v1Row = paint(getComputedStyle(probe).color, input.alpha);
  probe.remove();
  const text = Object.fromEntries(
    input.names.map((name) => {
      if (name === "Search") {
        const search = document.querySelector('input[aria-label="Search threads"]')!;
        return [name, measure(getComputedStyle(search, "::placeholder"))];
      }
      const label = leaves.find((element) => element.textContent === name);
      if (label === undefined) throw new Error(`No row labelled "${name}"`);
      return [name, measure(getComputedStyle(label))];
    }),
  );
  return { text, v1Row };
}

// Inactive rows of each kind; "Tasks", "All projects" and the first thread are active.
const RESTING_ROWS = ["Agents", "Automations", "UpComputer", "Site", "No project", "More"];
const RESTING_THREADS = THREAD_TITLES.slice(1);

describe.skipIf(browser === null)("sidebar text under the Up.computer theme (Chromium)", () => {
  // V1's row text: `text-foreground/72`, and `/82` in dark.
  it.each([
    ["light", 0.72],
    ["dark", 0.82],
  ] as const)(
    "gives Search and every resting row one tone and weight, in %s",
    async (mode, alpha) => {
      const [markup, css] = await Promise.all([
        renderMarkup(<SidebarUnderTest />),
        compiledAppCss(),
      ]);
      const page = await browser!.newPage({ viewport: { width: 1200, height: 900 } });
      try {
        await page.setContent(
          `<!doctype html><html ${upcomputerThemeRoot(mode)}><head><style>${css}</style></head><body>${markup}</body></html>`,
        );
        await page.mouse.move(1100, 800);
        const { text, v1Row } = await page.evaluate(measureText, {
          names: ["Search", ...RESTING_ROWS, ...RESTING_THREADS, "Projects", "Threads"],
          alpha,
        });
        const search = text.Search!;
        for (const name of [...RESTING_ROWS, ...RESTING_THREADS]) {
          expect(text[name]!.color, `${name} colour`).toBe(search.color);
          expect(text[name]!.weight, `${name} weight`).toBe(search.weight);
        }
        expect(search.weight).toBe("400");
        // The theme's sidebar muted foreground is V1's row tone.
        search.painted.forEach((channel, index) =>
          expect(Math.abs(channel - v1Row[index]!), `channel ${index}`).toBeLessThanOrEqual(2),
        );
        // Section titles stay a step dimmer than the rows.
        for (const title of ["Projects", "Threads"]) {
          expect(text[title]!.contrast, `${title} title`).toBeLessThan(search.contrast);
        }
        // Hover and active keep the menu buttons' own look.
        const agents = '[data-sidebar="menu-button"]:has-text("Agents")';
        await page.hover(agents);
        expect(await page.$eval(agents, (row) => getComputedStyle(row).color)).not.toBe(
          search.color,
        );
        const active = await page.$eval(
          '[data-sidebar="menu-button"][data-active="true"]',
          (row) => {
            const style = getComputedStyle(row);
            return { color: style.color, weight: style.fontWeight };
          },
        );
        expect(active.color).not.toBe(search.color);
        expect(active.weight).toBe("500");
      } finally {
        await page.close();
      }
    },
  );

  it("keeps upstream's medium Search row with upstream's surfaces", async () => {
    const css = await compiledAppCss();
    const weight = async () => {
      const markup = await renderMarkup(<SearchRowUnderTest />);
      const page = await browser!.newPage();
      try {
        await page.setContent(
          `<!doctype html><html><head><style>${css}</style></head><body>${markup}</body></html>`,
        );
        return await page.$eval(
          'input[aria-label="Search threads"]',
          (input) => getComputedStyle(input, "::placeholder").fontWeight,
        );
      } finally {
        await page.close();
      }
    };
    expect(await weight()).toBe("400");
    product.upstreamSurfaces = true;
    try {
      expect(await weight()).toBe("500");
    } finally {
      product.upstreamSurfaces = false;
    }
  });
});

/**
 * The Tasks feature's page shell (`WorkspaceViewLayout`) with a title, a
 * control on the right like the Tasks filters, and a table as its content.
 */
function TasksPageUnderTest({ sidebarOpen }: { readonly sidebarOpen: boolean }) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <WorkspaceViewLayout
        title="Tasks"
        toolbar={
          <>
            <span className="min-w-0 flex-1" />
            <button type="button">All statuses</button>
          </>
        }
        onNavigateBack={() => undefined}
      >
        <table data-page-content className="w-full">
          <tbody>
            <tr>
              <td>Row</td>
            </tr>
          </tbody>
        </table>
      </WorkspaceViewLayout>
    </SidebarProvider>
  );
}

interface MeasuredPage {
  readonly headerHeight: number;
  readonly topbarHeight: number;
  readonly titleLeft: number;
  readonly titlebarContentLeft: number;
  readonly controlRight: number;
  readonly contentLeft: number;
  readonly contentRight: number;
}

/** Runs in the page: the page header, its title and control, and the content's edges. */
function measurePage(): MeasuredPage {
  const header = document.querySelector("header")!;
  const content = document.querySelector("[data-page-content]")!.getBoundingClientRect();
  const probe = document.createElement("div");
  probe.style.width = "var(--workspace-titlebar-content-left)";
  header.append(probe);
  const titlebarContentLeft = probe.getBoundingClientRect().width;
  probe.style.width = "var(--workspace-topbar-height)";
  const topbarHeight = probe.getBoundingClientRect().width;
  probe.remove();
  return {
    headerHeight: header.getBoundingClientRect().height,
    topbarHeight,
    titleLeft: header.querySelector("h1")!.getBoundingClientRect().left,
    titlebarContentLeft,
    controlRight: header.querySelector("button")!.getBoundingClientRect().right,
    contentLeft: content.left,
    contentRight: content.right,
  };
}

describe.skipIf(browser === null)("Tasks page header alignment (real layout in Chromium)", () => {
  const pages = new Map<"open" | "collapsed", MeasuredPage>();

  beforeAll(async () => {
    const css = await compiledAppCss();
    for (const state of ["open", "collapsed"] as const) {
      const markup = await renderMarkup(<TasksPageUnderTest sidebarOpen={state === "open"} />);
      const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
      await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body>${markup}</body></html>`,
      );
      pages.set(state, await page.evaluate(measurePage));
      await page.close();
    }
  }, 60_000);

  it("uses the shared top bar height", () => {
    const open = pages.get("open")!;
    expect(open.topbarHeight).toBeGreaterThan(0);
    expectWithinPixel("header height", open.headerHeight, open.topbarHeight);
  });

  it("starts the content under the page title and ends it under the last control", () => {
    const open = pages.get("open")!;
    expect(open.contentLeft).toBeGreaterThan(0);
    expectWithinPixel("content left edge", open.contentLeft, open.titleLeft);
    expectWithinPixel("content right edge", open.contentRight, open.controlRight);
  });

  it("moves the title clear of the shared sidebar toggle when the sidebar is collapsed", () => {
    const collapsed = pages.get("collapsed")!;
    expect(collapsed.titlebarContentLeft).toBeGreaterThan(collapsed.contentLeft);
    expectWithinPixel("collapsed title", collapsed.titleLeft, collapsed.titlebarContentLeft);
    expectWithinPixel(
      "collapsed content left edge",
      collapsed.contentLeft,
      pages.get("open")!.contentLeft,
    );
  });
});
