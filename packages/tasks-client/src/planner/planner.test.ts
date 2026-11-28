import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { addDays, viewStartFor, weekStartOf, weekdayOf } from "./dates.ts";
import { insertionIndex } from "./placement.ts";
import { countProgress, progressLabel, weekRangeOf } from "./progress.ts";

const entry = (
  id: string,
  startTime: string | null,
  durationMinutes: number | null = null,
  date = "2026-10-07",
) => ({ id, date, startTime, durationMinutes });

describe("dates", () => {
  test("day arithmetic crosses months, years and daylight-saving changes", () => {
    NodeAssert.equal(addDays("2026-10-31", 1), "2026-11-01");
    NodeAssert.equal(addDays("2026-12-31", 1), "2027-01-01");
    NodeAssert.equal(addDays("2026-03-29", -1), "2026-03-28");
    NodeAssert.equal(addDays("2024-02-28", 1), "2024-02-29");
  });

  test("the week starts on the configured day", () => {
    NodeAssert.equal(weekdayOf("2026-10-07"), 3);
    NodeAssert.equal(weekStartOf("2026-10-07", 0), "2026-10-04");
    NodeAssert.equal(weekStartOf("2026-10-07", 1), "2026-10-05");
    NodeAssert.equal(weekStartOf("2026-10-04", 1), "2026-09-28");
  });

  test("Today shows the week with seven days and the day itself otherwise", () => {
    NodeAssert.equal(viewStartFor("2026-10-07", 7, 1), "2026-10-05");
    NodeAssert.equal(viewStartFor("2026-10-07", 3, 1), "2026-10-07");
  });
});

describe("progress", () => {
  const entries = [
    { date: "2026-10-05", status: "done" },
    { date: "2026-10-06", status: "skipped" },
    { date: "2026-10-07", status: "open" },
    { date: "2026-10-13", status: "done" },
  ];

  test("done and skipped entries count as handled", () => {
    NodeAssert.deepEqual(countProgress(entries), { total: 4, handled: 3 });
    NodeAssert.equal(progressLabel(countProgress(entries)), "3/4");
    NodeAssert.equal(progressLabel({ total: 0, handled: 0 }), null);
  });

  test("a weekly count covers the week of today only", () => {
    const week = weekRangeOf("2026-10-07", 1);
    NodeAssert.deepEqual(week, { from: "2026-10-05", to: "2026-10-11" });
    NodeAssert.deepEqual(countProgress(entries, week), { total: 3, handled: 2 });
  });
});

describe("placement", () => {
  const day = [entry("u1", null), entry("t9", "09:00"), entry("u2", null), entry("t11", "11:00")];

  test("explicit placements", () => {
    NodeAssert.equal(insertionIndex(day, { at: "top" }, null), 0);
    NodeAssert.equal(insertionIndex(day, { at: "bottom" }, "08:00"), 4);
    NodeAssert.equal(insertionIndex(day, { before: "u2" }, null), 2);
    NodeAssert.equal(insertionIndex(day, { after: "u2" }, null), 3);
    NodeAssert.equal(insertionIndex(day, { before: "missing" }, null), null);
  });

  test("a timed entry goes before the first later one and untimed entries keep their place", () => {
    NodeAssert.equal(insertionIndex(day, undefined, "10:00"), 3);
    NodeAssert.equal(insertionIndex(day, undefined, "08:00"), 1);
    NodeAssert.equal(insertionIndex(day, undefined, "12:00"), 4);
    NodeAssert.equal(insertionIndex(day, undefined, null), 4);
  });
});
