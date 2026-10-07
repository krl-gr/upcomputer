import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { layoutDay } from "./calendarLayout.ts";
import { addDays, viewStartFor, weekStartOf, weekdayOf } from "./dates.ts";
import { calendarDropTime, planListDrop, planScheduleDrop } from "./dndPlanning.ts";
import { insertionIndex } from "./placement.ts";
import { countProgress, progressLabel, weekRangeOf } from "./progress.ts";
import {
  entryTimingLabel,
  minutesToTime,
  parseTimeToMinutes,
  resizedDuration,
  slotAtOffset,
} from "./time.ts";

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

describe("time", () => {
  test("parses and formats wall-clock times", () => {
    NodeAssert.equal(parseTimeToMinutes("09:30"), 570);
    NodeAssert.equal(parseTimeToMinutes("24:00"), null);
    NodeAssert.equal(parseTimeToMinutes(null), null);
    NodeAssert.equal(minutesToTime(570), "09:30");
    NodeAssert.equal(minutesToTime(-5), "00:00");
    NodeAssert.equal(minutesToTime(24 * 60 + 30), "23:59");
  });

  test("a pointer offset maps to a quarter-hour slot inside the day", () => {
    NodeAssert.equal(slotAtOffset(0, 1440, 15), 0);
    NodeAssert.equal(slotAtOffset(14.9, 1440, 15), 0);
    NodeAssert.equal(slotAtOffset(15, 1440, 15), 1);
    NodeAssert.equal(slotAtOffset(-40, 1440, 15), 0);
    NodeAssert.equal(slotAtOffset(99_999, 96 * 15, 15), 95);
  });

  test("resizing snaps to quarter hours between 15 minutes and four hours", () => {
    NodeAssert.equal(resizedDuration(30, 0, 15), 30);
    NodeAssert.equal(resizedDuration(30, 8, 15), 45);
    NodeAssert.equal(resizedDuration(30, -100, 15), 15);
    NodeAssert.equal(resizedDuration(30, 10_000, 15), 240);
  });

  test("the timing label shows the start time and only an explicit duration", () => {
    NodeAssert.equal(entryTimingLabel(entry("a", null)), "");
    NodeAssert.equal(entryTimingLabel(entry("a", null, 45)), "45m");
    NodeAssert.match(entryTimingLabel(entry("a", "13:05", 30), "en-GB"), /^13:05 · 30m$/);
  });
});

