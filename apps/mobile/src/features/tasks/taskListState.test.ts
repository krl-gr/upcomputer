import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  CURRENT_TASK_WORKFLOW_VERSION,
  DEFAULT_TASK_LIST_SETTINGS,
  LEGACY_TASK_WORKFLOW_VERSION,
} from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  appliedWorkerTaskFilterCount,
  canCreateTask,
  chooseTasksEnvironment,
  collapsedTaskStatuses,
  DEFAULT_WORKER_TASK_FILTERS,
  taskListCountsInput,
  taskListEmptyState,
  taskListPageInput,
  taskListSections,
  tasksEnvironments,
  taskStatusChoices,
  toggledTag,
  workerStatusOptions,
  workerTagOptions,
} from "./taskListState";

const project = ProjectId.make("project-app");
const row = (title: string, status: string, tags: string[] = []) => ({
  title,
  status,
  tags,
  projectId: project,
});
const counts = [
  { status: "To Do", count: 4 },
  { status: "Needs You", count: 1 },
  { status: "Done", count: 30 },
  { status: "Waiting on vendor", count: 2 },
];
const filters = DEFAULT_WORKER_TASK_FILTERS;

describe("worker task filters", () => {
  it("sends the desktop's filters to the server; counts leave the status out", () => {
    expect(taskListPageInput(filters)).toEqual({ audience: "agent", omitText: true, limit: 50 });
    const narrowed = {
      projectId: "project-app",
      status: "Needs You",
      lastRun: "none",
      tags: ["ios"],
      archive: "all" as const,
    };
    expect(taskListCountsInput(narrowed)).toEqual({
      audience: "agent",
      projectId: "project-app",
      tags: ["ios"],
      archive: "all",
      lastRun: "none",
    });
    expect(taskListPageInput(narrowed, ["done"])).toEqual({
      ...taskListCountsInput(narrowed),
      omitText: true,
      limit: 50,
      status: "Needs You",
    });
    expect(appliedWorkerTaskFilterCount(filters)).toBe(0);
    expect(appliedWorkerTaskFilterCount(narrowed)).toBe(5);
  });

  it("leaves collapsed groups out of the page: Done and Cancelled unless opened, and the user's", () => {
    expect(collapsedTaskStatuses(filters, DEFAULT_TASK_LIST_SETTINGS)).toEqual([
      "cancelled",
      "done",
    ]);
    expect(taskListPageInput(filters, ["cancelled", "done"]).excludeStatuses).toEqual([
      "cancelled",
      "done",
    ]);
    expect(
      collapsedTaskStatuses(filters, {
        groupByStatus: true,
        statusGroupOpen: { done: true, "to do": false },
      }),
    ).toEqual(["cancelled", "to do"]);
    expect(collapsedTaskStatuses(filters, { groupByStatus: false, statusGroupOpen: {} })).toEqual(
      [],
    );
    expect(collapsedTaskStatuses({ status: "Done" }, DEFAULT_TASK_LIST_SETTINGS)).toEqual([]);
  });

  it("offers the workflow's statuses and any other with tasks, in the desktop's group order", () => {
    const options = workerStatusOptions(counts, CURRENT_TASK_WORKFLOW_VERSION, "Backlog");
    expect(options.slice(0, 2)).toEqual(["Needs You", "Failed"]);
    expect(options).toContain("Waiting on vendor");
    expect(options).toContain("Backlog");
    expect(options.filter((status) => status.toLowerCase() === "to do")).toHaveLength(1);
  });

  it("offers loaded and chosen tags A to Z, and toggles one", () => {
    expect(workerTagOptions([{ tags: ["web", "bug"] }, { tags: ["bug"] }], ["ops"])).toEqual([
      "bug",
      "ops",
      "web",
    ]);
    expect(toggledTag(["bug"], "web")).toEqual(["bug", "web"]);
    expect(toggledTag(["bug", "web"], "bug")).toEqual(["web"]);
  });
});

