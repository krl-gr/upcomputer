import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { TasksView, type TasksViewProps } from "@t3tools/tasks-web";
import { TableSectionSwitch, TasksViewSwitch } from "@t3tools/tasks-web/planner";

import { SidebarProvider } from "../components/ui/sidebar";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The Workers task list as cards, as the right panel shows it: tags under the
 * title, the status select on a row's hover, keyboard focus and open menu, and
 * the Tasks / Automations switch in its header.
 */

// The list waits for an environment's Tasks probe; none is connected here.
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePlannerAvailability: () => null,
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

function task(
  index: number,
  title: string,
  overrides: { readonly tags?: string[]; readonly status?: string; readonly runs?: boolean } = {},
): Task {
  return {
    id: `task-ui-states-${index}`,
    rank: `00000000000000${String(10 + index)}`,
    projectId: PROJECT.id,
    title,
    description: "",
    output: null,
    status: overrides.status ?? "Backlog",
    priority: null,
    createdBy: "agent",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: overrides.tags ?? [],
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    archivedAt: null,
    notBefore: null,
    triggerChangedAt: "2026-11-09T00:00:00.000Z",
    audience: "agent",
    kind: "task",
    environmentId: ENVIRONMENT_ID,
    projectName: PROJECT.name,
    runCounts: overrides.runs
      ? [
          { status: "running", count: 1 },
          { status: "completed", count: 2 },
        ]
      : [],
  } as unknown as Task;
}

const TASKS: Task[] = [
  task(1, "Fix: built-in browser cannot screenshot or click when the window is not painting"),
  task(2, "Agents: archive for agents that are no longer used"),
  task(3, "Add and instrument the homepage concierge offer", {
    tags: ["analytics", "backlog", "concierge-offer", "homepage", "willingness-to-pay"],
  }),
  task(4, "Add session-wide internal-test attribution", {
    tags: ["analytics", "convex"],
    status: "In Progress",
    runs: true,
  }),
  task(5, "Short title", { tags: ["ui"], status: "Needs Review" }),
];

const noop = () => undefined;

function TaskCards() {
  return (
    <SidebarProvider className="min-h-0" defaultOpen>
      <div
        className="-mx-(--sidebar-content-inset) -my-1 flex h-[26rem] flex-col overflow-hidden border border-border bg-background"
        style={{ width: 400 }}
      >
        <TasksView
          layout="panel"
          projects={[PROJECT]}
          tasks={TASKS}
          statuses={["Backlog", "To Do", "In Progress", "Needs Review", "Done"]}
          projectFilter={null}
          viewSwitch={
            <>
              <TasksViewSwitch value="table" onChange={noop} />
              <TableSectionSwitch value="tasks" onChange={noop} />
            </>
          }
          filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
          onFiltersChange={noop}
          hasMore={false}
          loadingMore={false}
          onLoadMore={noop}
          agents={[]}
          runs={[]}
          providerEntriesByEnvironment={new Map()}
          status="ready"
          canMutateEnvironment={() => true}
          getClient={() => null}
          onReload={noop}
          onNavigateBack={noop}
          onOpenThread={noop}
        />
      </div>
    </SidebarProvider>
  );
}

const HOVER_MARK = "data-ui-states-hover-card";

/** The card whose title contains `title`, once the list shows it. */
function cardOf(cell: HTMLElement, title: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const card = [...cell.querySelectorAll<HTMLElement>("[data-task-card]")].find((node) =>
      node.textContent?.includes(title),
    );
    if (!card) throw new Error(`No card "${title}"`);
    return card;
  });
}

const markHovered = (title: string) => async (cell: HTMLElement) => {
  (await cardOf(cell, title)).setAttribute(HOVER_MARK, "");
};

function state(name: string, extra: Partial<UiState> = {}): UiState {
  const render = (): ReactNode => <TaskCards />;
  return { name, render, ...extra };
}

const STATES: ReadonlyArray<UiState> = [
  state("At rest", { settle: async (cell) => void (await cardOf(cell, "Short title")) }),
  state("Pointer over the tagged row", {
    settle: markHovered("Add and instrument"),
    hover: `[${HOVER_MARK}]`,
  }),
  state("Pointer over the row with runs", {
    settle: markHovered("Add session-wide"),
    hover: `[${HOVER_MARK}]`,
  }),
  state("Keyboard focus on the first row's title", {
    settle: async (cell) => {
      // Tab focus shows the row's status select, as `:focus-visible` does.
      const title = (await cardOf(cell, "Fix: built-in")).querySelector<HTMLElement>("button")!;
      title.focus({ focusVisible: true } as FocusOptions);
    },
  }),
];

const MENU_STATES: ReadonlyArray<UiState> = [
  state("Pointer over a row, its status menu open", {
    settle: async (cell) => {
      const card = await cardOf(cell, "Agents: archive");
      card.setAttribute(HOVER_MARK, "");
      await userEvent.click(card.querySelector<HTMLElement>('[aria-label="Task status"]')!);
      await vi.waitFor(() => {
        if (!document.querySelector('[role="listbox"]')) throw new Error("menu not open");
      });
    },
    hover: `[${HOVER_MARK}]`,
  }),
];

// Sheets of their own: the focus and the open menu each need the page's one focus.
it("task-cards", async () => {
  await captureUiStateSheet("task-cards", [{ title: "Right panel (400px)", states: STATES }], {
    cellWidth: 400,
  });
});

it("task-cards-menu", async () => {
  await captureUiStateSheet(
    "task-cards-menu",
    [{ title: "Right panel (400px), the open menu is the real popup", states: MENU_STATES }],
    { cellWidth: 400 },
  );
});
