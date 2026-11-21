import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  TaskId,
  TaskScheduleEntryId,
  type TaskKind,
  type TaskScheduleEntry,
} from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import type { PlannerTask } from "../data/pendingOps.ts";
import { resolvePlannerComposerTasks } from "./usePlannerDnd.ts";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-1");

const makeTask = (id: string, title: string, kind: TaskKind = "task"): PlannerTask =>
  ({
    id: TaskId.make(id),
    title,
    kind,
    projectId: PROJECT_ID,
  }) as unknown as PlannerTask;

const makeEntry = (id: string, taskId: string, date: string): TaskScheduleEntry =>
  ({
    id: TaskScheduleEntryId.make(id),
    taskId: TaskId.make(taskId),
    date,
  }) as unknown as TaskScheduleEntry;

const context = {
  environmentId: ENV_ID,
  projectNameById: new Map([[PROJECT_ID, "UpComputer"]]),
};

describe("resolvePlannerComposerTasks", () => {
  const tasks = new Map<string, PlannerTask>([
    ["t1", makeTask("t1", "Plan release", "task")],
    ["r1", makeTask("r1", "Daily review", "routine")],
  ]);
  const days = new Map<string, readonly TaskScheduleEntry[]>([
    ["2026-11-21", [makeEntry("e1", "t1", "2026-11-21"), makeEntry("e2", "r1", "2026-11-21")]],
    ["2026-11-22", [makeEntry("e3", "t1", "2026-11-22")]],
  ]);

  it("resolves a planner task or routine", () => {
    expect(
      resolvePlannerComposerTasks({ kind: "task", taskId: "t1" }, context, tasks, days),
    ).toEqual([
      {
        environmentId: ENV_ID,
        taskId: "t1",
        title: "Plan release",
        kind: "task",
        projectId: PROJECT_ID,
        projectName: "UpComputer",
      },
    ]);
    expect(
      resolvePlannerComposerTasks({ kind: "task", taskId: "r1" }, context, tasks, days),
    ).toEqual([
      {
        environmentId: ENV_ID,
        taskId: "r1",
        title: "Daily review",
        kind: "routine",
        projectId: PROJECT_ID,
        projectName: "UpComputer",
      },
    ]);
  });

  it("resolves scheduled entries and deduplicates repeated tasks in a multi-entry drag", () => {
    expect(
      resolvePlannerComposerTasks(
        { kind: "entry", entryId: "e1", date: "2026-11-21", ids: ["e1", "e3", "e2"] },
        context,
        tasks,
        days,
      ).map((item) => ({ taskId: item.taskId, kind: item.kind })),
    ).toEqual([
      { taskId: "t1", kind: "task" },
      { taskId: "r1", kind: "routine" },
    ]);
  });

  it("never produces composer payloads for automations", () => {
    expect(
      resolvePlannerComposerTasks(
        { kind: "automation", automationId: "auto-1" },
        context,
        tasks,
        days,
      ),
    ).toEqual([]);
  });
});
