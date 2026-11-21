import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { TASK_STATUS_CHANGED_EVENT, type TaskEvent } from "@t3tools/tasks-contracts/v1";
import type { ReactNode } from "react";
import { it, vi } from "vite-plus/test";

import { TasksView, type TasksViewProps } from "@t3tools/tasks-web";

import { SidebarProvider } from "../components/ui/sidebar";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * Worker task detail view: wide page (two columns) and narrow panel (stacked),
 * showing a task with output and runs, a task with no runs, and a running task.
 */

vi.mock("../../../../packages/tasks-web/src/ui/useOmittedThreadShell.ts", () => ({
  useOmittedThreadShell: (ref: { readonly threadId: string } | null) =>
    ref?.threadId === "thread-source-1"
      ? {
          id: ref.threadId,
          title: "Sidebar polish and tidy-up",
          deletedAt: null,
          hasPendingApprovals: false,
          createdAt: "2026-11-21T16:00:00.000Z",
          updatedAt: "2026-11-21T18:10:00.000Z",
        }
      : null,
}));

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

type Task = TasksViewProps["tasks"][number];
type Run = TasksViewProps["runs"][number];

const AGENTS: TasksViewProps["agents"] = [
  {
    id: "agent-dev-neon",
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    name: "Developer",
    enabled: true,
    startStatuses: ["To Do"],
    startTags: ["dev-neon"],
    startRunStatuses: [],
    config: {
      role: "Worker",
      instructions: "Implement the task.",
      modelSelection: { instanceId: "gemini", model: "gemini-4-neon" },
      interactionMode: "default",
    },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
  },
] as unknown as TasksViewProps["agents"];

function makeTask(
  id: string,
  title: string,
  overrides: {
    readonly status?: string;
    readonly description?: string;
    readonly output?: string | null;
    readonly sourceThreadId?: ThreadId | null;
    readonly tags?: readonly string[];
  } = {},
): Task {
  return {
    id,
    rank: "0000000000000010",
    projectId: PROJECT.id,
    title,
    description:
      overrides.description ??
      "Tidy up the worker task detail layout so the title wraps cleanly, sections have even spacing, and text matches chat.",
    output: overrides.output ?? null,
    status: overrides.status ?? "In Review",
    priority: null,
    createdBy: "agent",
    assigneeAgentRunId: null,
    sourceThreadId: overrides.sourceThreadId ?? null,
    sourceRunId: null,
    rootThreadId: overrides.sourceThreadId ?? null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: overrides.tags ?? ["dev-neon", "ui"],
    createdAt: "2026-11-21T16:00:00.000Z",
    updatedAt: "2026-11-21T18:30:00.000Z",
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: "2026-11-21T18:30:00.000Z",
    audience: "agent",
    kind: "task",
    environmentId: ENVIRONMENT_ID,
    projectName: PROJECT.name,
    runCounts: [],
    latestRunStatus: null,
  } as unknown as Task;
}

function makeRun(id: string, taskId: string, status: string, startedAt: string): Run {
  return {
    id,
    agentId: "agent-dev-neon",
    taskId,
    threadId: ThreadId.make(`thread-${id}`),
    environmentId: ENVIRONMENT_ID,
    modelSelection: { instanceId: "gemini", model: "gemini-4-neon" },
    status,
    startedAt,
    completedAt: status === "running" ? null : startedAt,
    error: null,
  } as unknown as Run;
}

const TASK_WITH_OUTPUT = makeTask(
  "task-detail-output",
  "Worker task detail: tidy up the sidebar, remove Active runs, and match chat text sizes",
  {
    status: "In Review",
    sourceThreadId: ThreadId.make("thread-source-1"),
    output: [
      "## Summary",
      "",
      "Updated the worker task detail view to match chat typography and simplify the sidebar.",
      "",
      "- Moved the editable title to the top of the main column.",
      "- Moved `Source thread` into Details and removed the separate Active runs section.",
      "- Matched Description and Output text to `text-sm leading-relaxed`.",
    ].join("\n"),
  },
);

const TASK_NO_RUNS = makeTask(
  "task-detail-no-runs",
  "Investigate slow diff scrolling on large pull requests with folded hunks",
  {
    status: "To Do",
    tags: ["ui"],
  },
);

const TASK_RUNNING = makeTask(
  "task-detail-running",
  "Refactor task detail sidebar sections and header actions menu",
  {
    status: "In Progress",
    sourceThreadId: ThreadId.make("thread-source-1"),
    tags: ["dev-neon", "ui"],
  },
);

