import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { TasksView, type TasksViewProps } from "@t3tools/tasks-web";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";

const ENVIRONMENT_ID = EnvironmentId.make("environment-detail-accordions");
const PROJECT: TasksViewProps["projects"][number] = {
  environmentId: ENVIRONMENT_ID,
  id: ProjectId.make("project-detail-accordions"),
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
  pickId: ProjectId.make("project-detail-accordions"),
};

type TaskRow = TasksViewProps["tasks"][number];

function makeLargeMarkdown(sections: number): string {
  const parts: string[] = [];
  for (let index = 1; index <= sections; index++) {
    parts.push(
      `## Section ${index}`,
      "",
      `Requirement ${index} with **bold text**, \`symbol_${index}\`, and a [link](https://up.computer/docs/${index}).`,
      "",
      `- [ ] First checklist item ${index}`,
      `- [x] Completed checklist item ${index}`,
      "",
      "| Column A | Column B |",
      "| --- | --- |",
      `| Value ${index} | Ready |`,
      "",
    );
  }
  return parts.join("\n");
}

const LARGE_DESCRIPTION = makeLargeMarkdown(25);

function makeTask(
  id: string,
  overrides: {
    readonly title?: string;
    readonly description?: string;
    readonly output?: string | null;
    readonly omitText?: boolean;
  } = {},
): TaskRow {
  const base = {
    id,
    rank: "0000000000000010",
    projectId: PROJECT.id,
    title: overrides.title ?? "Task with large description",
    status: "In Review",
    priority: null,
    createdBy: "user",
    assigneeAgentRunId: null,
    sourceThreadId: null,
    sourceRunId: null,
    rootThreadId: null,
    parentTaskId: null,
    parentRunId: null,
    metadata: null,
    tags: ["dev-neon"],
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
    latestRunStatus: null,
  };
  if (overrides.omitText) return base as unknown as TaskRow;
  return {
    ...base,
    description: overrides.description ?? LARGE_DESCRIPTION,
    output: overrides.output === undefined ? "## Summary\n\nTask output ready." : overrides.output,
  } as unknown as TaskRow;
}

function makeClient(
  getTask: () => Promise<TaskRow>,
  onUpdate?: (input: { readonly id: string; readonly description?: string }) => Promise<TaskRow>,
) {
  return {
    tasks: {
      get: getTask,
      subscribe: () => () => undefined,
      events: async () => ({ events: [] }),
      update: onUpdate ?? (async () => getTask()),
      archive: async () => ({ results: [] }),
      unarchive: async () => ({ results: [] }),
      reorder: async () => undefined,
    },
    agents: {
      searchRuns: async () => ({ runs: [] }),
    },
  } as unknown as ReturnType<TasksViewProps["getClient"]>;
}

function DetailHarness(props: {
  readonly task: TaskRow;
  readonly client: ReturnType<TasksViewProps["getClient"]>;
  readonly layout?: "page" | "panel";
  readonly width?: number;
}) {
  return (
    <div style={{ width: props.width ?? 960, height: 700 }} className="flex flex-col">
      <TasksView
        layout={props.layout ?? "page"}
        projects={[PROJECT]}
        tasks={[props.task]}
        statuses={["To Do", "In Progress", "In Review", "Done"]}
        projectFilter={null}
        filters={{ status: "__all__", lastRun: "__all__", tags: [], archive: "active" }}
        onFiltersChange={() => undefined}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
        agents={[]}
        runs={[]}
        providerEntriesByEnvironment={new Map()}
        status="ready"
        initialSelectedTaskKey={`${ENVIRONMENT_ID}:${props.task.id}`}
        canMutateEnvironment={() => true}
        getClient={() => props.client}
        onReload={() => undefined}
        onNavigateBack={() => undefined}
        onOpenThread={() => undefined}
      />
    </div>
  );
}

function renderDetail(props: Parameters<typeof DetailHarness>[0]) {
  return render(<DetailHarness {...props} />);
}

function sectionPanelFor(trigger: Element): HTMLElement {
  const panel = trigger.nextElementSibling;
  if (!(panel instanceof HTMLElement) || !panel.hasAttribute("data-detail-sidebar-section-panel")) {
    throw new Error("Expected DetailSidebarSection panel immediately after trigger");
  }
  return panel;
}

