import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { it } from "vite-plus/test";

import {
  AgentsView,
  TasksView,
  type AgentsViewProps,
  type TasksViewProps,
} from "@t3tools/tasks-web";

import { SidebarProvider } from "../components/ui/sidebar";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * Whole Up.computer pages with realistic content: the Workers tasks table and the
 * Workers list, at a wide and a narrow width. Run with
 * `--locale de` or `--locale ru` to see how the longer languages fit.
 */

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const PROJECT: TasksViewProps["projects"][number] = {
  environmentId: ENVIRONMENT_ID,
  id: ProjectId.make("project-ui-states"),
  name: "upcomputer",
  workspaceRoot: "/Users/me/upcomputer",
  favicon: {
    environmentId: ENVIRONMENT_ID,
    workspaceRoot: "/Users/me/upcomputer",
    title: "upcomputer",
    faviconPath: null,
    projectIcon: null,
  },
  groupKey: "upcomputer",
  pickId: ProjectId.make("project-ui-states"),
};

function task(index: number, title: string, status: string, tags: string[]) {
  return {
    id: `task-ui-states-${index}`,
    rank: `00000000000000${10 + index}`,
    projectId: PROJECT.id,
    title,
    description: "",
    output: null,
    status,
    priority: null,
    createdBy: "user",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: "2026-11-09T00:00:00.000Z",
    audience: "agent",
    kind: "task",
    environmentId: ENVIRONMENT_ID,
    projectName: PROJECT.name,
    runCounts: [],
  } as unknown as TasksViewProps["tasks"][number];
}

const TASKS = [
  task(1, "Translate the planner into every UI language", "In Progress", ["dev-2"]),
  task(2, "Sidebar footer: even buttons", "Needs Review", ["ui"]),
  task(3, "Release notes for 0.0.39", "To Do", []),
  task(4, "Bots: drag to reorder", "Done", ["dev-1"]),
];

function agent(index: number, name: string, enabled: boolean, tags: string[]) {
  return {
    id: `agent-ui-states-${index}`,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    name,
    enabled,
    startStatuses: ["To Do"],
    startTags: tags,
    startRunStatuses: [],
    config: {
      role: "Worker",
      instructions: "Work through the task.",
      modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
      interactionMode: "default",
    },
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    archivedAt: null,
  } as unknown as AgentsViewProps["agents"][number];
}

const AGENTS = [agent(1, "Developer", true, ["dev-1"]), agent(2, "Reviewer", false, ["review"])];

type Frame = "wide" | "narrow";
const FRAME_WIDTH: Record<Frame, number> = { wide: 960, narrow: 480 };

function Frame(props: { readonly frame: Frame; readonly children: ReactNode }) {
  return (
    <SidebarProvider className="min-h-0">
      <div
        className="-mx-(--sidebar-content-inset) -my-1 flex h-96 flex-col overflow-hidden border border-border bg-background"
        style={{ width: FRAME_WIDTH[props.frame] }}
      >
        {props.children}
      </div>
    </SidebarProvider>
  );
}

const noop = () => undefined;

function states(frame: Frame): ReadonlyArray<UiState> {
  const framed = (name: string, render: () => ReactNode): UiState => ({
    name,
    render: () => <Frame frame={frame}>{render()}</Frame>,
  });
  return [
    framed("Workers · Tasks table", () => (
      <TasksView
        layout="page"
        projects={[PROJECT]}
        tasks={TASKS}
        statuses={["To Do", "In Progress", "Needs Review", "Done"]}
        projectFilter={null}
        projectSelect={<span className="text-sm">upcomputer</span>}
        filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
        onFiltersChange={noop}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
        agents={AGENTS}
        runs={[]}
        providerEntriesByEnvironment={new Map()}
        status="ready"
        canMutateEnvironment={() => true}
        getClient={() => null}
        onReload={noop}
        onNavigateBack={noop}
        onOpenThread={noop}
      />
    )),
    framed("Workers · list", () => (
      <AgentsView
        projects={[{ ...PROJECT, defaultModelSelection: AGENTS[0]!.config.modelSelection }]}
        agents={AGENTS}
        tasks={TASKS}
        runs={[]}
        status="ready"
        canMutateEnvironment={() => true}
        providerCatalogByEnvironment={new Map()}
        getClient={() => null}
        onReload={noop}
        onNavigateBack={noop}
        onOpenTask={noop}
        onOpenThread={noop}
      />
    )),
  ];
}

it("workspace-pages", async () => {
  await captureUiStateSheet(
    "workspace-pages",
    [
      { title: "Page, wide (960px)", states: states("wide") },
      { title: "Page, narrow (480px)", states: states("narrow") },
    ],
    { cellWidth: FRAME_WIDTH.wide },
  );
});
