import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  CURRENT_TASK_WORKFLOW_VERSION,
  DEFAULT_TASK_LIST_SETTINGS,
  LEGACY_TASK_WORKFLOW_VERSION,
} from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_TASKS_FILTER,
  canCreateTask,
  chooseTasksEnvironment,
  collapsedTaskStatuses,
  OPEN_TASKS_FILTER,
  parseTaskListFilter,
  taskListEmptyState,
  taskListFilterCount,
  taskListFilterKey,
  taskListPageInput,
  taskListSections,
  tasksEnvironments,
  taskStatusChoices,
  taskStatusOptions,
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

describe("task list query", () => {
  it("lists the workers' open tasks without their text, or one status", () => {
    expect(taskListPageInput(OPEN_TASKS_FILTER)).toEqual({
      audience: "agent",
      omitText: true,
      limit: 50,
      excludeStatuses: ["Done", "Cancelled"],
    });
    expect(taskListPageInput({ kind: "all" })).toEqual({
      audience: "agent",
      omitText: true,
      limit: 50,
    });
    expect(taskListPageInput({ kind: "status", status: "Needs You" })).toMatchObject({
      status: "Needs You",
    });
    expect(taskListPageInput(ALL_TASKS_FILTER, ["done", "cancelled"])).toMatchObject({
      excludeStatuses: ["done", "cancelled"],
    });
    expect(
      taskListPageInput({ kind: "status", status: "Done" }, ["done"]).excludeStatuses,
    ).toBeUndefined();
  });

  it("leaves collapsed groups out of the page: Done and Cancelled unless opened, and the user's", () => {
    expect(collapsedTaskStatuses(ALL_TASKS_FILTER, DEFAULT_TASK_LIST_SETTINGS)).toEqual([
      "cancelled",
      "done",
    ]);
    expect(
      collapsedTaskStatuses(ALL_TASKS_FILTER, {
        groupByStatus: true,
        statusGroupOpen: { done: true, "to do": false },
      }),
    ).toEqual(["cancelled", "to do"]);
    expect(
      collapsedTaskStatuses(ALL_TASKS_FILTER, { groupByStatus: false, statusGroupOpen: {} }),
    ).toEqual([]);
    expect(
      collapsedTaskStatuses({ kind: "status", status: "Done" }, DEFAULT_TASK_LIST_SETTINGS),
    ).toEqual([]);
  });

  it("round-trips a filter through its menu id and falls back to open tasks", () => {
    const statuses = ["To Do", "Needs You"];
    for (const filter of [
      OPEN_TASKS_FILTER,
      { kind: "all" } as const,
      { kind: "status", status: "Needs You" } as const,
    ]) {
      expect(parseTaskListFilter(taskListFilterKey(filter), statuses)).toEqual(filter);
    }
    expect(parseTaskListFilter("status:blocked", statuses)).toEqual(ALL_TASKS_FILTER);
  });

  it("offers statuses with tasks in the desktop's group order and counts each filter", () => {
    expect(
      taskStatusOptions([...counts, { status: "Idea", count: 0 }], CURRENT_TASK_WORKFLOW_VERSION),
    ).toEqual([
      { status: "Needs You", count: 1 },
      { status: "To Do", count: 4 },
      { status: "Done", count: 30 },
      { status: "Waiting on vendor", count: 2 },
    ]);
    expect(taskListFilterCount(OPEN_TASKS_FILTER, counts)).toBe(7);
    expect(taskListFilterCount({ kind: "all" }, counts)).toBe(37);
    expect(taskListFilterCount({ kind: "status", status: "done" }, counts)).toBe(30);
  });
});

describe("task list sections", () => {
  const sections = (input: Partial<Parameters<typeof taskListSections>[0]>) =>
    taskListSections({
      tasks: [],
      counts,
      statuses: counts.map((count) => count.status),
      filter: OPEN_TASKS_FILTER,
      workflowVersion: CURRENT_TASK_WORKFLOW_VERSION,
      query: "",
      projectName: () => "Website",
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
      ["Waiting on vendor", 2, ["Wait"]],
    ]);
  });

  it("keeps finished tasks out of the open list, and collapses Done in all tasks", () => {
    const tasks = [row("Ship it", "To Do"), row("Old", "Done")];
    expect(sections({ tasks })).toEqual([["To Do", 4, ["Ship it"]]]);
    expect(sections({ tasks, filter: ALL_TASKS_FILTER })).toEqual([
      ["To Do", 4, ["Ship it"]],
      ["Done", 30, []],
    ]);
    expect(
      sections({
        tasks,
        filter: ALL_TASKS_FILTER,
        settings: { ...DEFAULT_TASK_LIST_SETTINGS, statusGroupOpen: { done: true } },
      }),
    ).toEqual([
      ["To Do", 4, ["Ship it"]],
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
    ).toEqual(["To Do", "Needs You"]);
    expect(
      sections({ tasks, settings: { ...DEFAULT_TASK_LIST_SETTINGS, groupByStatus: false } }),
    ).toEqual([["", 2, ["Ship it", "Pick a font"]]]);
  });

  it("narrows to loaded rows matching the search and counts the matches", () => {
    const tasks = [
      row("Ship the iPhone app", "To Do"),
      row("Write docs", "To Do", ["ios-dev"]),
      row("Pick a font", "Needs You"),
    ];
    expect(sections({ tasks, query: "  IOS " })).toEqual([["To Do", 1, ["Write docs"]]]);
    expect(sections({ tasks, query: "website" })).toHaveLength(2);
    expect(sections({ tasks, query: "nothing" })).toEqual([]);
    expect(sections({ tasks, query: "docs", filter: ALL_TASKS_FILTER })).toEqual([
      ["To Do", 1, ["Write docs"]],
    ]);
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
        searching: false,
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
    expect(state({ searching: true })).toBe("noResults");
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