describe("task detail accordions", () => {
  it("expands a large collapsed Description smoothly and keeps it mounted with inert and content-visibility: hidden when closed", async () => {
    const task = makeTask("task-large");
    await using screen = await renderDetail({
      task,
      client: makeClient(async () => task),
    });

    await expect.element(screen.getByText("Task output ready.")).toBeVisible();

    const trigger = screen.getByRole("button", { name: "Description" });
    const triggerEl = trigger.element();
    const panelEl = sectionPanelFor(triggerEl);
    const clipEl = panelEl.firstElementChild as HTMLElement;

    // Collapsed by default when the task has output, and editor is not mounted before interaction.
    expect(triggerEl.getAttribute("aria-expanded")).toBe("false");
    expect(panelEl.getAttribute("data-open")).toBe("false");
    expect(panelEl.inert).toBe(true);
    expect(clipEl.className).toContain("[content-visibility:hidden]");
    expect(panelEl.querySelector('[role="textbox"]')).toBeNull();

    // First open mounts the markdown editor and expands the grid panel once ready.
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    await expect.element(panelEl).toHaveAttribute("data-open", "true");
    expect(panelEl.inert).toBe(false);
    expect(clipEl.className).not.toContain("[content-visibility:hidden]");

    const textbox = screen.getByRole("textbox", { name: "Task description" });
    await expect.element(textbox).toBeVisible();
    const editorEl = textbox.element();
    expect(editorEl.textContent).toContain("Section 1");
    expect(editorEl.textContent).toContain("Section 25");

    // Closing keeps the exact same editor DOM mounted, skips layout via content-visibility, and removes it from tab order.
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    await expect.element(panelEl).toHaveAttribute("data-open", "false");
    expect(panelEl.inert).toBe(true);
    expect(clipEl.className).toContain("[content-visibility:hidden]");
    expect(editorEl.isConnected).toBe(true);
    expect(panelEl.contains(editorEl)).toBe(true);

    // Reopening reuses the mounted editor instance without remounting.
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    await expect.element(panelEl).toHaveAttribute("data-open", "true");
    expect(panelEl.inert).toBe(false);
    expect(screen.getByRole("textbox", { name: "Task description" }).element()).toBe(editorEl);
  });

  it("opens Description automatically when loaded text has no output, and saves edits when blurring via collapse", async () => {
    const loadedTask = makeTask("task-no-output", {
      description: "Initial notes",
      output: null,
    });
    const listTask = makeTask("task-no-output", { omitText: true });
    let saved = loadedTask;
    const onUpdate = vi.fn(
      async (input: { readonly id: string; readonly description?: string }) => {
        saved = makeTask("task-no-output", {
          description: input.description ?? "Initial notes",
          output: null,
        });
        return saved;
      },
    );
    const client = makeClient(async () => saved, onUpdate);

    await using screen = await renderDetail({
      task: listTask,
      client,
    });

    const loadingTrigger = screen.getByRole("button", { name: "Description" });
    expect(loadingTrigger.element().getAttribute("aria-expanded")).toBe("false");

    await screen.rerender(<DetailHarness task={loadedTask} client={client} />);

    const textbox = screen.getByRole("textbox", { name: "Task description" });
    await expect.element(textbox).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Description" }))
      .toHaveAttribute("aria-expanded", "true");

    await userEvent.click(textbox);
    await userEvent.keyboard(" updated");
    // Clicking the section header blurs the editor (saving the draft) and collapses the panel.
    await userEvent.click(screen.getByRole("button", { name: "Description" }));

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        id: "task-no-output",
        description: "Initial notes updated",
      });
    });

    // Reopening shows the saved text in the same mounted editor.
    await userEvent.click(screen.getByRole("button", { name: "Description" }));
    await expect.element(textbox).toBeVisible();
    expect(textbox.element().textContent).toContain("Initial notes updated");
  });

  it("toggles Output, Details, Runs, and History smoothly in the stacked panel layout without remounting", async () => {
    const task = makeTask("task-panel");
    await using screen = await renderDetail({
      task,
      client: makeClient(async () => task),
      layout: "panel",
      width: 420,
    });

    await expect.element(screen.getByText("Task output ready.")).toBeVisible();

    for (const label of ["Output", "Details", "Runs", "History"]) {
      const trigger = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      const triggerEl = trigger.element();
      const panelEl = sectionPanelFor(triggerEl);
      const firstInnerNode =
        panelEl.firstElementChild?.firstElementChild?.firstElementChild ?? null;
      expect(triggerEl.getAttribute("aria-expanded")).toBe("true");
      expect(panelEl.inert).toBe(false);
      expect(firstInnerNode).not.toBeNull();

      await userEvent.click(trigger);
      await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
      await expect.element(panelEl).toHaveAttribute("data-open", "false");
      expect(panelEl.inert).toBe(true);
      expect(firstInnerNode?.isConnected).toBe(true);

      await userEvent.click(trigger);
      await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
      await expect.element(panelEl).toHaveAttribute("data-open", "true");
      expect(panelEl.inert).toBe(false);
      expect(panelEl.firstElementChild?.firstElementChild?.firstElementChild).toBe(firstInnerNode);
    }
  });
});
