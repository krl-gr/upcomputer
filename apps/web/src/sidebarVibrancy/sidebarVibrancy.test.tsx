import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

// Unit tests see core with upstream's surfaces; this file switches to the
// UpComputer product's per test.
const product = vi.hoisted(() => ({ upcomputer: true }));
vi.mock("../product/productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("../product/WebProduct");
  const { UPCOMPUTER_PRODUCT_SURFACES, UPSTREAM_PRODUCT_SURFACES } =
    await import("@t3tools/shared/productFlags");
  return {
    WEB_PRODUCT: {
      ...composeExperimentalWebFeatures([]),
      get surfaces() {
        return product.upcomputer ? UPCOMPUTER_PRODUCT_SURFACES : UPSTREAM_PRODUCT_SURFACES;
      },
    },
  };
});

import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Page } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite-plus";

import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../components/ui/sidebar";
import {
  getThemeColorsForMode,
  getThemeColorVariable,
  T3_CHAT_THEME,
  themeColorToHex,
  UPCOMPUTER_THEME,
  type ThemeDefinition,
} from "../themePalette";
import { SIDEBAR_VIBRANCY_ATTRIBUTE, showsSidebarVibrancy } from "./sidebarVibrancy";

afterEach(() => {
  product.upcomputer = true;
});

describe("sidebarVibrancy surface", () => {
  it("marks only the macOS renderer of the UpComputer product", () => {
    expect(showsSidebarVibrancy("MacIntel")).toBe(true);
    for (const platform of ["Win32", "Linux x86_64", ""]) {
      expect(showsSidebarVibrancy(platform)).toBe(false);
    }
    product.upcomputer = false;
    expect(showsSidebarVibrancy("MacIntel")).toBe(false);
  });
});

const WEB_ROOT = NodeURL.fileURLToPath(new URL("../..", import.meta.url));

/** The app stylesheet, compiled by the app's Tailwind plugin over the app's sources. */
async function compileAppCss(): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: WEB_ROOT,
    logLevel: "silent",
    appType: "custom",
    // Off the app's own cache, which the dev server uses.
    cacheDir: `${NodeOS.tmpdir()}/upcomputer-sidebar-vibrancy-vite`,
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

/** Upstream's sidebar layout as AppSidebarLayout composes it: one selected row with a status pulse. */
const LAYOUT = renderToStaticMarkup(
  <SidebarProvider>
    <Sidebar side="left" collapsible="offcanvas" data-app-sidebar="">
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>
              <span className="size-2 rounded-full bg-info animate-status-pulse" data-pulse />
              <span>Review the release</span>
            </SidebarMenuButton>
            <div className="border-l border-sidebar-border" data-sub-border />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
    <SidebarInset className="h-dvh" />
  </SidebarProvider>,
);

interface Document {
  readonly theme: ThemeDefinition;
  readonly mode: "light" | "dark";
  readonly electron?: boolean;
  readonly vibrancy?: boolean;
}

/** The page as the desktop app has it: the palette and the chrome color inline, as the boot script and useTheme set them. */
function documentHtml(css: string, input: Document): string {
  const colors = getThemeColorsForMode(input.theme, input.mode)!;
  const variables = Object.entries(colors)
    .map(([role, value]) => `${getThemeColorVariable(role as keyof typeof colors)}:${value}`)
    .join(";");
  const chrome = `background-color:${colors.chrome}`;
  const classes = [input.mode, input.electron === false ? null : "electron"].filter(Boolean);
  const vibrancy = input.vibrancy === false ? "" : SIDEBAR_VIBRANCY_ATTRIBUTE;
  return `<!doctype html><html data-theme-id="${input.theme.id}" class="${classes.join(" ")}" ${vibrancy} style="${variables};${chrome}"><head><style>${css}</style></head><body style="${chrome}"><div id="root">${LAYOUT}</div></body></html>`;
}

/** A computed color as 0-255 channels and alpha. */
type Rgba = readonly [number, number, number, number];

interface Painted {
  readonly htmlAlpha: number;
  readonly bodyAlpha: number;
  readonly sidebar: Rgba;
  readonly sidebarFilter: string;
  readonly row: Rgba;
  readonly edge: Rgba;
  readonly border: Rgba;
  readonly text: Rgba;
  readonly insetAlpha: number;
  readonly pulseAnimation: string;
}

/** Runs in the page: each layer's own colors, the sidebar filter, and the pulse's animation. */
function measurePainted(): Painted {
  // Chromium keeps a computed color in its own space (oklch, srgb, rgb); mixing
  // it in srgb normalizes it to `color(srgb r g b / a)`.
  const probe = document.body.appendChild(document.createElement("i"));
  const toRgba = (color: string): Rgba => {
    probe.style.color = `color-mix(in srgb, ${color} 100%, transparent)`;
    const [, r, g, b, a] = /^color\(srgb (\S+) (\S+) (\S+)(?: \/ (\S+))?\)$/.exec(
      getComputedStyle(probe).color,
    )!;
    return [Number(r) * 255, Number(g) * 255, Number(b) * 255, a === undefined ? 1 : Number(a)];
  };
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
  const sidebar = style('[data-slot="sidebar-inner"]');
  const painted: Painted = {
    htmlAlpha: toRgba(style("html").backgroundColor)[3],
    bodyAlpha: toRgba(style("body").backgroundColor)[3],
    sidebar: toRgba(sidebar.backgroundColor),
    sidebarFilter: sidebar.backdropFilter,
    row: toRgba(style('[data-sidebar="menu-button"]').backgroundColor),
    edge: toRgba(style("[data-app-sidebar]").borderRightColor),
    border: toRgba(style("[data-sub-border]").borderLeftColor),
    text: toRgba(style('[data-sidebar="menu-button"]').color),
    insetAlpha: toRgba(style('[data-slot="sidebar-inset"]').backgroundColor)[3],
    pulseAnimation: style("[data-pulse]").animationName,
  };
  probe.remove();
  return painted;
}

