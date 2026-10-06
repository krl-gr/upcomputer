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

vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => "upcomputer",
}));
// jsdom has no layout, so the footer's fold state is set per case; the
// measurement that picks it in the app is covered in UpComputerComposerFooter.test.
const fold = vi.hoisted(() => ({ hiddenCount: 0, iconOnlyCount: 0 }));
vi.mock("../components/composerFooterLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/composerFooterLayout")>()),
  resolveRestingComposerControlsLayout: () => ({ ...fold, visible: true }),
}));

import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import tailwindcss from "@tailwindcss/vite";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@t3tools/contracts";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer } from "vite-plus";

import type { DraftId } from "../composerDraftStore";
import type { ThemeAppearance, ThemeDefinition } from "../themePalette";

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { runtimeModeConfig, runtimeModeOptions } =
  await import("../components/chat/runtimeModeConfig");
const { deriveProviderInstanceEntries } = await import("../providerInstances");
const { ComposerFooterModelPicker } = await import("./ComposerFooterModelPicker");
const { UpComputerComposerFooter } = await import("./UpComputerComposerFooter");
const { COMPOSER_CARD_CLASS, composerSendButtonClass } = await import("./composerLookStyles");
const { CONTEXT_ROW_ICON_BUTTON_CLASS } = await import("../composerContextRow/contextRowStyles");
const {
  EMBER_THEME,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  UPCOMPUTER_THEME,
  getThemeColorVariable,
  getThemeColorsForMode,
  getThemeModes,
} = await import("../themePalette");

const WEB_ROOT = NodeURL.fileURLToPath(new URL("../..", import.meta.url));
const CLAUDE = ProviderInstanceId.make("claudeAgent");
const OPUS = "claude-opus-5-5";

function select(id: string, options: ReadonlyArray<{ id: string; label: string }>) {
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    currentValue: options.at(-1)!.id,
  } as ProviderOptionDescriptor;
}

const claudeEntry = deriveProviderInstanceEntries([
  {
    instanceId: CLAUDE,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-06T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  } as ServerProvider,
])[0]!;

/**
 * The footer as `ChatComposer.tsx` mounts it in the expanded composer,
 * including the class upstream gives its model picker there, inside V1's
 * card, with the send button and a context row icon.
 */
function ComposerUnderTest(props: { mode: boolean; attach: boolean }) {
  return (
    <div data-composer-card className={COMPOSER_CARD_CLASS}>
      <UpComputerComposerFooter
        attach={props.attach ? { input: null, open: () => undefined } : null}
        modelPicker={
          <ComposerFooterModelPicker
            compact={false}
            isComposerOwned
            activeInstanceId={CLAUDE}
            model={OPUS}
            lockedProvider={null}
            instanceEntries={[claudeEntry]}
            modelOptionsByInstance={new Map([[CLAUDE, [{ slug: OPUS, name: "Claude Opus 5.5" }]]])}
            size="sm"
            triggerClassName="-ms-2.5 min-w-13"
            onInstanceModelChange={() => undefined}
          />
        }
        providerUnavailableControl={null}
        traitsPickerInput={{
          provider: ProviderDriverKind.make("claudeAgent"),
          instanceId: CLAUDE,
          draftId: "draft-composer-look" as DraftId,
          model: OPUS,
          models: [
            {
              slug: OPUS,
              name: "Claude Opus 5.5",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  select("effort", [
                    { id: "medium", label: "Medium" },
                    { id: "high", label: "High" },
                  ]),
                  select("contextWindow", [
                    { id: "200k", label: "200k" },
                    { id: "1m", label: "1M" },
                  ]),
                ],
              },
            },
          ],
          modelOptions: undefined,
          prompt: "",
          onPromptChange: () => undefined,
          planModeEnabled: true,
          isComposerOwned: true,
        }}
        traitsMenuContent={null}
        showInteractionModeToggle={props.mode}
        interactionMode="default"
        onToggleInteractionMode={() => undefined}
        runtimeMode="full-access"
        runtimeModeOptions={runtimeModeOptions.map((mode) => ({
          mode,
          ...runtimeModeConfig[mode],
        }))}
        onRuntimeModeChange={() => undefined}
        primaryActions={
          <>
            <button type="button" data-send="ready" className={composerSendButtonClass(true)} />
            <button type="button" data-send="idle" className={composerSendButtonClass(false)} />
          </>
        }
      />
      <button type="button" data-context-row-icon className={CONTEXT_ROW_ICON_BUTTON_CLASS} />
    </div>
  );
}

async function renderMarkup(props: { mode: boolean; attach: boolean }): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ComposerUnderTest {...props} />);
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
    cacheDir: `${NodeOS.tmpdir()}/upcomputer-composer-look-vite`,
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

