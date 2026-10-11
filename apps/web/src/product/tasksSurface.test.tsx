import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React loads.
const dom = await vi.hoisted(async () => {
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
  // The tab strip and the planner measure themselves and the menus wait for
  // animations; jsdom has neither. `resize` reports a new width to every observer.
  const observers = new Set<ResizeObserverCallback>();
  globalThis.ResizeObserver = class {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this.callback);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.callback);
    }
  } as unknown as typeof ResizeObserver;
  window.Element.prototype.getAnimations ??= () => [];
  // Media queries see a narrow window.
  window.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  const resize = (width: number) => {
    for (const callback of observers) {
      callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    }
  };
  return { resize };
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { RightPanelTabs } = await import("../components/RightPanelTabs");
const { ProductRightPanelSurface } = await import("./ProductSlots");
const { SidebarProvider } = await import("../components/ui/sidebar");

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

// One environment with a Tasks server holding a routine and a task in Health and in Life OS.
const tasksServer = vi.hoisted(() => {
  const at = "2026-10-11T10:00:00.000Z";
  const row = (id: string, projectId: string, kind: "task" | "routine") => ({
    id,
    rank: id,
    projectId,
    title: id,
    description: "",
    output: null,
    status: "To Do",
    priority: null,
    createdBy: "person",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: [],
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: at,
    audience: "person",
    kind,
    runCounts: [],
  });
  const rows = [
    row("Health routine", "health", "routine"),
    row("Life OS routine", "life-os", "routine"),
    row("Health task", "health", "task"),
    row("Life OS task", "life-os", "task"),
  ];
  const pageInputs: Array<{ readonly projectId?: string; readonly kind?: string }> = [];
  const tasks = new Proxy(
    {
      page: async (input: { readonly projectId?: string; readonly kind?: string }) => {
        pageInputs.push(input);
        return {
          tasks: rows.filter(
            (task) =>
              (input.projectId === undefined || task.projectId === input.projectId) &&
              (input.kind === undefined || task.kind === input.kind),
          ),
          nextCursor: null,
          statuses: ["To Do"],
        };
      },
      scheduleRange: async () => ({ entries: [], tasks: [] }),
      scheduleProgress: async () => ({ progress: [] }),
      // Like the server, a subscription starts with a sync.
      subscribe: (listener: (change: unknown) => void) => {
        queueMicrotask(() =>
          listener({
            kind: "sync",
            sequence: 1,
            taskIds: [],
            listChanged: true,
            runsChanged: false,
            rootThreadIds: [],
          }),
        );
        return () => undefined;
      },
    } as Record<string, unknown>,
    { get: (target, key: string) => target[key] ?? (async () => ({})) },
  );
  return { client: { tasks }, pageInputs };
});

vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async () => {
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  return {
    readTasksWebAccess: () => resolveTasksWebAccess({ availability: "enabled" }),
    readTasksWebClient: () => tasksServer.client,
    readPlannerAvailability: () => "enabled",
    usePlannerAvailability: () => "enabled",
    useTasksWebAccessRevision: () => 0,
  };
});

vi.mock("../../../../packages/tasks-web/src/ui/useWorkspaceData.ts", async () => {
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const environmentId = "local";
  const project = (id: string, name: string) => ({
    environmentId,
    id,
    name,
    workspaceRoot: `/projects/${id}`,
    favicon: { environmentId, id, workspaceRoot: `/projects/${id}` },
  });
  const projects = [project("life-os", "Life OS"), project("health", "Health")];
  const data = {
    taskTargets: [
      {
        environmentId,
        client: tasksServer.client,
        access: resolveTasksWebAccess({ availability: "enabled" }),
        projectNameById: new Map(projects.map((item) => [item.id, item.name])),
      },
    ],
    projects,
    agentProjects: [],
    tasks: { tasks: [], statuses: [] },
    agents: { agents: [], runs: [] },
    tasksStatus: "ready",
    agentsStatus: "ready",
    getClient: () => tasksServer.client,
    canMutateTasks: () => true,
    canMutateAgents: () => true,
    reload: () => undefined,
  };
  const groups = projects.map((item) => ({
    ...item,
    projectKey: item.id,
    displayName: item.name,
    groupedProjectCount: 1,
    environmentPresence: "local-only",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    memberProjects: [item],
    memberProjectRefs: [{ environmentId, projectId: item.id }],
    remoteEnvironmentLabels: [],
  }));
  return {
    useTasksWorkspaceData: () => data,
    useSidebarProjectSnapshots: () => groups,
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
  window.localStorage.clear();
  tasksServer.pageInputs.length = 0;
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

describe("the Tasks surface's content", () => {
  // The thread beside the panel is in Life OS; the page's filters decide what is listed.
  function renderTasks(storage: Record<string, unknown>) {
    for (const [key, value] of Object.entries(storage)) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <SidebarProvider>
          <ProductRightPanelSurface
            featureSurfaceId="tasks"
            environmentId={"local" as never}
            threadId={"thread" as never}
            projectId={"life-os" as never}
          />
        </SidebarProvider>,
      ),
    );
  }
  const shows = (text: string) => document.body.textContent?.includes(text) === true;

  it("lists the planner's routines in every project, not only the thread's", async () => {
    renderTasks({ "tasks.view": "planner", "tasks.planner.kind": "routine" });

    await vi.waitFor(() => expect(shows("Health routine")).toBe(true), { timeout: 5000 });
    expect(shows("Life OS routine")).toBe(true);
    expect(tasksServer.pageInputs.filter((input) => input.projectId !== undefined)).toEqual([]);
  });

  it("puts the list beside the week when the planner is wide, and stacks them when narrow", async () => {
    const listBesideWeek = () => document.querySelector('[aria-label="Resize the task list"]');
    const stacked = () => document.querySelector('[aria-label="Resize the week"]');
    // The planner's first measurement, before any resize.
    const measure = vi
      .spyOn(window.HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1250 } as DOMRect);
    try {
      renderTasks({ "tasks.view": "planner" });
      await vi.waitFor(() => expect(listBesideWeek()).not.toBeNull(), { timeout: 5000 });
      expect(stacked()).toBeNull();

      act(() => dom.resize(400));
      expect(stacked()).not.toBeNull();
      expect(listBesideWeek()).toBeNull();

      act(() => dom.resize(800));
      expect(listBesideWeek()).not.toBeNull();
      act(() => root?.unmount());
      container?.remove();

      measure.mockReturnValue({ width: 400 } as DOMRect);
      renderTasks({ "tasks.view": "planner" });
      await vi.waitFor(() => expect(stacked()).not.toBeNull(), { timeout: 5000 });
      expect(listBesideWeek()).toBeNull();
    } finally {
      measure.mockRestore();
    }
  });

  it("filters the table by the page's project, not the thread's", async () => {
    renderTasks({ "tasks.view": "table" });
    await vi.waitFor(() => expect(shows("Health task")).toBe(true), { timeout: 5000 });
    expect(shows("Life OS task")).toBe(true);
    act(() => root?.unmount());
    container?.remove();

    renderTasks({ "tasks.view": "table", "upcomputer:pages:project": "health" });
    await vi.waitFor(() => expect(shows("Health task")).toBe(true), { timeout: 5000 });
    expect(shows("Life OS task")).toBe(false);
  });
});
