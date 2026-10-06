import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";
import * as NodeURL from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ScopedTaskListItem } from "../state/taskPages.ts";
import { assertTableRowsOneSize } from "./tableRows.testing.ts";

const source = NodeFS.readFileSync(new URL("./TasksView.tsx", import.meta.url), "utf8");
const selectedDetail = source.slice(
  source.indexOf("{selectedTask ? ("),
  source.indexOf(") : createModeOpen ? ("),
);
const mainColumn = selectedDetail.slice(0, selectedDetail.indexOf("<DetailColumn>"));
const sidebar = selectedDetail.slice(selectedDetail.indexOf("<DetailColumn>"));

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
          export const SelectButton = ({ children, ...props }) => React.createElement("button", props, children);
        `;
        },
      },
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@t3tools/contracts": NodeURL.fileURLToPath(
          new URL("../../../../packages/contracts/src/index.ts", import.meta.url),
        ),
        "~": NodeURL.fileURLToPath(new URL("../../../../apps/web/src", import.meta.url)),
        "@t3tools/client-runtime/environment": NodeURL.fileURLToPath(
          new URL("../../../../packages/client-runtime/src/environment/index.ts", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@base-ui/react"], external: ["lucide"] },
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
  const makeTask = (
    id: string,
    rank: string,
    title: string,
    extra: Partial<ScopedTaskListItem> = {},
  ): ScopedTaskListItem =>
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
      latestRunStatus: "running",
      ...extra,
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
    providerEntriesByEnvironment: new Map(),
    status: "ready",
    statuses: ["Backlog", "in progress"],
    projectFilter: null,
    projectSelect: createElement("button", { "aria-label": "Filter by project" }, "All projects"),
    filters: { status: "__all__", lastRun: "__all__", tags: [] },
    onFiltersChange: () => undefined,
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
  NodeAssert.match(html, /data-run-count="Working" aria-label="Show Working runs \(1\)">1</);
  NodeAssert.match(html, /data-run-count="Failed" aria-label="Show Failed runs \(1\)">1</);
  NodeAssert.match(html, /Load more tasks/);
  NodeAssert.doesNotMatch(html, /tasks loaded|More available/);
  NodeAssert.match(html, /in progress/);
  NodeAssert.ok(html.indexOf("First") < html.indexOf("Second"));
  NodeAssert.ok(html.indexOf("Second") < html.indexOf("Third"));
  NodeAssert.match(html, /draggable="true"[^>]*aria-label="Reorder First"/);
  NodeAssert.equal(html.match(/aria-label="Reorder /g)?.length, 3);
  NodeAssert.doesNotMatch(html, /draggable="true"[^>]*>First/);
  NodeAssert.match(html, /aria-label="Filter by project">All projects</);
  NodeAssert.match(html, /aria-label="Filter by last run"/);
  NodeAssert.match(html, /aria-label="Filter by tags"/);
  NodeAssert.doesNotMatch(html, /<th[^>]*>Project<\/th>/, "no Project text column");
  NodeAssert.equal(html.match(/data-project-icon=/g)?.length, 3, "a project icon per row");
  NodeAssert.ok(
    html.indexOf('aria-label="Reorder First"') < html.indexOf("data-project-icon="),
    "the project icon comes right after the drag handle",
  );

  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(
        SidebarProvider as never,
        null,
        createElement(TasksView, { ...view.props, ...props } as never),
      ),
    );
  const oneProject = render({
    projectFilter: {
      key: "repo:upcomputer",
      label: "UpComputer",
      projectRefs: [{ environmentId: "local", projectId: "project-1" }],
    },
  });
  NodeAssert.doesNotMatch(oneProject, /data-project-icon=/, "one project: no icon column");
  NodeAssert.doesNotMatch(oneProject, /<span class="sr-only">Project<\/span>/);

  // Tags: two chips, then +N; an enabled agent's trigger tag is dimmer.
  const tagged = render({
    tasks: [
      makeTask("task-1", "0000000000000010", "First", {
        tags: ["ui", "browser-use", "dev-2", "extra"],
      }),
    ],
    agents: [
      { enabled: true, startTags: ["browser-use"] },
      { enabled: false, startTags: ["ui"] },
    ],
  });
  NodeAssert.match(tagged, />Tags<\/th>/);
  NodeAssert.match(tagged, />ui<\/span>/);
  NodeAssert.match(tagged, />browser-use<\/span>/);
  NodeAssert.doesNotMatch(tagged, />dev-2<\/span>/, "tags past the first two collapse");
  NodeAssert.match(tagged, />\+2</);
  NodeAssert.equal(tagged.match(/data-trigger-tag=""/g)?.length, 1);
  NodeAssert.match(
    tagged,
    /data-trigger-tag=""><span class="[^"]*\bopacity-50\b[^"]*" data-table-pill="dim"><span class="truncate">browser-use</,
  );

  // One text size: tags and "+N" are pills at text-sm, run counts the sidebar's bare numbers.
  assertTableRowsOneSize(tagged);
  NodeAssert.equal(tagged.match(/data-table-pill=/g)?.length, 3, "2 tags and +2, no run pills");
  NodeAssert.ok(
    tagged.indexOf('data-run-count="Working"') < tagged.indexOf('data-run-count="Failed"'),
    "run counts in badge order",
  );

  // Columns: Status before Tags; Runs as narrow as its numbers, right-aligned at the edge.
  const headers = [...html.matchAll(/<th class="([^"]*)">([^<]*)<\/th>/g)];
  NodeAssert.deepEqual(
    headers.map((match) => match[2]),
    ["Title", "Status", "Tags", "Runs"],
  );
  const columnClass = (name: string) => headers.find((match) => match[2] === name)![1]!;
  NodeAssert.doesNotMatch(columnClass("Title"), /(^|\s)w-/, "Title takes the remaining width");
  NodeAssert.match(columnClass("Runs"), /(^|\s)w-px(\s|$)/, "Runs shrinks to its content");
  NodeAssert.doesNotMatch(columnClass("Runs"), /(^|\s)w-(?!px\b)/, "no wide fixed Runs width");
  NodeAssert.match(columnClass("Runs"), /(^|\s)text-right(\s|$)/);
  NodeAssert.doesNotMatch(html, /<table[^>]*\btable-fixed\b/, "fixed layout would ignore w-px");
  const runCells = [...html.matchAll(/<td class="([^"]*)"><span[^>]*data-table-run-counts=/g)];
  NodeAssert.equal(runCells.length, 3);
  for (const [, className] of runCells) {
    NodeAssert.match(className!, /(^|\s)text-right(\s|$)/, "run counts sit at the right edge");
  }

  // Last run: only each task's latest run counts.
  const runs = [
    makeTask("task-1", "0000000000000010", "Retried", {
      runCounts: [
        { status: "failed", count: 1 },
        { status: "completed", count: 1 },
      ],
      latestRunStatus: "completed",
    } as Partial<ScopedTaskListItem>),
    makeTask("task-2", "0000000000000020", "Broken", {
      runCounts: [{ status: "failed", count: 2 }],
      latestRunStatus: "failed",
    } as Partial<ScopedTaskListItem>),
    makeTask("task-3", "0000000000000030", "Fresh", {
      runCounts: [],
      latestRunStatus: null,
    } as Partial<ScopedTaskListItem>),
  ];
  const lastRun = (value: string) => {
    const markup = render({
      tasks: runs,
      filters: { status: "__all__", lastRun: value, tags: [] },
    });
    return ["Retried", "Broken", "Fresh"].filter((title) =>
      markup.includes(`aria-label="Reorder ${title}"`),
    );
  };
  NodeAssert.deepEqual(lastRun("completed"), ["Retried"]);
  NodeAssert.deepEqual(lastRun("failed"), ["Broken"], "an older failed run does not count");
  NodeAssert.deepEqual(lastRun("__none__"), ["Fresh"]);
  NodeAssert.deepEqual(lastRun("__all__"), ["Retried", "Broken", "Fresh"]);

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
  NodeAssert.match(sidebar, /^<DetailColumn>/);
});

test("task details caption tags as Tags, with no Labels left in tasks-web text", () => {
  NodeAssert.equal(
    source.match(/<DetailSidebarRow\s+label="Tags"/g)?.length,
    2,
    "detail and create",
  );
  NodeAssert.equal(source.match(/placeholder="Add tags…"/g)?.length, 2);
  NodeAssert.equal(source.match(/aria-label="Task tags"/g)?.length, 2);
  const uiDir = new URL("./", import.meta.url);
  for (const file of NodeFS.readdirSync(uiDir)) {
    if (!file.endsWith(".tsx")) continue;
    const text = NodeFS.readFileSync(new URL(file, uiDir), "utf8");
    NodeAssert.doesNotMatch(text, /\bLabels\b|"[^"\n]*\blabels\b[^"\n]*"/, file);
  }
});
