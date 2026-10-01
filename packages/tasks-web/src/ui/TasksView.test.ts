import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";
import * as NodeURL from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ScopedTaskListItem } from "../state/taskPages.ts";

const source = NodeFS.readFileSync(new URL("./TasksView.tsx", import.meta.url), "utf8");
const selectedDetail = source.slice(
  source.indexOf("{selectedTask ? ("),
  source.indexOf(") : createModeOpen ? ("),
);
const mainColumn = selectedDetail.slice(0, selectedDetail.indexOf("<aside"));
const sidebar = selectedDetail.slice(selectedDetail.indexOf("<aside"));

test("source thread is conditionally rendered once in the detail sidebar", () => {
  NodeAssert.doesNotMatch(mainColumn, /Source thread/);
  NodeAssert.equal(sidebar.match(/selectedTask\.sourceThreadId \? \(/g)?.length, 1);
  NodeAssert.match(
    sidebar,
    /\{selectedTask\.sourceThreadId \? \([\s\S]*?<DetailSidebarSection title="Source thread">[\s\S]*?<\/DetailSidebarSection>\s*\) : null\}/,
  );
  NodeAssert.equal(sidebar.match(/<DetailSidebarSection title="Source thread">/g)?.length, 1);
  NodeAssert.equal(sidebar.match(/title="Source thread"/g)?.length, 2);

  const detailsIndex = sidebar.indexOf('<DetailSidebarSection title="Details">');
  const sourceThreadIndex = sidebar.indexOf('<DetailSidebarSection title="Source thread">');
  const runsIndex = sidebar.indexOf('<DetailSidebarSection title="Runs"');
  NodeAssert.ok(detailsIndex < sourceThreadIndex);
  NodeAssert.ok(sourceThreadIndex < runsIndex);
});

test("agent executions retain the canonical Runs label across task surfaces", () => {
  NodeAssert.match(sidebar, /<DetailSidebarSection title="Runs" count=\{detailRuns\.length\}>/);
  NodeAssert.doesNotMatch(sidebar, /<DetailSidebarSection title="Threads"/);
  NodeAssert.match(source, /<th[^>]*>Runs<\/th>/);
});

test("task rows expose isolated pointer and keyboard reorder controls", () => {
  NodeAssert.match(source, /aria-label=\{`Reorder \$\{props\.task\.title\}`\}/);
  NodeAssert.match(source, /draggable=\{props\.enabled\}/);
  NodeAssert.match(source, /event\.key !== "ArrowUp" && event\.key !== "ArrowDown"/);
  NodeAssert.match(source, /event\.stopPropagation\(\);[\s\S]*persistVisibleMove/);
  NodeAssert.match(source, /planVisibleTaskMove\(\{/);
  NodeAssert.match(source, /persistPlannedTaskMove\(\{/);
  NodeAssert.match(source, /reorder: \(request\) => client\.tasks\.reorder\(request\)/);
  NodeAssert.match(source, /Tasks can only be reordered within one environment/);
  NodeAssert.match(source, /hidden tasks keep their order/i);
});

test("the rendered table preserves global order and exposes accessible isolated handles", async (context) => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    appType: "custom",
    plugins: [
      {
        name: "tasks-view-select-test-stub",
        enforce: "pre",
        resolveId(id) {
          return id.endsWith("/components/ui/select.tsx") ? "\0tasks-view-select-test-stub" : null;
        },
        load(id) {
          if (id !== "\0tasks-view-select-test-stub") return null;
          return `
          import React from "react";
          export const Select = ({ children }) => React.createElement(React.Fragment, null, children);
          export const SelectItem = ({ children }) => React.createElement("span", null, children);
          export const SelectPopup = ({ children }) => React.createElement("span", null, children);
          export const SelectTrigger = ({ children, ...props }) => React.createElement("button", props, children);
          export const SelectValue = ({ children }) => React.createElement(React.Fragment, null, children);
        `;
        },
      },
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@upcomputer/contracts": NodeURL.fileURLToPath(
          new URL("../../../../packages/contracts/src/index.ts", import.meta.url),
        ),
        "~": NodeURL.fileURLToPath(new URL("../../../../apps/web/src", import.meta.url)),
        "@upcomputer/client-runtime/environment": NodeURL.fileURLToPath(
          new URL("../../../../packages/client-runtime/src/environment/index.ts", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@base-ui/react"] },
  });
  context.onTestFinished(() => vite.close());
  const { TasksView, TaskReorderHandle } = (await vite.ssrLoadModule("/src/ui/TasksView.tsx")) as {
    TasksView: typeof import("./TasksView.tsx").TasksView;
    TaskReorderHandle: typeof import("./TasksView.tsx").TaskReorderHandle;
  };
  const publicWebSource = NodeURL.fileURLToPath(
    new URL("../../../../apps/web/src", import.meta.url),
  );
  const { SidebarProvider } = (await vite.ssrLoadModule(
    `/@fs/${publicWebSource}/components/ui/sidebar.tsx`,
  )) as { SidebarProvider: (props: { children: unknown }) => unknown };
  const makeTask = (id: string, rank: string, title: string): ScopedTaskListItem =>
    ({
      id,
      rank,
      projectId: "project-1",
      title,
      description: "",
      output: null,
      status: "Backlog",
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
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      closedAt: null,
      notBefore: null,
      triggerChangedAt: "2026-08-12T00:00:00.000Z",
      environmentId: "local",
      projectName: "Project",
      runCounts: [
        { status: "running", count: 1 },
        { status: "failed", count: 1 },
      ],
    }) as unknown as ScopedTaskListItem;
  const view = createElement(TasksView, {
    projects: [],
    tasks: [
      makeTask("task-1", "0000000000000010", "First"),
      makeTask("task-2", "0000000000000020", "Second"),
      makeTask("task-3", "0000000000000030", "Third"),
    ],
    agents: [],
    runs: [],
    status: "ready",
    statuses: ["Backlog", "in progress"],
    projectFilter: "__all__",
    statusFilter: "__all__",
    onProjectFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    hasMore: true,
    loadingMore: false,
    onLoadMore: () => undefined,
    canMutateEnvironment: () => true,
    getClient: () => null,
    onReload: () => undefined,
    onNavigateBack: () => undefined,
    onOpenThread: () => undefined,
  });
  const html = renderToStaticMarkup(createElement(SidebarProvider as never, null, view));

  NodeAssert.doesNotMatch(html, />ID<|>Assignee<|All assignees/);
  NodeAssert.match(html, /Working 1/);
  NodeAssert.match(html, /Failed 1/);
  NodeAssert.match(html, /Load more tasks/);
  NodeAssert.doesNotMatch(html, /tasks loaded|More available/);
  NodeAssert.match(html, /in progress/);
  NodeAssert.ok(html.indexOf("First") < html.indexOf("Second"));
  NodeAssert.ok(html.indexOf("Second") < html.indexOf("Third"));
  NodeAssert.match(html, /draggable="true"[^>]*aria-label="Reorder First"/);
  NodeAssert.equal(html.match(/aria-label="Reorder /g)?.length, 3);
  NodeAssert.doesNotMatch(html, /draggable="true"[^>]*>First/);
  NodeAssert.match(
    html,
    /aria-label="Filter by project">All projects<\/button><span><span>All projects</,
    "no sidebar option without a sidebar filter",
  );

  const sidebarScoped = renderToStaticMarkup(
    createElement(
      SidebarProvider as never,
      null,
      createElement(TasksView, {
        ...view.props,
        projectFilter: "__sidebar__",
        sidebarProjectFilter: {
          key: "repo:upcomputer",
          label: "UpComputer repo",
          projectRefs: [{ environmentId: "local", projectId: "project-1" }],
        },
      } as never),
    ),
  );
  NodeAssert.match(sidebarScoped, /aria-label="Filter by project"[^>]*>UpComputer repo</);
  NodeAssert.match(
    sidebarScoped,
    /<span><span>UpComputer repo<\/span><span>All projects<\/span>/,
    "the sidebar project leads the options and All projects stays available as a local override",
  );

  const moves: string[] = [];
  let dragStarts = 0;
  let dragEnds = 0;
  let stopped = 0;
  let prevented = 0;
  const handle = TaskReorderHandle({
    task: makeTask("task-1", "0000000000000010", "First"),
    enabled: true,
    onDragStart: () => {
      dragStarts += 1;
    },
    onDragEnd: () => {
      dragEnds += 1;
    },
    onMove: (direction) => moves.push(direction),
  }) as { props: Record<string, (event?: unknown) => void> };
  const dataTransfer = { effectAllowed: "none" };
  handle.props.onClick?.({
    stopPropagation: () => {
      stopped += 1;
    },
  });
  handle.props.onDragStart?.({
    dataTransfer,
    stopPropagation: () => {
      stopped += 1;
    },
  });
  handle.props.onKeyDown?.({
    key: "ArrowUp",
    preventDefault: () => {
      prevented += 1;
    },
    stopPropagation: () => {
      stopped += 1;
    },
  });
  handle.props.onKeyDown?.({ key: "Enter" });
  handle.props.onDragEnd?.();

  NodeAssert.equal(dragStarts, 1);
  NodeAssert.equal(dragEnds, 1);
  NodeAssert.equal(dataTransfer.effectAllowed, "move");
  NodeAssert.deepEqual(moves, ["up"]);
  NodeAssert.equal(prevented, 1);
  NodeAssert.equal(
    stopped,
    3,
    "normal clicks and reorder gestures stay isolated from row navigation",
  );
});

test("source thread link preserves its target and open behavior", () => {
  NodeAssert.match(
    sidebar,
    /<TaskThreadLink\s+environmentId=\{selectedTask\.environmentId\}\s+threadId=\{selectedTask\.sourceThreadId as ThreadId\}\s+title="Source thread"\s+onOpen=\{props\.onOpenThread\}/,
  );
  NodeAssert.match(sidebar, /className="flex min-w-0 flex-col gap-0\.5"/);
  NodeAssert.match(
    sidebar,
    /className="min-h-0 shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"/,
  );
  NodeAssert.match(sidebar, /style=\{\{ width: 380 \}\}/);
});
