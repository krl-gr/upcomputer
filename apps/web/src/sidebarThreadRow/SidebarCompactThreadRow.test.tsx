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

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;

const surface = vi.hoisted(() => ({ sidebarThreadRow: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", () => ({
  productSurface: () => surface.sidebarThreadRow,
}));
// Stands in for the Tasks feature's run badge: it replaces the time on one thread.
vi.mock("../product/ProductSlots", () => ({
  ProductThreadRowAccessory: (props: { threadId: string; fallback: unknown }) =>
    props.threadId === "with-runs" ? <span data-testid="task-runs">2 runs</span> : props.fallback,
}));
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: () => <span data-testid="project-favicon" />,
}));
vi.mock("../state/entities", () => ({
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));

import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import type { SidebarCompactThreadRowProps } from "./SidebarCompactThreadRow";

const { __setClientSettingsForTests, persistClientSettingsPatch } =
  await import("../hooks/useSettings");
const { SidebarCompactThreadRow } = await import("./SidebarCompactThreadRow");
const { useSidebarThreadRowSurface } = await import("./threadListSetting");

const environmentId = "env-local";
const HOUR = 60 * 60 * 1000;

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    environmentId,
    projectId: "project",
    title: `Thread ${id}`,
    lastVisitedAt: new Date(Date.now() - HOUR).toISOString(),
    latestRun: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestUserMessageAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    updatedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    titleRegeneration: null,
    ...overrides,
  } as unknown as SidebarCompactThreadRowProps["thread"];
}

const spies = {
  onThreadClick: vi.fn(),
  onThreadActivate: vi.fn(),
  onStartRename: vi.fn(),
  onRenameTitleChange: vi.fn(),
  onCommitRename: vi.fn(),
  onCancelRename: vi.fn(),
  onContextMenu: vi.fn(),
};

function rowProps(
  overrides: Partial<SidebarCompactThreadRowProps> = {},
): SidebarCompactThreadRowProps {
  return {
    thread: thread("plain"),
    variantAction: "settle",
    isPinned: false,
    dropVerb: null,
    sweepAction: null,
    snoozeWakeLabelText: null,
    isActive: false,
    jumpLabel: null,
    project: {
      id: "project",
      environmentId,
      title: "UpComputer",
      workspaceRoot: "/work/upcomputer",
    } as unknown as SidebarCompactThreadRowProps["project"],
    projectDisplayName: "UpComputer",
    isRenaming: false,
    renamingTitle: "",
    ...spies,
    ...overrides,
  };
}

/** Upstream's row, as the sidebar would get it with "Detailed". */
function UpstreamRow(props: SidebarCompactThreadRowProps) {
  return <li data-testid="sidebar-row-upstream">{props.thread.title}</li>;
}

/** The sidebar's hook line: one list, and the row component follows the setting. */
function ThreadList(props: { readonly rows: ReadonlyArray<SidebarCompactThreadRowProps> }) {
  const ThreadRow =
    useSidebarThreadRowSurface() === "upcomputer" ? SidebarCompactThreadRow : UpstreamRow;
  return (
    <ul>
      {props.rows.map((row) => (
        <ThreadRow key={row.thread.id} {...row} />
      ))}
    </ul>
  );
}

let root: Root;
let container: HTMLDivElement;

function render(rows: ReadonlyArray<SidebarCompactThreadRowProps>) {
  return act(async () => {
    root.render(<ThreadList rows={rows} />);
  });
}

function setThreadList(value: "compact" | "detailed") {
  return act(async () => {
    await persistClientSettingsPatch({ sidebarThreadList: value }, async () => undefined);
  });
}

const compactRows = () => [
  ...container.querySelectorAll<HTMLElement>("[data-testid='sidebar-row-compact']"),
];

