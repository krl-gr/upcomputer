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

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { RightPanelTabs } = await import("../components/RightPanelTabs");

// The UpComputer product, with or without the Tasks feature composed in.
const product = vi.hoisted(() => ({ tasks: true }));
vi.mock("./productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("./WebProduct");
  const { TASKS_WEB_FEATURE } = await import("@t3tools/tasks-web/feature");
  const { UPCOMPUTER_PRODUCT_FLAGS, UPCOMPUTER_PRODUCT_SURFACES } =
    await import("@t3tools/shared/productFlags");
  const options = { flags: UPCOMPUTER_PRODUCT_FLAGS, surfaces: UPCOMPUTER_PRODUCT_SURFACES };
  const withTasks = composeExperimentalWebFeatures([TASKS_WEB_FEATURE], options);
  const core = composeExperimentalWebFeatures([], options);
  return {
    WEB_PRODUCT: {
      ...withTasks,
      get rightPanelSurfaces() {
        return (product.tasks ? withTasks : core).rightPanelSurfaces;
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
  product.tasks = true;
});

const previewSurface = {
  id: "browser:tab-1" as const,
  kind: "preview" as const,
  resourceId: "tab-1",
};
const tasksSurface = {
  id: "feature:tasks" as const,
  kind: "feature" as const,
  featureSurfaceId: "tasks",
};

function renderPanel(
  surfaces: ComponentProps<typeof RightPanelTabs>["surfaces"],
  onAddFeatureSurface: ((featureSurfaceId: string) => void) | undefined,
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
        onAddTerminal={() => undefined}
        onAddPullRequest={() => undefined}
        onAddPullRequests={() => undefined}
        onAddDiff={() => undefined}
        onAddFiles={() => undefined}
        onAddDevice={() => undefined}
        {...(onAddFeatureSurface ? { onAddFeatureSurface } : {})}
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

function launcherKeys() {
  return document
    .querySelector("[data-surface-launcher-keys]")
    ?.getAttribute("data-surface-launcher-keys");
}

function pressKey(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("the Tasks surface in the right panel", () => {
  it("lists Tasks after core's surfaces in the launcher, and K opens it", () => {
    const onAddFeatureSurface = vi.fn();
    renderPanel([], onAddFeatureSurface);

    expect(launcherKeys()).toBe("BTFDK");
    expect(document.querySelector("[data-surface-launcher-keys]")?.textContent).toContain("Tasks");

    pressKey(document.body, "k");
    expect(onAddFeatureSurface).toHaveBeenCalledExactlyOnceWith("tasks");
  });

  it("offers Tasks last in the + menu, where K opens it too", async () => {
    const onAddFeatureSurface = vi.fn();
    renderPanel([previewSurface], onAddFeatureSurface);

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Add panel surface"]',
    );
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      trigger!.click();
    });

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "BrowserB",
      "TerminalT",
      "FilesF",
      "DiffD",
      "TasksK",
    ]);

    pressKey(items[0]!, "k");
    expect(onAddFeatureSurface).toHaveBeenCalledExactlyOnceWith("tasks");
  });

  it("titles the open surface's tab Tasks", () => {
    renderPanel([tasksSurface], vi.fn());
    const tabBar = document.querySelector("[data-right-panel-tab-list]");
    expect(tabBar?.textContent).toContain("Tasks");
    expect(document.querySelector('[aria-label="Close Tasks"]')).not.toBeNull();
  });

  it("leaves Tasks out of a build without the feature and of panels not beside a thread", () => {
    product.tasks = false;
    renderPanel([], vi.fn());
    expect(launcherKeys()).toBe("BTFD");
    act(() => root?.unmount());
    container?.remove();

    product.tasks = true;
    renderPanel([], undefined);
    expect(launcherKeys()).toBe("BTFD");
  });
});
