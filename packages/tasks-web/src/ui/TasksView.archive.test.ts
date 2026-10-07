import {
  TASK_ARCHIVED_EVENT,
  TASK_STATUS_CHANGED_EVENT,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { ScopedTaskListItem } from "../state/taskPages.ts";
import type { TasksPageFilters } from "./pageFilters.ts";

const passthrough = vi.hoisted(
  () =>
    (type: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      createElement(type, props, children),
);

vi.mock("../../../../apps/web/src/components/ui/toast.tsx", () => ({
  toastManager: { add: () => {} },
  stackedThreadToast: (toast: unknown) => toast,
}));
// A select exposes its value and change handler; tests find it by its trigger's label.
vi.mock("../../../../apps/web/src/components/ui/select.tsx", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => createElement("div", { "data-select": true, value, onValueChange }, children),
  SelectTrigger: passthrough("button"),
  SelectValue: passthrough("span"),
  SelectPopup: passthrough("span"),
  SelectItem: passthrough("span"),
}));
vi.mock("../../../../apps/web/src/components/ui/collapsible.tsx", () => ({
  Collapsible: passthrough("section"),
  CollapsibleTrigger: passthrough("div"),
  CollapsibleContent: passthrough("div"),
}));
vi.mock("../../../../apps/web/src/components/ProjectFavicon.tsx", () => ({
  ProjectFavicon: () => null,
}));
vi.mock("../../../../apps/web/src/components/ChatMarkdown.tsx", () => ({
  default: ({ text }: { text: string }) => createElement("div", null, text),
}));
vi.mock("./WorkspaceViewLayout.tsx", () => ({
  WorkspaceViewLayout: ({
    action,
    toolbar,
    children,
  }: {
    action?: { ariaLabel: string; label?: string; disabled?: boolean; onClick: () => void };
    toolbar?: ReactNode;
    children: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      action
        ? createElement(
            "button",
            {
              "aria-label": action.ariaLabel,
              disabled: action.disabled,
              onClick: action.onClick,
            },
            action.label,
          )
        : null,
      createElement("header", null, toolbar),
      children,
    ),
}));
vi.mock("./TaskThreadLink.tsx", () => ({ TaskThreadLink: () => null }));
vi.mock("./agentModelOptions.ts", () => ({
  getTaskRunAgentPresentation: () => ({ agentName: "Agent", modelLabel: "Model" }),
}));
vi.mock("./ProjectIconCell.tsx", () => ({
  ProjectIconCell: () => null,
  ProjectIconHeader: () => null,
}));
vi.mock("./TagFilterCombobox.tsx", () => ({ TagFilterCombobox: () => null }));
vi.mock("./RunCountNumbers.tsx", () => ({ TableRunCounts: () => null }));
vi.mock("./TaskTagChips.tsx", () => ({ TaskTagChips: () => null }));

import { TasksView } from "./TasksView.tsx";

const created = "2026-10-07T09:00:00.000Z";
const task = (overrides: Partial<ScopedTaskListItem> = {}) =>
  ({
    id: "task-1",
    rank: "0000000000000010",
    projectId: "project-1",
    title: "Tidy the backlog",
    description: "",
    output: null,
    status: "To Do",
    priority: null,
    createdBy: "user",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: [],
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: created,
    environmentId: "local",
    projectName: "Project",
    runCounts: [],
    latestRunStatus: null,
    ...overrides,
  }) as unknown as ScopedTaskListItem;

const history: TaskEvent[] = [
  {
    id: "event-2",
    taskId: "task-1",
    kind: TASK_ARCHIVED_EVENT,
    payload: { actor: { type: "person" }, reason: "Obsolete" },
    createdAt: "2026-10-07T10:00:00.000Z",
  },
  {
    id: "event-1",
    taskId: "task-1",
    kind: TASK_STATUS_CHANGED_EVENT,
    payload: { from: "Backlog", to: "To Do", actor: { type: "thread", threadId: "thread-1" } },
    createdAt: "2026-10-07T09:30:00.000Z",
  },
] as never;

let renderer: ReactTestRenderer;
let stored: ScopedTaskListItem;
const calls = {
  update: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  events: vi.fn(),
};
const client = {
  tasks: {
    get: async () => stored,
    subscribe: () => () => {},
    events: async (input: unknown) => {
      calls.events(input);
      return { events: history };
    },
    update: async (input: { status?: string }) => {
      calls.update(input);
      stored = task({ ...stored, ...input });
      return stored;
    },
    archive: async (input: unknown) => {
      calls.archive(input);
      stored = task({ ...stored, archivedAt: "2026-10-07T10:00:00.000Z" });
      return { results: [{ id: "task-1", outcome: "archived" }] };
    },
    unarchive: async (input: unknown) => {
      calls.unarchive(input);
      stored = task({ ...stored, archivedAt: null });
      return { results: [{ id: "task-1", outcome: "unarchived" }] };
    },
  },
  agents: { searchRuns: async () => ({ runs: [] }) },
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  stored = task();
  for (const call of Object.values(calls)) call.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function render(props: { filters?: TasksPageFilters; selected?: boolean } = {}) {
  const onFiltersChange = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(TasksView, {
        projects: [],
        tasks: [stored],
        statuses: ["To Do", "done"],
        projectFilter: null,
        filters: props.filters ?? { status: "__all__", lastRun: "__all__", tags: [] },
        onFiltersChange,
        hasMore: false,
        loadingMore: false,
        onLoadMore: () => {},
        agents: [],
        runs: [],
        providerEntriesByEnvironment: new Map(),
        status: "ready",
        ...(props.selected ? { initialSelectedTaskKey: "local:task-1" } : {}),
        canMutateEnvironment: () => true,
        getClient: () => client as never,
        onReload: () => {},
        onNavigateBack: () => {},
        onOpenThread: () => {},
      } as never),
    );
  });
  return { onFiltersChange };
}

