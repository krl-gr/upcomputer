import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  dayEntries,
  daysWithOpenEntries,
  entryMoveTargets,
  plannedOn,
  plannerGate,
  searchPlannerTasks,
  toggledEntryStatus,
  weekOf,
} from "./plannerState";

const task = (id: string, kind: "task" | "routine", title = id) =>
  ({ id, kind, title }) as unknown as PlannerTask;
const entry = (id: string, taskId: string, date: string, status = "open") =>
  ({ id, taskId, date, status }) as unknown as TaskScheduleEntry;
const tasks = new Map([
  ["pay", task("pay", "task", "Pay rent")],
  ["run", task("run", "routine", "Morning run")],
]);

describe("planner week", () => {
  it("takes the seven days of the week that holds the date, from the locale's first day", () => {
    // 2026-11-26 is a Thursday.
    expect(weekOf("2026-11-26", 1)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(weekOf("2026-11-26", 0)[0]).toBe("2026-11-22");
  });

  it("moves an entry to its week's other days or the same day next week", () => {
    const targets = entryMoveTargets("2026-11-29", 1);
    expect(targets).toHaveLength(7);
    expect(targets).not.toContain("2026-11-29");
    expect(targets.at(-1)).toBe("2026-12-06");
  });
});

describe("planner days", () => {
  const day = [
    entry("e1", "pay", "2026-11-26"),
    entry("e2", "run", "2026-11-26", "done"),
    entry("e3", "unknown", "2026-11-26"),
  ];

  it("shows the view's own kind and keeps entries whose task is still loading", () => {
    expect(dayEntries(day, tasks, "task").map((item) => item.entry.id)).toEqual(["e1", "e3"]);
    expect(dayEntries(day, tasks, "routine").map((item) => item.entry.id)).toEqual(["e2", "e3"]);
    expect(dayEntries(undefined, tasks, "task")).toEqual([]);
    expect(plannedOn(dayEntries(day, tasks, "task"), "pay")).toBe(true);
    expect(plannedOn(dayEntries(day, tasks, "task"), "run")).toBe(false);
  });

  it("marks days with something open of the kind", () => {
    const days = new Map([
      ["2026-11-26", [entry("e2", "run", "2026-11-26", "done")]],
      ["2026-11-27", [entry("e4", "run", "2026-11-27")]],
      ["2026-11-28", [entry("e5", "pay", "2026-11-28")]],
    ]);
    expect([...daysWithOpenEntries(days, tasks, "routine")]).toEqual(["2026-11-27"]);
  });

  it("checks an entry off and back; a skipped one reopens", () => {
    expect(toggledEntryStatus("open")).toBe("done");
    expect(toggledEntryStatus("done")).toBe("open");
    expect(toggledEntryStatus("skipped")).toBe("open");
  });
});

describe("planner list", () => {
  it("searches titles without case", () => {
    expect(searchPlannerTasks([...tasks.values()], " RENT ").map((item) => item.id)).toEqual([
      "pay",
    ]);
    expect(searchPlannerTasks([...tasks.values()], "")).toHaveLength(2);
  });

  it("explains the planner's absence by the first thing in the way", () => {
    const gate = (input: Partial<Parameters<typeof plannerGate>[0]>) =>
      plannerGate({
        hasEnvironment: true,
        connected: true,
        access: "enabled",
        planner: "enabled",
        ...input,
      });
    expect(gate({ hasEnvironment: false })).toBe("noEnvironment");
    expect(gate({ connected: false, access: null })).toBe("offline");
    expect(gate({ planner: "unavailable" })).toBe("unavailable");
    expect(gate({ access: "loading", planner: null })).toBe("checking");
    expect(gate({})).toBe("ready");
  });
});