beforeEach(() => {
  surface.sidebarThreadRow = "upcomputer";
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  for (const spy of Object.values(spies)) spy.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Thread list setting", () => {
  it("defaults to Compact", async () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarThreadList).toBe("compact");
    await render([rowProps()]);
    expect(compactRows()).toHaveLength(1);
  });

  it("switches between compact and upstream rows at once, with the same props", async () => {
    const rows = [rowProps(), rowProps({ thread: thread("second") })];
    await render(rows);
    expect(compactRows()).toHaveLength(2);

    await setThreadList("detailed");
    expect(compactRows()).toHaveLength(0);
    expect(
      [...container.querySelectorAll("[data-testid='sidebar-row-upstream']")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Thread plain", "Thread second"]);

    await setThreadList("compact");
    expect(compactRows()).toHaveLength(2);
  });

  it("keeps upstream's rows in a build with the upstream surface", async () => {
    surface.sidebarThreadRow = "upstream";
    await render([rowProps()]);
    expect(compactRows()).toHaveLength(0);
    expect(container.querySelector("[data-testid='sidebar-row-upstream']")).not.toBeNull();
  });
});

describe("SidebarCompactThreadRow", () => {
  it("shows the project icon, title and relative time on one line", async () => {
    await render([rowProps()]);
    const [row] = compactRows();
    expect(row?.querySelector("[data-testid='project-favicon']")).not.toBeNull();
    expect(row?.textContent).toContain("Thread plain");
    expect(row?.textContent).toContain("3h");
    expect(row?.getAttribute("aria-label")).toBe("Thread plain, UpComputer");
    expect(row?.querySelector("[data-testid='sidebar-row-status']")).toBeNull();
  });

  it("shows upstream's statuses as V1's text labels before the title, without an icon", async () => {
    const completedAt = new Date().toISOString();
    await render([
      rowProps({ thread: thread("working", { runtime: { status: "running" } }) }),
      rowProps({ thread: thread("waiting", { runtime: { status: "idle" } }) }),
      rowProps({ thread: thread("input", { hasPendingUserInput: true }) }),
      rowProps({ thread: thread("approval", { hasPendingApprovals: true }) }),
      rowProps({ thread: thread("failed", { runtime: { status: "failed" } }) }),
      rowProps({
        thread: thread("limited", {
          runtime: { status: "failed", lastErrorClass: "usage_limit" },
        }),
      }),
      rowProps({ thread: thread("unread", { latestRun: { completedAt } }) }),
      rowProps({ thread: thread("read") }),
    ]);
    const labels = compactRows().map((row) =>
      row.querySelector<HTMLElement>("[data-testid='sidebar-row-status']"),
    );
    expect(labels.map((label) => label?.textContent ?? null)).toEqual([
      "Working",
      "Waiting",
      "Awaiting Input",
      "Pending Approval",
      "Failed",
      "Limited",
      "Completed",
      null,
    ]);
    // Waiting stays visible in gray; Limited is amber.
    expect(labels[1]?.classList.contains("text-muted-foreground")).toBe(true);
    expect(labels[5]?.classList.contains("text-warning-foreground")).toBe(true);
    for (const [index, row] of compactRows().entries()) {
      // The only icon left is the actions button's.
      expect(
        [...row.querySelectorAll("svg")].every((icon) =>
          icon.closest("button[aria-label^='Thread actions']"),
        ),
      ).toBe(true);
      // V1's placement: the label sits right before the title.
      if (labels[index]) {
        expect(labels[index]?.nextElementSibling?.textContent).toMatch(/^Thread /);
      }
    }
  });

  it("keeps every title one tone: unread and statuses show only through the label", async () => {
    const completedAt = new Date().toISOString();
    await render([
      rowProps({ thread: thread("read") }),
      rowProps({ thread: thread("unread", { latestRun: { completedAt } }) }),
      rowProps({ thread: thread("working", { runtime: { status: "running" } }) }),
      rowProps({ thread: thread("open"), isActive: true }),
    ]);
    const titles = compactRows().map((row) => row.querySelector("span[aria-hidden]")!.className);
    expect(titles[1]).toBe(titles[0]);
    expect(titles[2]).toBe(titles[0]);
    expect(titles[0]).toContain("text-sidebar-muted-foreground");
    expect(titles[0]).not.toContain("font-medium");
    // Only the open thread is brighter.
    expect(titles[3]).not.toBe(titles[0]);
    expect(titles[3]).not.toContain("text-sidebar-muted-foreground");
  });

  it("renders the shelves' rows compactly: pinned, snoozed and working", async () => {
    await render([
      rowProps({ thread: thread("pinned"), isPinned: true }),
      rowProps({
        thread: thread("snoozed"),
        variantAction: "unsnooze",
        snoozeWakeLabelText: "2h",
      }),
      rowProps({ thread: thread("working", { runtime: { status: "running" } }) }),
    ]);
    const [pinned, snoozed, working] = compactRows();
    expect(pinned?.querySelector("[aria-label='Pinned']")).not.toBeNull();
    // Snoozed rows show when they come back, not when they were last touched.
    expect(snoozed?.textContent).toContain("2h");
    expect(snoozed?.textContent).not.toContain("3h");
    expect(working?.querySelector("[data-testid='sidebar-row-status']")?.textContent).toBe(
      "Working",
    );
  });

  it("opens upstream's thread actions from the … button and keeps the row highlighted", async () => {
    await render([rowProps()]);
    const [row] = compactRows();
    const actions = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Thread actions for Thread plain']",
    )!;
    await act(async () => actions.click());

    expect(spies.onContextMenu).toHaveBeenCalledTimes(1);
    expect(spies.onContextMenu.mock.calls[0]?.[0]).toEqual({
      environmentId,
      threadId: "plain",
    });
    expect(spies.onThreadClick).not.toHaveBeenCalled();
    expect(row?.classList.contains("bg-sidebar-row-hover")).toBe(true);
    expect(actions.classList.contains("opacity-100")).toBe(true);

    // Moving through the menu keeps it; choosing an item or dismissing it lets go.
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(row?.classList.contains("bg-sidebar-row-hover")).toBe(true);
    await act(async () => {
      document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(row?.classList.contains("bg-sidebar-row-hover")).toBe(false);
    expect(actions.classList.contains("opacity-0")).toBe(true);
  });

  it("opens the same actions on right-click", async () => {
    await render([rowProps()]);
    await act(async () => {
      compactRows()[0]?.dispatchEvent(
        new window.MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }),
      );
    });
    expect(spies.onContextMenu).toHaveBeenCalledWith(
      { environmentId, threadId: "plain" },
      { x: 10, y: 20 },
    );
  });

  it("keeps the task-run badge in place of the time", async () => {
    await render([rowProps({ thread: thread("with-runs") }), rowProps()]);
    const [withRuns, plain] = compactRows();
    const badge = withRuns?.querySelector("[data-testid='task-runs']");
    expect(badge?.textContent).toBe("2 runs");
    expect(withRuns?.textContent).not.toContain("3h");
    expect(plain?.querySelector("[data-testid='task-runs']")).toBeNull();
    // The time and the badge take the title's size, as in V1.
    const time = [...(plain?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "3h",
    );
    expect(time?.closest(".text-sm, .text-xs")?.classList.contains("text-sm")).toBe(true);
    expect(badge?.closest(".text-sm, .text-xs")?.classList.contains("text-sm")).toBe(true);
  });

  it("opens and renames the thread like upstream's row", async () => {
    await render([rowProps()]);
    await act(async () => compactRows()[0]?.click());
    expect(spies.onThreadClick).toHaveBeenCalledTimes(1);
    await act(async () => {
      compactRows()[0]?.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    });
    expect(spies.onStartRename).toHaveBeenCalledWith(
      { environmentId, threadId: "plain" },
      "Thread plain",
    );

    await render([rowProps({ isRenaming: true, renamingTitle: "Renamed" })]);
    const input = container.querySelector<HTMLInputElement>("input[aria-label='Thread title']")!;
    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(spies.onCommitRename).toHaveBeenCalledWith(
      { environmentId, threadId: "plain" },
      "Renamed",
      "Thread plain",
    );
  });
});
