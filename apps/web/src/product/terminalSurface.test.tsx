import {
  compileResolvedKeybindingRule,
  mergeWithDefaultKeybindings,
} from "@t3tools/shared/keybindings";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React loads.
await vi.hoisted(async () => {
  // @ts-expect-error jsdom ships no type declarations and this repo has no @types/jsdom.
  const { JSDOM } = await import("jsdom");
  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const source = window as unknown as Record<string, unknown>;
  // Node's own event classes cannot be dispatched on jsdom nodes.
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget", "KeyboardEvent"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  // The tab strip measures itself and the menus wait for animations; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.Element.prototype.getAnimations ??= () => [];
});

vi.mock("../components/settings/useScopedSettings", async (importOriginal) => {
  const { DEFAULT_UNIFIED_SETTINGS } = await import("@t3tools/contracts");
  return {
    ...(await importOriginal<typeof import("../components/settings/useScopedSettings")>()),
    useScopedSettings: () => DEFAULT_UNIFIED_SETTINGS,
    useUpdateScopedSettings: () => () => undefined,
  };
});
// The real preview boots a Ghostty WASM surface.
vi.mock("../components/settings/SettingsFontPreviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/settings/SettingsFontPreviews")>()),
  TerminalFontPreview: () => <div data-terminal-font-preview="" />,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => undefined,
  useLocation: ({ select }: { select: (location: unknown) => unknown }) =>
    select({ hash: "", state: {}, pathname: "/settings/appearance", search: {} }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { RightPanelTabs } = await import("../components/RightPanelTabs");
const { AppearanceSettingsPanel } = await import("../components/settings/SettingsPanels");
const { TYPOGRAPHY_ADVANCED_STORAGE_KEY } = await import("../appearanceFonts");
const { filterAvailableSettingsSearchItems } =
  await import("../components/settings/settingsSearch");
const {
  isProductFeatureShown,
  isProductKeybindingShown,
  isProductSettingsSearchItemVisible,
  terminalCommandTarget,
  withoutHiddenProductKeybindings,
} = await import("./productFlags");
const { resolveShortcutCommand } = await import("../keybindings");

// Unit tests see core with upstream's flags; this file switches to the
// UpComputer product's per test.
const product = vi.hoisted(() => ({ hidden: false }));
vi.mock("./productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("./WebProduct");
  const { UPCOMPUTER_PRODUCT_FLAGS, UPSTREAM_PRODUCT_FLAGS } =
    await import("@t3tools/shared/productFlags");
  return {
    WEB_PRODUCT: {
      ...composeExperimentalWebFeatures([]),
      get flags() {
        return product.hidden ? UPCOMPUTER_PRODUCT_FLAGS : UPSTREAM_PRODUCT_FLAGS;
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  product.hidden = false;
  localStorage.clear();
});

function renderAppearance() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<AppearanceSettingsPanel />));
  return container;
}

const previewSurface = {
  id: "browser:tab-1" as const,
  kind: "preview" as const,
  resourceId: "tab-1",
};

function renderPanel(
  surfaces: ComponentProps<typeof RightPanelTabs>["surfaces"],
  onAddTerminal: () => void,
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <RightPanelTabs
        mode="inline"
        surfaces={surfaces}
        environmentId={null}
        activeSurfaceId={surfaces[0]?.id ?? null}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={() => undefined}
        onCloseSurface={() => undefined}
        onCloseOtherSurfaces={() => undefined}
        onCloseSurfacesToRight={() => undefined}
        onCloseAllSurfaces={() => undefined}
        onCopyFilePath={() => undefined}
        onAddBrowser={() => undefined}
        onAddBrowserInProfile={() => undefined}
        onAddTerminal={onAddTerminal}
        onAddPullRequest={() => undefined}
        onAddPullRequests={() => undefined}
        onAddDiff={() => undefined}
        onAddFiles={() => undefined}
        onAddDevice={() => undefined}
        browserAvailable
        terminalAvailable
        diffAvailable
        filesAvailable
        pullRequestAvailable
        pullRequestsAvailable
        deviceAvailable
      >
        <div>content</div>
      </RightPanelTabs>,
    ),
  );
}