function selectLabelled(label: string): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      node.props["data-select"] === true &&
      node.findAll((child) => child.props["aria-label"] === label).length > 0,
  );
}

function button(label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === "button" && node.props["aria-label"] === label);
}

const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");

it("the archive filter offers active, archived and all, and starts at active", async () => {
  const { onFiltersChange } = await render();
  const archive = selectLabelled("Filter by archive");
  expect(archive.props.value).toBe("active");
  expect(text(archive)).toContain("Active and archived");

  await act(async () => archive.props.onValueChange("archived"));
  expect(onFiltersChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ archive: "archived", status: "__all__" }),
  );
  await act(async () => archive.props.onValueChange("all"));
  expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ archive: "all" }));
});

it("an archived row is marked in the table when archived tasks are shown", async () => {
  stored = task({ archivedAt: "2026-10-07T10:00:00.000Z" });
  await render({ filters: { status: "__all__", lastRun: "__all__", tags: [], archive: "all" } });
  const row = renderer.root.find((node) => node.type === "tr" && text(node).includes("Tidy"));
  expect(text(row)).toContain("Archived");
});

it("the detail archives and unarchives the task without touching its status", async () => {
  await render({ selected: true });
  expect(text(renderer.root.findByType("header"))).not.toContain("Archived");

  await act(async () => button("Archive task").props.onClick());
  expect(calls.archive).toHaveBeenCalledWith({ ids: ["task-1"] });
  expect(calls.update).not.toHaveBeenCalled();
  const header = renderer.root.findByType("header");
  expect(text(header)).toContain("Archived");
  expect(button("Unarchive task").props.children).toBe("Unarchive");

  await act(async () => button("Unarchive task").props.onClick());
  expect(calls.unarchive).toHaveBeenCalledWith({ ids: ["task-1"] });
  expect(button("Archive task")).toBeTruthy();
});

it("choosing done only changes the status", async () => {
  await render({ selected: true });
  await act(async () => selectLabelled("Task status").props.onValueChange("done"));
  expect(calls.update).toHaveBeenCalledWith({ id: "task-1", status: "done" });
  expect(calls.archive).not.toHaveBeenCalled();
});

it("the detail shows the status and archive history as a timeline", async () => {
  await render({ selected: true });
  expect(calls.events).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: "task-1",
      kinds: ["task.status-changed", "task.archived", "task.unarchived"],
    }),
  );
  const timeline = renderer.root.find(
    (node) => node.type === "ol" && node.props["aria-label"] === "Task history",
  );
  const entries = timeline.findAllByType("li").map(text);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toContain("Archived");
  expect(entries[0]).toContain("Person: Obsolete");
  expect(entries[1]).toContain("Backlog → To Do");
  expect(entries[1]).toContain("Chat agent");
});
