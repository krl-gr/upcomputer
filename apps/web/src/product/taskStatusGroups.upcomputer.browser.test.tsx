import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { TasksView, type TasksViewProps } from "@t3tools/tasks-web";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";

const ENVIRONMENT_ID = EnvironmentId.make("environment-groups");
const PROJECT: TasksViewProps["projects"][number] = {
  environmentId: ENVIRONMENT_ID,
  id: ProjectId.make("project-groups"),
  name: "upcomputer",
  workspaceRoot: "/repo",
  favicon: {
    environmentId: ENVIRONMENT_ID,
    workspaceRoot: "/repo",
    title: "upcomputer",
    faviconPath: null,
    projectIcon: null,
  },
  groupKey: "upcomputer",
  pickId: ProjectId.make("project-groups"),
};

function tasks(status: string, count: number): TasksViewProps["tasks"] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `task-${status}-${index}`,
        rank: `${status}-${String(index).padStart(4, "0")}`,
        projectId: PROJECT.id,
        title: `${status} task ${index + 1}`,
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
        tags: [],
        createdAt: "2026-11-20T00:00:00.000Z",
        updatedAt: "2026-11-20T00:00:00.000Z",
        archivedAt: null,
        notBefore: null,
        triggerChangedAt: "2026-11-20T00:00:00.000Z",
        audience: "agent",
        kind: "task",
        environmentId: ENVIRONMENT_ID,
        projectName: PROJECT.name,
        runCounts: [],
      }) as unknown as TasksViewProps["tasks"][number],
  );
}

const TO_DO = tasks("To Do", 2);

/**
 * The panel's list grouped by status, as `useTaskList` feeds it: a closed group has its
 * count only, and an opened one brings its loaded rows (here from the cache, at once).
 */
function GroupedList(props: {
  readonly done: TasksViewProps["tasks"];
  readonly doneCount: number;
  readonly doneHasMore?: boolean;
  readonly onLoadGroup?: (key: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const doneOpen = open.done ?? false;
  return (
    <div style={{ width: 420, height: 800 }} className="flex flex-col">
      <TasksView
        layout="panel"
        projects={[PROJECT]}
        tasks={doneOpen ? [...TO_DO, ...props.done] : TO_DO}
        statuses={["To Do", "Done"]}
        projectFilter={null}
        projectSelect={null}
        filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
        onFiltersChange={() => undefined}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
        agents={[]}
        runs={[]}
        providerEntriesByEnvironment={new Map()}
        status="ready"
        canMutateEnvironment={() => true}
        getClient={() => null}
        onReload={() => undefined}
        onNavigateBack={() => undefined}
        onOpenThread={() => undefined}
        grouping={{
          settings: { groupByStatus: true, statusGroupOrder: [], statusGroupOpen: open },
          onSettingsChange: (patch) =>
            setOpen((current) => ({ ...current, ...patch.statusGroupOpen })),
          counts: new Map([
            ["to do", TO_DO.length],
            ["done", props.doneCount],
          ]),
          paging: new Map([
            ["to do", { hasMore: false, loading: false }],
            ...(doneOpen
              ? ([["done", { hasMore: props.doneHasMore ?? false, loading: false }]] as const)
              : []),
          ]),
          onLoadGroup: props.onLoadGroup ?? (() => undefined),
        }}
      />
    </div>
  );
}

function groupHeader(container: HTMLElement, key: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(
    `[data-task-status-group-header="${key}"] button`,
  )!;
}

function doneCards(container: HTMLElement): number {
  return container.querySelectorAll('[data-task-status-group="done"] [data-task-card]').length;
}

describe("the task list's status groups", () => {
  it("opens a group without highlighting its tasks as new, the first time or again", async () => {
    await using screen = await render(<GroupedList done={tasks("Done", 5)} doneCount={5} />);
    const { container } = screen;
    await expect.element(screen.getByText("To Do task 1")).toBeVisible();

    for (let round = 0; round < 2; round++) {
      await userEvent.click(groupHeader(container, "done"));
      await expect.element(screen.getByText("Done task 1")).toBeVisible();
      expect(container.querySelectorAll("[data-task-arrival]")).toHaveLength(0);
      await userEvent.click(groupHeader(container, "done"));
      await expect
        .element(
          container.querySelector<HTMLElement>(
            '[data-task-status-group="done"] [data-task-status-group-panel]',
          ),
        )
        .toHaveAttribute("data-open", "false");
    }
  });

  it("shows a group's first 20 tasks; Show more shows the next and loads the server's next page", async () => {
    const onLoadGroup = vi.fn();
    await using screen = await render(
      <GroupedList
        done={tasks("Done", 30)}
        doneCount={120}
        doneHasMore
        onLoadGroup={onLoadGroup}
      />,
    );
    const { container } = screen;
    await userEvent.click(groupHeader(container, "done"));
    await expect.element(screen.getByText("Done task 20", { exact: true })).toBeVisible();
    expect(doneCards(container)).toBe(20);
    const showMore = screen.getByRole("button", { name: /Show more/ });
    expect(showMore.element().textContent).toBe("Show more100");

    // 30 tasks are loaded, so showing 70 asks the server for the group's next page.
    await userEvent.click(showMore);
    await expect.element(screen.getByText("Done task 30", { exact: true })).toBeVisible();
    expect(doneCards(container)).toBe(30);
    expect(onLoadGroup).toHaveBeenCalledWith("done");
    expect(screen.getByRole("button", { name: /Show more/ }).element().textContent).toBe(
      "Show more50",
    );
  });
});
