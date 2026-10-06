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

interface Painted {
  readonly htmlAlpha: number;
  readonly bodyAlpha: number;
  readonly sidebarAlpha: number;
  readonly rowAlpha: number;
  readonly insetAlpha: number;
  readonly pulseAnimation: string;
}

/** Runs in the page: the alpha of each layer's own background, and the pulse's animation. */
function measurePainted(): Painted {
  const alphaOf = (selector: string) => {
    const color = getComputedStyle(document.querySelector(selector)!).backgroundColor;
    const alpha = /\/\s*([\d.]+)\)$/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(color);
    return alpha ? Number(alpha[1]) : color === "transparent" ? 0 : 1;
  };
  return {
    htmlAlpha: alphaOf("html"),
    bodyAlpha: alphaOf("body"),
    sidebarAlpha: alphaOf('[data-slot="sidebar-inner"]'),
    rowAlpha: alphaOf('[data-sidebar="menu-button"]'),
    insetAlpha: alphaOf('[data-slot="sidebar-inset"]'),
    pulseAnimation: getComputedStyle(document.querySelector("[data-pulse]")!).animationName,
  };
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

function contrastRatio(first: readonly number[], second: readonly number[]): number {
  const luminance = (rgb: readonly number[]) =>
    rgb
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

const rgbOf = (value: string) =>
  [1, 3, 5].map(
    (offset) => Number.parseInt(themeColorToHex(value)!.slice(offset, offset + 2), 16) / 255,
  );
const over = (top: readonly number[], alpha: number, bottom: readonly number[]) =>
  top.map((channel, index) => alpha * channel + (1 - alpha) * bottom[index]!);

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

  it.each(["light", "dark"] as const)(
    "lets the %s Up.computer sidebar show the window through, and only the sidebar",
    async (mode) => {
      const painted = await paint({ theme: UPCOMPUTER_THEME, mode });
      expect(painted.htmlAlpha).toBe(0);
      expect(painted.bodyAlpha).toBe(0);
      expect(painted.insetAlpha).toBe(1);
      expect(painted.sidebarAlpha).toBe(mode === "light" ? 0.94 : 0.8);
      expect(painted.pulseAnimation).toBe("none");
      expect(await windowAlphaAt(page, 100, 400)).toBeCloseTo(painted.sidebarAlpha, 1);
      expect(await windowAlphaAt(page, 800, 400)).toBe(1);
    },
  );

  it("paints the page opaque again when another theme is chosen at runtime", async () => {
    await paint({ theme: UPCOMPUTER_THEME, mode: "light" });
    // What applyThemePalette does on a theme switch.
    await page.evaluate(
      ({ id, variables }) => {
        document.documentElement.dataset.themeId = id;
        for (const [name, value] of variables) {
          document.documentElement.style.setProperty(name, value);
        }
      },
      {
        id: T3_CHAT_THEME.id,
        variables: Object.entries(getThemeColorsForMode(T3_CHAT_THEME, "light")!).map(
          ([role, value]) => [getThemeColorVariable(role as never), value] as const,
        ),
      },
    );
    const painted = await page.evaluate(measurePainted);
    expect(painted).toMatchObject({ htmlAlpha: 1, bodyAlpha: 1, sidebarAlpha: 1 });
    expect(painted.pulseAnimation).not.toBe("none");
    expect(await windowAlphaAt(page, 100, 400)).toBe(1);
  });

  it("keeps the sidebar opaque outside the macOS desktop app", async () => {
    for (const input of [
      { theme: UPCOMPUTER_THEME, mode: "light", electron: false },
      { theme: UPCOMPUTER_THEME, mode: "dark", vibrancy: false },
    ] as const) {
      const painted = await paint(input);
      expect(painted).toMatchObject({ htmlAlpha: 1, bodyAlpha: 1, sidebarAlpha: 1 });
      expect(await windowAlphaAt(page, 100, 400)).toBe(1);
    }
  });

  // The theme's sidebar contrast floors (upcomputerTheme.test.ts), over the
  // worst backdrop: black and white, with no native material in between.
  it.each(["light", "dark"] as const)(
    "keeps the %s sidebar text at 4.5:1 over any backdrop",
    async (mode) => {
      const { sidebarAlpha, rowAlpha } = await paint({ theme: UPCOMPUTER_THEME, mode });
      const colors = getThemeColorsForMode(UPCOMPUTER_THEME, mode)!;
      for (const backdrop of [
        [0, 0, 0],
        [1, 1, 1],
      ]) {
        const sidebar = over(rgbOf(colors.sidebar), sidebarAlpha, backdrop);
        const row = over(rgbOf(colors.sidebarForeground), rowAlpha, sidebar);
        for (const text of [colors.sidebarForeground, colors.sidebarMutedForeground]) {
          for (const background of [sidebar, row]) {
            expect(contrastRatio(rgbOf(text), background)).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    },
  );
});