function pressKey(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("the terminal surface in the UpComputer product", () => {
  it("lists Terminal in the launcher next to Browser, Files and Diff, and T opens it", () => {
    product.hidden = true;
    const onAddTerminal = vi.fn();
    renderPanel([], onAddTerminal);

    const launcher = document.querySelector("[data-surface-launcher-keys]");
    expect(launcher?.getAttribute("data-surface-launcher-keys")).toBe("BTFD");
    const text = launcher?.textContent ?? "";
    for (const label of ["Browser", "Terminal", "Files", "Diff"]) expect(text).toContain(label);
    for (const label of ["Pull request", "Device"]) expect(text).not.toContain(label);

    pressKey(document.body, "t");
    expect(onAddTerminal).toHaveBeenCalledOnce();
  });

  it("offers Terminal in the + menu, where T opens it too", async () => {
    product.hidden = true;
    const onAddTerminal = vi.fn();
    renderPanel([previewSurface], onAddTerminal);

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Add panel surface"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      trigger!.click();
    });

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const labels = items.map((item) => item.textContent);
    expect(labels).toEqual(["BrowserB", "TerminalT", "FilesF", "DiffD"]);

    pressKey(items[1]!, "t");
    expect(onAddTerminal).toHaveBeenCalledOnce();
  });

  it("shows the terminal font in Settings, Appearance, with its preview", () => {
    product.hidden = true;
    let page = renderAppearance();
    expect(page.textContent).toContain("Code blocks, diffs, file previews, and the terminal.");
    expect(page.querySelector("[data-terminal-font-preview]")).not.toBeNull();
    act(() => root?.unmount());
    container?.remove();

    localStorage.setItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY, "true");
    page = renderAppearance();
    expect(page.textContent).toContain("Terminal output, independent from code blocks and diffs.");
    expect(page.querySelector("[data-terminal-font-preview]")).not.toBeNull();
  });

  it("keeps the terminal font search entry and the shortcuts used inside the terminal", () => {
    product.hidden = true;
    expect(isProductFeatureShown("terminalSurface")).toBe(true);
    expect(isProductSettingsSearchItemVisible({ id: "terminal-font" })).toBe(true);
    const all = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: true,
      canManageLocalBackend: true,
      isWslSettingsRowVisible: true,
      hasThreadAutoSettlement: true,
    });
    expect(all.filter(isProductSettingsSearchItemVisible).map((item) => item.id)).toContain(
      "terminal-font",
    );

    const commands = withoutHiddenProductKeybindings(mergeWithDefaultKeybindings([])).map(
      (binding) => binding.command,
    );
    for (const command of ["terminal.split", "terminal.splitVertical", "terminal.new"]) {
      expect(commands).toContain(command);
    }
    expect(commands).toContain("terminal.close");
  });

  it("still hides the drawer, its Cmd+J toggle, project scripts and Run in terminal", () => {
    product.hidden = true;
    expect(isProductFeatureShown("terminal")).toBe(false);
    const commands = withoutHiddenProductKeybindings(mergeWithDefaultKeybindings([])).map(
      (binding) => binding.command,
    );
    expect(commands).not.toContain("terminal.toggle");
    expect(isProductKeybindingShown("script.dev.run")).toBe(false);
    expect(isProductSettingsSearchItemVisible({ id: "keybinding-terminal.toggle" })).toBe(false);
  });

  it("sends a custom terminal shortcut to the right-panel terminal, never the hidden drawer", () => {
    product.hidden = true;
    // A person's own binding for terminal.new, without the default's terminalFocus condition.
    const custom = compileResolvedKeybindingRule({ key: "mod+shift+u", command: "terminal.new" });
    expect(custom).not.toBeNull();
    const keybindings = withoutHiddenProductKeybindings(mergeWithDefaultKeybindings([custom!]));
    const command = resolveShortcutCommand(
      {
        key: "u",
        code: "KeyU",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      },
      keybindings,
      { platform: "MacIntel", context: { terminalFocus: false } },
    );
    expect(command).toBe("terminal.new");
    // Chat has focus: the command still goes to the right panel, not the drawer.
    expect(terminalCommandTarget(null)).toBe("right-panel");
    expect(terminalCommandTarget("right-panel")).toBe("right-panel");
    expect(terminalCommandTarget("drawer")).toBe("right-panel");
  });

  it("keeps upstream's flags unchanged", () => {
    expect(terminalCommandTarget(null)).toBe("drawer");
    expect(terminalCommandTarget("drawer")).toBe("drawer");
    expect(terminalCommandTarget("right-panel")).toBe("right-panel");
    expect(isProductFeatureShown("terminalSurface")).toBe(true);
    expect(isProductFeatureShown("terminal")).toBe(true);
    const onAddTerminal = vi.fn();
    renderPanel([], onAddTerminal);
    expect(
      document
        .querySelector("[data-surface-launcher-keys]")
        ?.getAttribute("data-surface-launcher-keys"),
    ).toBe("BTFDPLM");
    expect(isProductKeybindingShown("terminal.toggle")).toBe(true);
    expect(isProductKeybindingShown("script.dev.run")).toBe(true);
  });
});