describe("calendar layout", () => {
  test("untimed entries stay out of the grid and the default duration fills gaps", () => {
    const items = layoutDay([entry("a", "09:00"), entry("b", null)], 30, 15);
    NodeAssert.deepEqual(
      items.map((item) => [item.entry.id, item.startMinute, item.endMinute]),
      [["a", 540, 570]],
    );
    NodeAssert.equal(items[0]!.position.top, 540);
    NodeAssert.equal(items[0]!.position.height, 30);
  });

  test("overlapping entries share their group's width in lanes", () => {
    const items = layoutDay(
      [
        entry("a", "09:00", 60),
        entry("b", "09:30", 60),
        entry("c", "10:00", 30),
        entry("d", "12:00"),
      ],
      30,
      15,
    );
    const lanes = Object.fromEntries(
      items.map((item) => [item.entry.id, [item.position.laneIndex, item.position.laneCount]]),
    );
    NodeAssert.deepEqual(lanes, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
    NodeAssert.equal(items.find((item) => item.entry.id === "b")!.position.leftPct, 50);
  });

  test("an entry ending at midnight is cut at the end of the day", () => {
    const [item] = layoutDay([entry("a", "23:30", 120)], 30, 15);
    NodeAssert.equal(item!.endMinute, 1440);
  });

  test("a very short entry keeps half a slot of height", () => {
    const [item] = layoutDay([entry("a", "09:00", 1)], 30, 20);
    NodeAssert.equal(item!.position.height, 10);
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

describe("drag and drop planning", () => {
  const list = ["a", "b", "c", "d"];

  test("a row dropped on another row goes above it", () => {
    NodeAssert.deepEqual(planListDrop(list, "a", { kind: "list-item", taskId: "c" }, true), {
      kind: "reorder",
      taskId: "a",
      beforeTaskId: "c",
    });
    NodeAssert.deepEqual(planListDrop(list, "d", { kind: "list-item", taskId: "a" }, true), {
      kind: "reorder",
      taskId: "d",
      beforeTaskId: "a",
    });
  });

  test("drops that change nothing are skipped", () => {
    NodeAssert.equal(planListDrop(list, "b", { kind: "list-item", taskId: "b" }, true), null);
    NodeAssert.equal(planListDrop(list, "b", { kind: "list-item", taskId: "c" }, true), null);
    NodeAssert.equal(planListDrop(list, "d", { kind: "list-bottom" }, true), null);
  });

  test("the bottom zone appends, unless more rows are still to load", () => {
    NodeAssert.deepEqual(planListDrop(list, "a", { kind: "list-bottom" }, true), {
      kind: "reorder",
      taskId: "a",
      afterTaskId: "d",
    });
    NodeAssert.equal(planListDrop(list, "a", { kind: "list-bottom" }, false), null);
  });

  const byDate = new Map([
    ["2026-10-07", ["e1", "e2", "e3"]],
    ["2026-10-08", ["e4"]],
  ]);
  const task = { kind: "task", taskId: "t" } as const;
  const one = (id: string, date = "2026-10-07") =>
    ({ kind: "entry", entryId: id, date, ids: [id] }) as const;

  test("a task dropped on the week adds an entry where it lands", () => {
    NodeAssert.deepEqual(
      planScheduleDrop(task, { kind: "queue-column", date: "2026-10-08" }, byDate),
      {
        kind: "add",
        taskId: "t",
        date: "2026-10-08",
      },
    );
    NodeAssert.deepEqual(
      planScheduleDrop(task, { kind: "queue-entry", entryId: "e2", date: "2026-10-07" }, byDate),
      { kind: "add", taskId: "t", date: "2026-10-07", placement: { before: "e2" } },
    );
    NodeAssert.deepEqual(
      planScheduleDrop(
        task,
        { kind: "calendar-day", date: "2026-10-07", startTime: "14:15" },
        byDate,
      ),
      { kind: "add", taskId: "t", date: "2026-10-07", startTime: "14:15" },
    );
    NodeAssert.equal(planScheduleDrop(task, { kind: "list-bottom" }, byDate), null);
  });

  test("an entry moves above the entry it lands on, or to the end of a column", () => {
    NodeAssert.deepEqual(
      planScheduleDrop(
        one("e3"),
        { kind: "queue-entry", entryId: "e1", date: "2026-10-07" },
        byDate,
      ),
      { kind: "move", ids: ["e3"], date: "2026-10-07", placement: { before: "e1" } },
    );
    NodeAssert.deepEqual(
      planScheduleDrop(one("e1"), { kind: "queue-column", date: "2026-10-08" }, byDate),
      { kind: "move", ids: ["e1"], date: "2026-10-08", placement: { at: "bottom" } },
    );
  });

  test("entry drops that change nothing are skipped", () => {
    NodeAssert.equal(
      planScheduleDrop(
        one("e1"),
        { kind: "queue-entry", entryId: "e2", date: "2026-10-07" },
        byDate,
      ),
      null,
    );
    NodeAssert.equal(
      planScheduleDrop(one("e3"), { kind: "queue-column", date: "2026-10-07" }, byDate),
      null,
    );
    NodeAssert.equal(
      planScheduleDrop(
        { kind: "entry", entryId: "e1", date: "2026-10-07", ids: ["e1", "e2"] },
        { kind: "queue-entry", entryId: "e2", date: "2026-10-07" },
        byDate,
      ),
      null,
    );
  });

  test("selected entries move as a block, and a calendar drop sets their start time", () => {
    NodeAssert.deepEqual(
      planScheduleDrop(
        { kind: "entry", entryId: "e1", date: "2026-10-07", ids: ["e1", "e4"] },
        { kind: "calendar-day", date: "2026-10-09", startTime: "08:30" },
        byDate,
      ),
      { kind: "move", ids: ["e1", "e4"], date: "2026-10-09", startTime: "08:30" },
    );
  });

  test("calendar Y maps to the slot under the card's top", () => {
    const column = { columnTop: 100, columnHeight: 96 * 15, slotHeight: 15 };
    NodeAssert.equal(calendarDropTime({ ...column, pointerY: 100, grabOffsetY: 0 }), "00:00");
    NodeAssert.equal(
      calendarDropTime({ ...column, pointerY: 100 + 9 * 60, grabOffsetY: 0 }),
      "09:00",
    );
    NodeAssert.equal(
      calendarDropTime({ ...column, pointerY: 100 + 9 * 60 + 20, grabOffsetY: 20 }),
      "09:00",
    );
    NodeAssert.equal(calendarDropTime({ ...column, pointerY: 99_999, grabOffsetY: 0 }), "23:45");
  });
});