/** The page as the app paints it: the theme's palette on the root, the composer in a lane. */
function documentHtml(input: {
  css: string;
  markup: string;
  theme: ThemeDefinition;
  appearance: ThemeAppearance;
  width: number;
}): string {
  const colors = getThemeColorsForMode(input.theme, input.appearance)!;
  const variables = Object.entries(colors)
    .map(([role, value]) => `${getThemeColorVariable(role as keyof typeof colors)}:${value}`)
    .join(";");
  const dark = input.appearance === "dark" ? "dark" : "";
  return `<!doctype html><html data-theme-id="${input.theme.id}" class="${dark}" style="${variables}"><head><style>${input.css}</style></head><body class="bg-background"><div style="width:${input.width}px">${input.markup}</div></body></html>`;
}

interface SeparatorGap {
  readonly between: string;
  readonly left: number;
  readonly right: number;
}

/**
 * Runs in the page: each shown separator's gap to the nearest visible content
 * (text or icon) on either side, clipped as the row clips it, and whether any
 * content runs past the row's end.
 */
function measureSeparatorGaps(): { gaps: SeparatorGap[]; overflows: boolean } {
  const row = document.querySelector('[data-chat-composer-controls="left"]')!;
  const rowBox = row.getBoundingClientRect();
  const shown = (element: Element) => element.checkVisibility({ visibilityProperty: true });
  const clipped = (rect: DOMRect, node: Node) => {
    let { left, right } = rect;
    for (let element = node.parentElement; element && element !== row;) {
      if (getComputedStyle(element).overflowX !== "visible") {
        const box = element.getBoundingClientRect();
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      element = element.parentElement;
    }
    return { left, right };
  };
  type Mark = { separator: boolean; name: string; left: number; right: number };
  const marks: Mark[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement!;
      if (!node.textContent!.trim() || !shown(parent) || parent.closest("svg")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = clipped(range.getBoundingClientRect(), node);
      if (box.right > box.left) marks.push({ separator: false, name: node.textContent!, ...box });
    } else if ((node as Element).matches("[data-composer-footer-separator]")) {
      if (!shown(node as Element)) continue;
      const box = (node as Element).getBoundingClientRect();
      marks.push({ separator: true, name: "|", left: box.left, right: box.right });
    } else if ((node as Element).matches("svg") && shown(node as Element)) {
      const box = clipped((node as Element).getBoundingClientRect(), node);
      if (box.right > box.left) marks.push({ separator: false, name: "icon", ...box });
    }
  }
  const gaps = marks.flatMap((mark, index) => {
    if (!mark.separator) return [];
    const before = marks.slice(0, index).toReversed();
    const leftEnd = before.findIndex((candidate) => candidate.separator);
    const left = before.slice(0, leftEnd === -1 ? undefined : leftEnd);
    const after = marks.slice(index + 1);
    const rightEnd = after.findIndex((candidate) => candidate.separator);
    const right = after.slice(0, rightEnd === -1 ? undefined : rightEnd);
    return [
      {
        between: `${left[0]?.name ?? "nothing"} | ${right[0]?.name ?? "nothing"}`,
        left: mark.left - Math.max(...left.map((candidate) => candidate.right)),
        right: Math.min(...right.map((candidate) => candidate.left)) - mark.right,
      },
    ];
  });
  return { gaps, overflows: marks.some((mark) => mark.right > rowBox.right + 0.5) };
}

/** Runs in the page: the composer's colors as painted, `r,g,b,a` from 0 to 255. */
function measureComposerColors() {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const paint = (color: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
  return {
    background: paint(getComputedStyle(document.body).backgroundColor),
    card: paint(style("[data-composer-card]").backgroundColor),
    cardShadow: style("[data-composer-card]").boxShadow,
    muted: paint(style("[data-composer-footer-access]").color),
    rowIcon: paint(style("[data-context-row-icon]").color),
    separator: paint(style("[data-composer-footer-separator]").backgroundColor),
    send: paint(style('[data-send="ready"]').backgroundColor),
    sendIdle: paint(style('[data-send="idle"]').backgroundColor),
    sendForeground: paint(style('[data-send="ready"]').color),
    sendShadow: style('[data-send="ready"]').boxShadow,
    sendIdleOpacity: style('[data-send="idle"]').opacity,
  };
}

type Rgba = ReadonlyArray<number>;
/** `top` painted over an opaque `bottom`. */
const over = (top: Rgba, bottom: Rgba) =>
  [0, 1, 2].map((index) => (top[index]! * top[3]! + bottom[index]! * (255 - top[3]!)) / 255);
const luminance = (rgb: Rgba) => {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: Rgba, b: Rgba) => {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};

const browser = await launchBrowser();
let css = "";

beforeAll(async () => {
  if (browser) css = await compileAppCss();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** The fold states the footer goes through as its row narrows, at a width each one fits. */
const FOLDS = [
  { name: "all shown", hiddenCount: 0, iconOnlyCount: 0, width: 900 },
  { name: "access as a lock", hiddenCount: 0, iconOnlyCount: 1, width: 620 },
  { name: "access and effort as icons", hiddenCount: 0, iconOnlyCount: 2, width: 560 },
  { name: "access folded into …", hiddenCount: 1, iconOnlyCount: 0, width: 520 },
  { name: "everything folded into …", hiddenCount: 3, iconOnlyCount: 0, width: 400 },
];

describe.skipIf(browser === null)("composer footer separators (real layout in Chromium)", () => {
  let page: Page;

  beforeAll(async () => {
    page = await browser!.newPage({ viewport: { width: 1000, height: 300 } });
  });

  afterAll(async () => {
    await page?.close();
  });

  it("puts the same gap on both sides of every separator, at every width and fold", async () => {
    for (const mode of [true, false]) {
      for (const attach of [true, false]) {
        for (const state of FOLDS) {
          fold.hiddenCount = state.hiddenCount;
          fold.iconOnlyCount = state.iconOnlyCount;
          const markup = await renderMarkup({ mode, attach });
          await page.setContent(
            documentHtml({
              css,
              markup,
              theme: UPCOMPUTER_THEME,
              appearance: "light",
              width: state.width,
            }),
          );
          const { gaps, overflows } = await page.evaluate(measureSeparatorGaps);
          const where = `${state.name} at ${state.width}px, mode ${mode}, attach ${attach}`;
          expect(overflows, `the row overflows: ${where}`).toBe(false);
          expect(gaps.length, where).toBeGreaterThan(0);
          for (const gap of gaps) {
            const label = `${gap.between} (${gap.left}px / ${gap.right}px), ${where}`;
            expect(gap.left, label).toBeGreaterThan(0);
            expect(Math.abs(gap.left - gap.right), label).toBeLessThanOrEqual(0.5);
            // V1's spacing: the row's 2px gap and the 8px to the neighbour's content.
            expect(Math.abs(gap.left - 10), label).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  }, 60_000);
});

describe.skipIf(browser === null)("composer colors follow the theme", () => {
  let page: Page;

  beforeAll(async () => {
    fold.hiddenCount = 0;
    fold.iconOnlyCount = 0;
    page = await browser!.newPage({ viewport: { width: 1000, height: 300 } });
  });

  afterAll(async () => {
    await page?.close();
  });

  async function colorsIn(theme: ThemeDefinition, appearance: ThemeAppearance) {
    const markup = await renderMarkup({ mode: true, attach: true });
    await page.setContent(documentHtml({ css, markup, theme, appearance, width: 900 }));
    return page.evaluate(measureComposerColors);
  }

  it("keeps V1's exact composer in the Up.computer theme", async () => {
    const dark = await colorsIn(UPCOMPUTER_THEME, "dark");
    expect(dark.card).toEqual([30, 30, 30, 255]);
    expect(dark.cardShadow).toContain("rgba(255, 255, 255, 0.06) -1px -1px 1px 0px inset");
    expect(dark.cardShadow).toContain("rgba(255, 255, 255, 0.12) 1px 1px 1px 0px inset");
    expect(dark.cardShadow).toContain("rgba(9, 9, 9, 0.08) 0px 4px 14.4px 0px");
    expect(dark.muted).toEqual([255, 255, 255, 128]);
    expect(dark.rowIcon).toEqual([255, 255, 255, 128]);
    expect(dark.separator).toEqual([255, 255, 255, 15]);
    expect(dark.send).toEqual([212, 212, 212, 255]);
    expect(dark.sendIdle).toEqual([212, 212, 212, 255]);
    expect(dark.sendForeground).toEqual([23, 23, 23, 255]);
    expect(dark.sendShadow).toContain("rgba(0, 0, 0, 0.17) 0px -1px 1px 0px inset");

    const light = await colorsIn(UPCOMPUTER_THEME, "light");
    expect(light.card).toEqual([255, 255, 255, 255]);
    expect(light.cardShadow).toContain("rgba(9, 9, 9, 0.035) 0px 4px 14.4px 0px");
    expect(light.send).toEqual([34, 34, 34, 255]);
    expect(light.sendIdle).toEqual([196, 196, 196, 255]);
    expect(light.sendForeground).toEqual([255, 255, 255, 255]);
  });

  const themes = [
    UPCOMPUTER_THEME,
    T3_CHAT_THEME,
    GROVE_THEME,
    OCEAN_THEME,
    EMBER_THEME,
    IRIS_THEME,
  ];
  const cases = themes.flatMap((theme) =>
    getThemeModes(theme).map((appearance) => ({ theme, appearance })),
  );

  it.each(cases.map((entry) => [`${entry.theme.id} ${entry.appearance}`, entry] as const))(
    "reads well in %s",
    async (_, { theme, appearance }) => {
      const colors = await colorsIn(theme, appearance);
      const card = colors.card.slice(0, 3);
      expect(colors.card[3]).toBe(255);
      // The card stands out from the chat in dark; in light its border does.
      if (appearance === "dark") {
        expect(contrast(card, colors.background.slice(0, 3))).toBeGreaterThan(1.05);
      }
      expect(contrast(over(colors.muted, card), card)).toBeGreaterThanOrEqual(3);
      expect(contrast(over(colors.separator, card), card)).toBeGreaterThan(1.15);
      // The send arrow reads on its button, and the idle button is clearly dimmer.
      expect(contrast(colors.sendForeground, colors.send)).toBeGreaterThanOrEqual(4.5);
      expect(colors.sendIdleOpacity).toBe("0.4");
    },
  );
});
