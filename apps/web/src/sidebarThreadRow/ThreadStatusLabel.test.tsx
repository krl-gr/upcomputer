import type { ComponentProps } from "react";
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
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => surface.sidebarThreadRow,
}));

import {
  resolveSidebarV2TopStatus,
  type SidebarThreadStatus,
  type SidebarV2TopStatusKind,
} from "../components/Sidebar.logic";
import { resolveThreadStatusLabel, THREAD_STATUS_LABELS } from "./ThreadStatusLabel";

const { SidebarThreadRow } = await import("../components/Sidebar");

// Typecheck fails here when upstream adds a status this test does not walk.
const EVERY_STATUS: Record<SidebarThreadStatus, true> = {
  approval: true,
  input: true,
  working: true,
  waiting: true,
  failed: true,
  limited: true,
  ready: true,
};

// Typecheck fails here, and in THREAD_STATUS_LABELS, when upstream adds a kind.
const EXPECTED_LABELS: Record<SidebarV2TopStatusKind, string | null> = {
  working: "Working",
  approval: "Pending Approval",
  input: "Awaiting Input",
  done: "Completed",
  failed: "Failed",
  limited: "Limited",
  waiting: "Waiting",
  woke: null,
};

describe("THREAD_STATUS_LABELS", () => {
  it("labels every status kind upstream derives, except Woke", () => {
    const derived = new Set<SidebarV2TopStatusKind>();
    for (const status of Object.keys(EVERY_STATUS) as SidebarThreadStatus[]) {
      for (const isUnread of [false, true]) {
        for (const isWoke of [false, true]) {
          const kind = resolveSidebarV2TopStatus({ status, isUnread, isWoke });
          if (kind === null) continue;
          derived.add(kind);
          expect(resolveThreadStatusLabel({ status, isUnread, isWoke })?.label ?? null).toBe(
            EXPECTED_LABELS[kind],
          );
        }
      }
    }
    expect([...derived].toSorted()).toEqual(Object.keys(EXPECTED_LABELS).toSorted());
    expect(Object.keys(THREAD_STATUS_LABELS).toSorted()).toEqual(
      Object.keys(EXPECTED_LABELS)
        .filter((kind) => kind !== "woke")
        .toSorted(),
    );
  });

  it("shows waiting in gray and limited in amber", () => {
    expect(THREAD_STATUS_LABELS.waiting.className).toBe("text-muted-foreground");
    expect(THREAD_STATUS_LABELS.limited.className).toBe("text-warning-foreground");
    expect(THREAD_STATUS_LABELS.approval.className).toBe("text-warning-foreground");
  });
});

// ── Upstream's detailed card row, through the hook in Sidebar.tsx ──

type DetailedRowProps = ComponentProps<typeof SidebarThreadRow>;

function detailedThread(id: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id,
    environmentId: "env-local",
    projectId: "project",
    title: `Thread ${id}`,
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt" },
    branch: null,
    worktreePath: null,
    latestRun: null,
    runtime: null,
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    pinnedAt: null,
    lastVisitedAt: now,
    titleRegeneration: null,
    pullRequests: [],
    branchPullRequest: null,
    linkedPullRequest: null,
    ...overrides,
  } as unknown as DetailedRowProps["thread"];
}

function detailedProps(thread: DetailedRowProps["thread"]): DetailedRowProps {
  const noop = () => undefined;
  return {
    thread,
    variant: "card",
    variantAction: "settle",
    settlementSupported: false,
    snoozeSupported: false,
    pinningSupported: false,
    isPinned: false,
    dropVerb: null,
    dragOverPinned: false,
    sweepAction: null,
    snoozeWakeLabelText: null,
    wokeAt: null,
    isActive: false,
    openPullRequestsInRightPanel: false,
    jumpLabel: null,
    currentEnvironmentId: "env-local",
    environmentLabel: null,
    environmentMachine: "local",
    project: null,
    projectDisplayName: "UpComputer",
    providerEntryByInstanceId: new Map(),
    timestampFormat: "locale",
    isRenaming: false,
    renamingTitle: "",
    changeRequestSnapshot: null,
    onThreadClick: noop,
    onThreadActivate: noop,
    onStartRename: noop,
    onRenameTitleChange: noop,
    onCommitRename: noop,
    onCancelRename: noop,
    onContextMenu: noop,
    onSettle: noop,
    onActionSweepStart: noop,
    onUnsettle: noop,
    onSnooze: noop,
    onUnsnooze: noop,
    onUnpin: noop,
    onAcknowledgeWoke: noop,
    onChangeRequestSnapshot: noop,
  } as unknown as DetailedRowProps;
}

const DETAILED_THREADS = () => [
  detailedThread("working", { runtime: { status: "running" } }),
  detailedThread("waiting", { runtime: { status: "idle" } }),
  detailedThread("approval", { hasPendingApprovals: true }),
  detailedThread("limited", { runtime: { status: "failed", lastErrorClass: "usage_limit" } }),
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  surface.sidebarThreadRow = "upcomputer";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderDetailed(threads: ReadonlyArray<DetailedRowProps["thread"]>) {
  return act(async () => {
    root.render(
      <ul>
        {threads.map((thread) => (
          <SidebarThreadRow key={thread.id} {...detailedProps(thread)} />
        ))}
      </ul>,
    );
  });
}

const cardRows = () => [
  ...container.querySelectorAll<HTMLElement>("[data-testid='sidebar-row-card']"),
];
// The card's status slot: the element upstream's status indicator renders into.
const statusSlot = (row: HTMLElement) =>
  row.querySelector("[role='status']")?.closest(".tabular-nums") ?? null;

describe("detailed rows", () => {
  it("show the text label in place of upstream's status indicator, without an icon", async () => {
    await renderDetailed(DETAILED_THREADS());
    const rows = cardRows();
    expect(
      rows.map((row) => {
        const label = row.querySelector("[data-testid='sidebar-row-status']");
        return [label?.textContent ?? null, label?.className ?? null];
      }),
    ).toEqual([
      ["Working", "shrink-0 whitespace-nowrap text-info-foreground"],
      ["Waiting", "shrink-0 whitespace-nowrap text-muted-foreground"],
      ["Pending Approval", "shrink-0 whitespace-nowrap text-warning-foreground"],
      ["Limited", "shrink-0 whitespace-nowrap text-warning-foreground"],
    ]);
    for (const row of rows) {
      expect(statusSlot(row)?.querySelector("svg")).toBeNull();
    }
  });

  it("stay upstream's with the upstream surface", async () => {
    surface.sidebarThreadRow = "upstream";
    await renderDetailed(DETAILED_THREADS());
    const rows = cardRows();
    expect(container.querySelector("[data-testid='sidebar-row-status']")).toBeNull();
    expect(rows.map((row) => row.querySelector("[role='status']")?.textContent)).toEqual([
      "Working",
      "Waiting",
      "Approval",
      "Limited",
    ]);
    // Upstream's icons: working, approval and limited have one; waiting has none.
    expect(rows.map((row) => statusSlot(row)?.querySelector("svg") !== null)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });
});