describe("task list sections", () => {
  type Row = ReturnType<typeof row>;
  const sections = (input: Partial<Parameters<typeof taskListSections<Row>>[0]>) =>
    taskListSections<Row>({
      tasks: [],
      counts,
      statuses: counts.map((count) => count.status),
      status: null,
      workflowVersion: CURRENT_TASK_WORKFLOW_VERSION,
      settings: DEFAULT_TASK_LIST_SETTINGS,
      ...input,
    }).map((section) => [section.title, section.count, section.tasks.map((task) => task.title)]);

  it("groups loaded tasks by status in the desktop's order with the server's counts", () => {
    expect(
      sections({
        tasks: [
          row("Ship it", "to do"),
          row("Pick a font", "Needs You"),
          row("Wait", "Waiting on vendor"),
        ],
      }),
    ).toEqual([
      ["Needs You", 1, ["Pick a font"]],
      ["To Do", 4, ["Ship it"]],
      ["Done", 30, []],
      ["Waiting on vendor", 2, ["Wait"]],
    ]);
  });

  it("keeps Done collapsed with its count until opened, and shows one status open", () => {
    const tasks = [row("Ship it", "To Do"), row("Old", "Done")];
    expect(sections({ tasks })).toEqual([
      ["To Do", 4, ["Ship it"]],
      ["Done", 30, []],
    ]);
    expect(
      sections({
        tasks,
        settings: { ...DEFAULT_TASK_LIST_SETTINGS, statusGroupOpen: { done: true } },
      }),
    ).toEqual([
      ["To Do", 4, ["Ship it"]],
      ["Done", 30, ["Old"]],
    ]);
    expect(sections({ tasks: [row("Old", "Done")], status: "Done" })).toEqual([
      ["Done", 30, ["Old"]],
    ]);
  });

  it("follows the user's group order, and lists everything in one untitled section ungrouped", () => {
    const tasks = [row("Ship it", "To Do"), row("Pick a font", "Needs You")];
    expect(
      sections({
        tasks,
        settings: { ...DEFAULT_TASK_LIST_SETTINGS, statusGroupOrder: ["to do"] },
      }).map(([title]) => title),
    ).toEqual(["To Do", "Needs You", "Done"]);
    expect(
      sections({ tasks, settings: { ...DEFAULT_TASK_LIST_SETTINGS, groupByStatus: false } }),
    ).toEqual([["", 2, ["Ship it", "Pick a font"]]]);
  });
});

describe("task status choices", () => {
  it("offers the workflow's statuses and keeps a custom one the task already has", () => {
    expect(taskStatusChoices(LEGACY_TASK_WORKFLOW_VERSION, "Backlog")).toContain("Backlog");
    expect(taskStatusChoices(CURRENT_TASK_WORKFLOW_VERSION, "to verify")).not.toContain(
      "to verify",
    );
    expect(taskStatusChoices(CURRENT_TASK_WORKFLOW_VERSION, "Waiting on vendor").at(-1)).toBe(
      "Waiting on vendor",
    );
  });
});

describe("tasks environment", () => {
  const environment = (id: string, label: string, connected: boolean, isEnabled = true) => ({
    environmentId: EnvironmentId.make(id),
    environmentLabel: label,
    connectionState: connected ? ("connected" as const) : ("offline" as const),
    isEnabled,
  });

  it("lists enabled computers, connected first, and keeps the one picked while it is listed", () => {
    const listed = tasksEnvironments([
      environment("air", "Air", false),
      environment("studio", "Studio", true),
      environment("old", "Old", true, false),
    ]);
    expect(listed.map((entry) => entry.environmentLabel)).toEqual(["Studio", "Air"]);
    expect(chooseTasksEnvironment(listed, null)).toBe("studio");
    expect(chooseTasksEnvironment(listed, EnvironmentId.make("air"))).toBe("air");
    expect(chooseTasksEnvironment(listed, EnvironmentId.make("old"))).toBe("studio");
    expect(chooseTasksEnvironment([], null)).toBeNull();
  });

  it("explains an empty list by the first thing in the way", () => {
    const connected = environment("studio", "Studio", true);
    const state = (input: Partial<Parameters<typeof taskListEmptyState>[0]>) =>
      taskListEmptyState({
        environment: connected,
        availability: "enabled",
        initialLoading: false,
        error: undefined,
        filtered: false,
        ...input,
      });
    expect(state({ environment: null })).toBe("noEnvironment");
    expect(state({ environment: environment("air", "Air", false), availability: null })).toBe(
      "offline",
    );
    expect(state({ availability: "unavailable" })).toBe("unavailable");
    expect(state({ availability: "loading", initialLoading: true })).toBe("checking");
    expect(state({ initialLoading: true, error: "Socket closed" })).toBe("error");
    expect(state({ initialLoading: true })).toBe("loading");
    expect(state({ filtered: true })).toBe("filtered");
    expect(state({})).toBe("empty");
  });
});

describe("new task", () => {
  it("needs a title and a status", () => {
    expect(canCreateTask({ title: "  ", description: "", status: "To Do" })).toBe(false);
    expect(canCreateTask({ title: "Ship it", description: "", status: "" })).toBe(false);
    expect(canCreateTask({ title: "Ship it", description: "", status: "To Do" })).toBe(true);
  });
});
