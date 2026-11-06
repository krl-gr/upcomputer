import "../index.css";

import type { ReactNode } from "react";
import { commands } from "vite-plus/test/browser";

import { act, render, type Screen } from "../../test/render";
import { DEFAULT_THEME_PREFERENCE, applyThemePalette } from "../themePalette";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Writes the sheet element to `<fileName>.png`. */
    writeUiStatesSheet: (fileName: string, density?: UiStateDensity) => Promise<void>;
  }
}

export interface UiState {
  readonly name: string;
  readonly render: () => ReactNode;
  /**
   * Sets app-wide state (a store) the state needs and returns its undo. The state is
   * frozen to static markup before the undo, so other states never see it.
   */
  readonly setup?: () => () => void;
  /** Runs once the state is mounted: waits for async data or dispatches events. */
  readonly settle?: (cell: HTMLElement) => Promise<void> | void;
  /** Elements under the pointer, emulated: CSS `:hover` rules apply to them. */
  readonly hover?: string;
}

export interface UiStateGroup {
  readonly title: string;
  readonly states: ReadonlyArray<UiState>;
}

/** A sheet column: every state again, under CSS variables set on its cells. */
export interface UiStateColumn {
  readonly title: string;
  readonly variables: Readonly<Record<`--${string}`, string>>;
}

/**
 * `retina` captures at the sheet's device scale (2); `nonretina` at 1, every pixel
 * then drawn as a 2x2 block, so a Retina screen shows a 1x display's rendering.
 */
export type UiStateDensity = "retina" | "nonretina";

const DENSITY_TITLES: Record<UiStateDensity, string> = {
  retina: "Retina, 2x",
  nonretina: "non-Retina, 1x shown at 2x",
};

const HOVER_ATTRIBUTE = "data-ui-state-hover";
const THEMES = ["dark", "light"] as const;

/**
 * Copies every `:hover` rule to also match `[data-ui-state-hover]`, so several rows can
 * show hover at once. Tailwind nests its hover rules, so nested rules are rewritten too.
 */
function emulateHover(rules: CSSRuleList) {
  for (const rule of rules) {
    if (
      rule instanceof CSSStyleRule &&
      rule.selectorText.includes(":hover") &&
      !rule.selectorText.includes(HOVER_ATTRIBUTE)
    ) {
      rule.selectorText = `${rule.selectorText}, ${rule.selectorText.replaceAll(":hover", `[${HOVER_ATTRIBUTE}]`)}`;
    }
    if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList) emulateHover(rule.cssRules);
  }
}

function emulateHoverInStyleSheets() {
  for (const sheet of document.styleSheets) {
    emulateHover(sheet.cssRules);
  }
}

function applyTheme(theme: (typeof THEMES)[number]) {
  applyThemePalette(DEFAULT_THEME_PREFERENCE, theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function renderState(state: UiState, cell: HTMLElement, stack: AsyncDisposableStack) {
  const undo = state.setup?.();
  try {
    const host = document.createElement("div");
    cell.append(host);
    const screen: Screen = await render(state.render(), { container: host });
    stack.use(screen);
    await state.settle?.(host);
    if (undo) {
      const frozen = host.cloneNode(true);
      await screen.unmount();
      host.replaceWith(frozen);
    }
  } finally {
    if (undo) await act(undo);
  }
  if (state.hover) {
    for (const hovered of cell.querySelectorAll(state.hover)) {
      hovered.setAttribute(HOVER_ATTRIBUTE, "");
    }
  }
}

/**
 * Renders each state's real component next to its name, once per theme, and writes
 * `<name>-dark.png` and `<name>-light.png` (see `scripts/ui-states.ts`). With
 * `columns`, each state renders once per column; with `densities`, each theme is
 * written once per density, to `<name>-<theme>-<density>.png`.
 */
export async function captureUiStateSheet(
  name: string,
  groups: ReadonlyArray<UiStateGroup>,
  options: {
    readonly columns?: ReadonlyArray<UiStateColumn>;
    readonly densities?: ReadonlyArray<UiStateDensity>;
    /** Cell width in px, for states wider than a sidebar (default 256). */
    readonly cellWidth?: number;
  } = {},
) {
  const { columns, densities, cellWidth } = options;
  for (const theme of THEMES) {
    applyTheme(theme);
    await using stack = new AsyncDisposableStack();
    const sheet = element("div", "inline-flex flex-col gap-6 bg-background p-6 text-foreground");
    sheet.dataset.uiStatesSheet = "";
    document.body.append(sheet);
    stack.defer(() => sheet.remove());
    const title = element("div", "text-base font-semibold", `${name} · ${theme}`);
    sheet.append(title);
    if (columns) {
      const header = element("div", "flex items-center gap-4 text-sm font-semibold");
      header.append(element("div", "w-48 shrink-0"));
      for (const column of columns) header.append(element("div", "w-64 shrink-0", column.title));
      sheet.append(header);
    }
    for (const group of groups) {
      const section = element("section", "flex flex-col gap-1.5");
      section.append(
        element("h2", "pb-1 text-xs font-semibold text-muted-foreground uppercase", group.title),
      );
      sheet.append(section);
      for (const state of group.states) {
        const row = element("div", "flex items-center gap-4");
        const cells = (columns ?? [null]).map((column) => {
          const cell = element(
            "div",
            "w-64 shrink-0 bg-sidebar px-(--sidebar-content-inset) py-1 text-sidebar-foreground",
          );
          if (cellWidth !== undefined) cell.style.width = `${cellWidth}px`;
          for (const [variable, value] of Object.entries(column?.variables ?? {})) {
            cell.style.setProperty(variable, value);
          }
          return cell;
        });
        if (columns) {
          row.append(element("div", "w-48 shrink-0 text-xs text-muted-foreground", state.name));
          row.append(...cells);
        } else {
          row.append(...cells, element("div", "w-72 text-xs text-muted-foreground", state.name));
        }
        section.append(row);
        for (const cell of cells) await renderState(state, cell, stack);
      }
    }
    emulateHoverInStyleSheets();
    await document.fonts.ready;
    if (!densities) {
      await commands.writeUiStatesSheet(`${name}-${theme}`);
      continue;
    }
    for (const density of densities) {
      title.textContent = `${name} · ${theme} · ${DENSITY_TITLES[density]}`;
      await commands.writeUiStatesSheet(`${name}-${theme}-${density}`, density);
    }
  }
}
