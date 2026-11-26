import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({}));

import { DEFAULT_TASKS_PREFERENCES, decodeTasksPreferences } from "./tasksPreferences";

describe("tasks tab preferences", () => {
  it("starts on Worker tasks with two days in the week", () => {
    expect(decodeTasksPreferences(null)).toEqual(DEFAULT_TASKS_PREFERENCES);
    expect(DEFAULT_TASKS_PREFERENCES.view).toBe("workers");
    expect(DEFAULT_TASKS_PREFERENCES.daysShown).toBe(2);
  });

  it("keeps each readable field and defaults the rest, so one bad value resets nothing else", () => {
    const stored = decodeTasksPreferences(
      JSON.stringify({
        view: "routines",
        daysShown: 5,
        weekHidden: true,
        workerFilters: { status: "Done" },
        unknown: 1,
      }),
    );
    expect(stored).toEqual({ ...DEFAULT_TASKS_PREFERENCES, view: "routines", weekHidden: true });
    expect(decodeTasksPreferences("not json")).toEqual(DEFAULT_TASKS_PREFERENCES);
  });
});