/** The alpha the page leaves at a point, over a transparent window: what the vibrancy shows through. */
async function windowAlphaAt(page: Page, x: number, y: number): Promise<number> {
  const png = await page.screenshot({ omitBackground: true, clip: { x, y, width: 1, height: 1 } });
  // An image without any transparency is written as RGB (IHDR color type 2).
  if (png[25] !== 6) return 1;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  // One RGBA pixel after the row's filter byte; every filter leaves a lone pixel as is.
  return NodeZlib.inflateSync(Buffer.concat(chunks))[4]! / 255;
}

const rgbaOf = (value: string, alpha = 1): Rgba => {
  const hex = themeColorToHex(value)!;
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return [r!, g!, b!, alpha];
};

/** Within one 8-bit step: Chromium stores a computed alpha in 1/255 steps. */
function expectColor(actual: Rgba, expected: Rgba): void {
  actual.forEach((channel, index) => {
    const step = index === 3 ? 1 / 255 : 1;
    expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(step);
  });
}

/** V1's sidebar (`upcomputer` checkout, theme.upcomputer.css) in each mode. */
const V1_SIDEBAR = {
  light: { sidebar: [255, 255, 255, 0.25], ink: [0, 0, 0] },
  dark: {
    sidebar: rgbaOf(getThemeColorsForMode(UPCOMPUTER_THEME, "dark")!.canvas, 0.34),
    ink: [255, 255, 255],
  },
} as const;

function expectV1Sidebar(painted: Painted, mode: "light" | "dark"): void {
  const v1 = V1_SIDEBAR[mode];
  const [r, g, b] = v1.ink;
  expect(painted.htmlAlpha).toBe(0);
  expect(painted.bodyAlpha).toBe(0);
  expect(painted.insetAlpha).toBe(1);
  expectColor(painted.sidebar, v1.sidebar);
  expect(painted.sidebarFilter).toBe("blur(28px) saturate(1.25)");
  expectColor(painted.row, [r, g, b, mode === "light" ? 0.05 : 0.07]);
  expectColor(painted.edge, [r, g, b, mode === "light" ? 0.04 : 0.03]);
  expectColor(painted.border, [r, g, b, 0.1]);
  expectColor(painted.text, rgbaOf(getThemeColorsForMode(UPCOMPUTER_THEME, mode)!.text));
  expect(painted.pulseAnimation).toBe("none");
}

const browser = await launchBrowser();

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(browser === null)("sidebar vibrancy CSS (real styles in Chromium)", () => {
  let css: string;
  let page: Page;

  beforeAll(async () => {
    css = await compileAppCss();
    page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  }, 60_000);

  afterAll(async () => {
    await page?.close();
  });

  async function paint(input: Document): Promise<Painted> {
    await page.setContent(documentHtml(css, input));
    return page.evaluate(measurePainted);
  }

  /** What useTheme does on a theme switch: applyThemePalette's id and variables, and the mode class. */
  async function switchTheme(theme: ThemeDefinition, mode: "light" | "dark"): Promise<Painted> {
    await page.evaluate(
      ({ id, dark, variables }) => {
        const root = document.documentElement;
        root.dataset.themeId = id;
        root.classList.toggle("dark", dark);
        for (const [name, value] of variables) root.style.setProperty(name, value);
      },
      {
        id: theme.id,
        dark: mode === "dark",
        variables: Object.entries(getThemeColorsForMode(theme, mode)!).map(
          ([role, value]) => [getThemeColorVariable(role as never), value] as const,
        ),
      },
    );
    return page.evaluate(measurePainted);
  }

  it.each(["light", "dark"] as const)(
    "paints the %s Up.computer sidebar with V1's values, and only the sidebar shows the window",
    async (mode) => {
      const painted = await paint({ theme: UPCOMPUTER_THEME, mode });
      expectV1Sidebar(painted, mode);
      expect(await windowAlphaAt(page, 100, 400)).toBeCloseTo(painted.sidebar[3], 1);
      expect(await windowAlphaAt(page, 800, 400)).toBe(1);
    },
  );

  it.each([
    ["light", "dark"],
    ["dark", "light"],
  ] as const)(
    "paints opaque on another theme and restores V1's values on the way back (%s, then %s)",
    async (first, second) => {
      await paint({ theme: UPCOMPUTER_THEME, mode: first });
      const other = await switchTheme(T3_CHAT_THEME, first);
      expect(other).toMatchObject({ htmlAlpha: 1, bodyAlpha: 1, sidebarFilter: "none" });
      expect(other.sidebar[3]).toBe(1);
      expect(other.pulseAnimation).not.toBe("none");
      expect(await windowAlphaAt(page, 100, 400)).toBe(1);

      for (const mode of [first, second]) {
        expectV1Sidebar(await switchTheme(UPCOMPUTER_THEME, mode), mode);
        expect(await windowAlphaAt(page, 100, 400)).toBeCloseTo(V1_SIDEBAR[mode].sidebar[3], 1);
      }
    },
  );

  it("keeps the sidebar opaque outside the macOS desktop app", async () => {
    for (const input of [
      { theme: UPCOMPUTER_THEME, mode: "light", electron: false },
      { theme: UPCOMPUTER_THEME, mode: "dark", vibrancy: false },
    ] as const) {
      const painted = await paint(input);
      expect(painted).toMatchObject({ htmlAlpha: 1, bodyAlpha: 1, sidebarFilter: "none" });
      expect(painted.sidebar[3]).toBe(1);
      expect(await windowAlphaAt(page, 100, 400)).toBe(1);
    }
  });
});
