import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { TaskScheduleEntry } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  dayEntries,
  plannerGate,
  plannerProjectColor,
  steppedWeekStart,
  toggledEntryStatus,
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
  it("steps by the desktop's buttons; Today starts a seven-day week on its first day", () => {
    // 2026-11-26 is a Thursday.
    const step = (input: Partial<Parameters<typeof steppedWeekStart>[0]>) =>
      steppedWeekStart({
        start: "2026-11-26",
        step: "next-day",
        today: "2026-11-26",
        dayCount: 2,
        weekStartDay: 1,
        ...input,
      });
    expect(step({})).toBe("2026-11-27");
    expect(step({ step: "previous-week" })).toBe("2026-11-19");
    expect(step({ step: "today", start: "2026-12-10" })).toBe("2026-11-26");
    expect(step({ step: "today", dayCount: 7 })).toBe("2026-11-23");
  });

  it("keeps tasks and routines together in queue order, and entries whose task is loading", () => {
    const day = [
      entry("e1", "pay", "2026-11-26"),
      entry("e2", "run", "2026-11-26", "done"),
      entry("e3", "unknown", "2026-11-26"),
    ];
    expect(dayEntries(day, tasks).map((item) => [item.entry.id, item.task?.title])).toEqual([
      ["e1", "Pay rent"],
      ["e2", "Morning run"],
      ["e3", undefined],
    ]);
    expect(dayEntries(undefined, tasks)).toEqual([]);
  });

  it("checks an entry off and back; a skipped one reopens", () => {
    expect(toggledEntryStatus("open")).toBe("done");
    expect(toggledEntryStatus("done")).toBe("open");
    expect(toggledEntryStatus("skipped")).toBe("open");
  });

  it("colors a card by its project's badge: the icon's color, else the monogram's", () => {
    expect(
      plannerProjectColor({
        title: "Website",
        projectIcon: { kind: "monogram", text: "WS", color: "violet" },
      }),
    ).toBe("violet");
    const derived = plannerProjectColor({ title: "Website" });
    expect(derived).not.toBeNull();
    expect(
      plannerProjectColor({ title: "Website", projectIcon: { kind: "emoji", emoji: "🌐" } }),
    ).toBe(derived);
    expect(plannerProjectColor(null)).toBeNull();
  });
});

describe("planner gate", () => {
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
