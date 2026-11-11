import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { it, vi } from "vite-plus/test";

import { TasksView, type TasksViewProps } from "@t3tools/tasks-web";
import {
  AutomationsView,
  ListHeader,
  PlannerContext,
  PlannerView,
  TableSectionSwitch,
  TasksViewSwitch,
  windowStoreFor,
  type PlannerContextValue,
} from "@t3tools/tasks-web/planner";

import { SidebarProvider } from "../components/ui/sidebar";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The Tasks workspace header on every tab: Me (Tasks, Routines) and Workers
 * (Tasks, Automations), a create mode and a selected task, on the page at a
 * wide and a narrow width and in the right panel.
 */

// The planner and automations wait for an environment's Tasks probe; none is connected here.
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePlannerAvailability: () => null,
}));

// A second computer, asleep, named as the sidebar's Computers section names it.
vi.mock("../sidebarComputers/useSidebarComputers.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComputerName: () => "DESKTOP-UPI195K",
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const ASLEEP_ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states-asleep");
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
};
const TASK = {
  id: "task-ui-states",
  rank: "0000000000000010",
  projectId: PROJECT.id,
  title: "Tasks workspace header: one header for every tab",
  description: "",
  output: null,
  status: "In Progress",
  priority: null,
  createdBy: "user",
  assigneeAgentRunId: null,
  sourceThreadId: null,
  sourceRunId: null,
  rootThreadId: null,
  parentTaskId: null,
  parentRunId: null,
  metadata: null,
  tags: ["dev-2"],
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

type Frame = "wide" | "narrow" | "panel";
const FRAME_WIDTH: Record<Frame, number> = { wide: 960, narrow: 480, panel: 400 };

/** A page view fills the window (`h-dvh`); the cell shows its header and the top of its content. */
function Frame(props: { readonly frame: Frame; readonly children: ReactNode }) {
  return (
    <SidebarProvider className="min-h-0">
      <div
        className="-mx-(--sidebar-content-inset) -my-1 flex h-28 flex-col overflow-hidden border border-border bg-background"
        style={{ width: FRAME_WIDTH[props.frame] }}
      >
        {props.children}
      </div>
    </SidebarProvider>
  );
}

const noop = () => undefined;

const workersSwitch = (section: "tasks" | "automations") => (
  <>
    <TasksViewSwitch value="table" onChange={noop} />
    <TableSectionSwitch value={section} onChange={noop} />
  </>
);

function TasksTable(props: {
  readonly frame: Frame;
  readonly selected?: boolean;
  readonly asleep?: boolean;
}) {
  return (
    <TasksView
      layout={props.frame === "panel" ? "panel" : "page"}
      projects={[PROJECT]}
      tasks={[TASK]}
      statuses={["In Progress"]}
      projectFilter={null}
      viewSwitch={workersSwitch("tasks")}
      projectSelect={<span className="text-sm">All projects</span>}
      filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
      onFiltersChange={noop}
      hasMore={false}
      loadingMore={false}
      onLoadMore={noop}
      agents={[]}
      runs={[]}
      providerEntriesByEnvironment={new Map()}
      status="ready"
      {...(props.asleep ? { offlineEnvironmentIds: [ASLEEP_ENVIRONMENT_ID] } : {})}
      {...(props.selected ? { initialSelectedTaskKey: `${TASK.environmentId}:${TASK.id}` } : {})}
      canMutateEnvironment={() => true}
      getClient={() => null}
      onReload={noop}
      onNavigateBack={noop}
      onOpenThread={noop}
    />
  );
}

/** The planner's list header, the Me side's header once the planner shows. */
function PlannerListHeader(props: { readonly frame: Frame; readonly kind: "task" | "routine" }) {
  // ListHeader reads only the environment, its windows and the kind.
  const context = {
    environmentId: ENVIRONMENT_ID,
    windows: windowStoreFor(ENVIRONMENT_ID, props.frame === "panel" ? "panel" : "page"),
    kind: props.kind,
  } as unknown as PlannerContextValue;
  return (
    <PlannerContext value={context}>
      <ListHeader
        viewSwitch={<TasksViewSwitch value="planner" onChange={noop} />}
        onKindChange={noop}
        environments={[]}
        onEnvironmentChange={noop}
        showArchived={false}
        onToggleArchived={noop}
        selectMode={false}
        selected={[]}
        queueDate={null}
        onSelectModeChange={noop}
        onMoveUnder={noop}
        onDelete={noop}
        canHideWeek={props.frame === "wide"}
        weekHidden={false}
        onToggleWeek={noop}
        titleBar={props.frame !== "panel"}
      />
    </PlannerContext>
  );
}

async function openCreateTask(cell: HTMLElement) {
  cell.querySelector<HTMLElement>('[data-track="tasks.create"]')!.click();
  await vi.waitFor(() => {
    if (!cell.querySelector('[data-track="tasks.create_save"]')) throw new Error("no create form");
  });
}

function states(frame: Frame): ReadonlyArray<UiState> {
  const panel = frame === "panel";
  const framed = (name: string, render: () => ReactNode, settle?: UiState["settle"]): UiState => ({
    name,
    render: () => <Frame frame={frame}>{render()}</Frame>,
    ...(settle ? { settle } : {}),
  });
  return [
    framed("Me · Tasks (planner)", () => <PlannerListHeader frame={frame} kind="task" />),
    framed("Me · Routines (planner)", () => <PlannerListHeader frame={frame} kind="routine" />),
    framed("Me · before the planner shows", () => (
      <PlannerView
        panel={panel}
        viewSwitch={<TasksViewSwitch value="planner" onChange={noop} />}
        projects={[PROJECT]}
        taskTargets={[]}
        agents={[]}
        onShowTable={noop}
        onOpenTask={noop}
        onNavigateBack={noop}
      />
    )),
    framed("Workers · Tasks", () => <TasksTable frame={frame} />),
    framed("Workers · Tasks · New task", () => <TasksTable frame={frame} />, openCreateTask),
    framed("Workers · Tasks · a selected task", () => <TasksTable frame={frame} selected />),
    framed("Workers · Tasks · another computer asleep: a quiet note, no error", () => (
      <TasksTable frame={frame} asleep />
    )),
    framed("Workers · Automations", () => (
      <AutomationsView
        panel={panel}
        viewSwitch={workersSwitch("automations")}
        projects={[PROJECT]}
        taskTargets={[]}
        agents={[]}
        onOpenTask={noop}
        onOpenInPlanner={noop}
        onNavigateBack={noop}
      />
    )),
  ];
}

it("tasks-header", async () => {
  await captureUiStateSheet(
    "tasks-header",
    [
      { title: "Page, wide (960px)", states: states("wide") },
      { title: "Page, narrow (480px)", states: states("narrow") },
      { title: "Right panel (400px)", states: states("panel") },
    ],
    { cellWidth: FRAME_WIDTH.wide },
  );
});