const RUNS_BY_TASK: Record<string, readonly Run[]> = {
  [TASK_WITH_OUTPUT.id]: [
    makeRun("run-2", TASK_WITH_OUTPUT.id, "completed", "2026-11-21T18:20:00.000Z"),
    makeRun("run-1", TASK_WITH_OUTPUT.id, "failed", "2026-11-21T17:40:00.000Z"),
  ],
  [TASK_NO_RUNS.id]: [],
  [TASK_RUNNING.id]: [
    makeRun("run-active", TASK_RUNNING.id, "running", "2026-11-21T18:28:00.000Z"),
    makeRun("run-prev", TASK_RUNNING.id, "completed", "2026-11-21T17:50:00.000Z"),
  ],
};

const HISTORY_EVENTS: readonly TaskEvent[] = [
  {
    id: "event-1",
    taskId: TASK_WITH_OUTPUT.id,
    kind: TASK_STATUS_CHANGED_EVENT,
    payload: {
      from: "To Do",
      to: "In Progress",
      actor: { type: "agent-run", agentRunId: "run-2" },
    },
    createdAt: "2026-11-21T18:20:00.000Z",
  },
] as unknown as readonly TaskEvent[];

function makeClient(task: Task) {
  const runs = RUNS_BY_TASK[task.id] ?? [];
  return {
    tasks: {
      get: async () => task,
      subscribe: () => () => undefined,
      events: async () => ({ events: task.id === TASK_NO_RUNS.id ? [] : HISTORY_EVENTS }),
      update: async () => task,
      archive: async () => ({ results: [] }),
      unarchive: async () => ({ results: [] }),
      reorder: async () => undefined,
    },
    agents: {
      searchRuns: async (input?: { readonly activeOnly?: boolean }) => ({
        runs: input?.activeOnly ? runs.filter((run) => run.status === "running") : runs,
      }),
    },
  } as unknown as ReturnType<TasksViewProps["getClient"]>;
}

type Frame = "wide" | "panel";
const FRAME_WIDTH: Record<Frame, number> = { wide: 960, panel: 420 };
const FRAME_HEIGHT: Record<Frame, string> = { wide: "h-[700px]", panel: "h-auto" };
const noop = () => undefined;

function DetailFrame(props: { readonly frame: Frame; readonly task: Task }): ReactNode {
  const client = makeClient(props.task);
  return (
    <SidebarProvider className="min-h-0" defaultOpen>
      <div
        className={`-mx-(--sidebar-content-inset) -my-1 flex ${FRAME_HEIGHT[props.frame]} flex-col overflow-hidden border border-border bg-background`}
        style={{ width: FRAME_WIDTH[props.frame] }}
      >
        <TasksView
          layout={props.frame === "panel" ? "panel" : "page"}
          projects={[PROJECT]}
          tasks={[props.task]}
          statuses={["Backlog", "To Do", "In Progress", "In Review", "Done"]}
          projectFilter={null}
          filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
          onFiltersChange={noop}
          hasMore={false}
          loadingMore={false}
          onLoadMore={noop}
          agents={AGENTS}
          runs={[]}
          providerEntriesByEnvironment={new Map()}
          status="ready"
          initialSelectedTaskKey={`${ENVIRONMENT_ID}:${props.task.id}`}
          canMutateEnvironment={() => true}
          getClient={() => client}
          onReload={noop}
          onNavigateBack={noop}
          onOpenThread={noop}
        />
      </div>
    </SidebarProvider>
  );
}

async function settleDetail(cell: HTMLElement, expectTexts: readonly string[]) {
  await vi.waitFor(() => {
    for (const expected of expectTexts) {
      if (!cell.textContent?.includes(expected)) {
        throw new Error(`Waiting for "${expected}"`);
      }
    }
  });
}

function detailStates(frame: Frame): ReadonlyArray<UiState> {
  return [
    {
      name: "Task with output and runs",
      render: () => <DetailFrame frame={frame} task={TASK_WITH_OUTPUT} />,
      settle: (cell) =>
        settleDetail(cell, ["Updated the worker task detail view", "Completed", "Failed"]),
    },
    {
      name: "Task with no runs",
      render: () => <DetailFrame frame={frame} task={TASK_NO_RUNS} />,
      settle: (cell) =>
        settleDetail(cell, [
          "Tidy up the worker task detail layout",
          "No worker has worked on this task yet.",
        ]),
    },
    {
      name: "Running task",
      render: () => <DetailFrame frame={frame} task={TASK_RUNNING} />,
      settle: (cell) =>
        settleDetail(cell, ["Tidy up the worker task detail layout", "Working", "Completed"]),
    },
  ];
}

it("task-detail-wide", async () => {
  await captureUiStateSheet(
    "task-detail-wide",
    [{ title: "Page, wide (960px)", states: detailStates("wide") }],
    { cellWidth: FRAME_WIDTH.wide },
  );
});

it("task-detail-panel", async () => {
  await captureUiStateSheet(
    "task-detail-panel",
    [{ title: "Right panel / stacked (420px)", states: detailStates("panel") }],
    { cellWidth: FRAME_WIDTH.panel },
  );
});
