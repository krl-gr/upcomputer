import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { layoutDay } from "./calendarLayout.ts";
import {
  calendarDropTime,
  dropReturnsToSource,
  planListDrop,
  planScheduleDrop,
  queueDropTarget,
} from "./dndPlanning.ts";
import {
  LIST_HEADER_WIDTH,
  MIN_LIST_WIDTH,
  MIN_WEEK_WIDTH,
  plannerIsWide,
  WIDE_PLANNER_MIN_WIDTH,
} from "./plannerWidth.ts";
import { snapStackedWeek } from "./stackedWeek.ts";
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
    const items = layoutDay([entry("a", "09:00"), entry("b", null)], () => 30, 15);
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
      () => 30,
      15,
    );
    const lanes = Object.fromEntries(
      items.map((item) => [item.entry.id, [item.position.laneIndex, item.position.laneCount]]),
    );
    NodeAssert.deepEqual(lanes, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
    NodeAssert.equal(items.find((item) => item.entry.id === "b")!.position.leftPct, 50);
  });

  test("an entry ending at midnight is cut at the end of the day", () => {
    const [item] = layoutDay([entry("a", "23:30", 120)], () => 30, 15);
    NodeAssert.equal(item!.endMinute, 1440);
  });

  test("a very short entry keeps half a slot of height", () => {
    const [item] = layoutDay([entry("a", "09:00", 1)], () => 30, 20);
    NodeAssert.equal(item!.position.height, 10);
  });
});

describe("planner layout", () => {
  test("the list sits beside the week from the threshold up, stacked below it", () => {
    NodeAssert.equal(plannerIsWide(WIDE_PLANNER_MIN_WIDTH - 1), false);
    NodeAssert.equal(plannerIsWide(WIDE_PLANNER_MIN_WIDTH), true);
    NodeAssert.equal(plannerIsWide(WIDE_PLANNER_MIN_WIDTH + 1), true);
  });

  test("the planner goes wide only where the narrowest list and the narrowest week both fit", () => {
    NodeAssert.equal(WIDE_PLANNER_MIN_WIDTH, MIN_LIST_WIDTH + MIN_WEEK_WIDTH);
    NodeAssert.ok(MIN_LIST_WIDTH >= LIST_HEADER_WIDTH);
    NodeAssert.equal(plannerIsWide(MIN_LIST_WIDTH + MIN_WEEK_WIDTH - 1), false);
  });

  test("a dragged stacked week settles hidden, split or full by its share of the room", () => {
    const room = 500;
    NodeAssert.equal(snapStackedWeek(0, room), "hidden");
    NodeAssert.equal(snapStackedWeek(99, room), "hidden");
    NodeAssert.equal(snapStackedWeek(100, room), "split");
    NodeAssert.equal(snapStackedWeek(299, room), "split");
    NodeAssert.equal(snapStackedWeek(300, room), "full");
    NodeAssert.equal(snapStackedWeek(room, room), "full");
    NodeAssert.equal(snapStackedWeek(40, 0), "hidden");
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

  // Cards of 2026-10-07 as a day column lays them out: 40px tall, 4px apart, under a header.
  const cards = [
    { id: "e1", top: 100, height: 40 },
    { id: "e2", top: 144, height: 40 },
    { id: "e3", top: 188, height: 40 },
  ];
  const dropAt = (source: ReturnType<typeof one>, date: string, pointerY: number) =>
    planScheduleDrop(
      source,
      queueDropTarget(date, pointerY, date === "2026-10-07" ? cards : []),
      byDate,
    );

  test("a day column drop goes above the first card whose middle is below the pointer", () => {
    NodeAssert.deepEqual(queueDropTarget("2026-10-07", 60, cards), {
      kind: "queue-entry",
      entryId: "e1",
      date: "2026-10-07",
    });
    NodeAssert.deepEqual(queueDropTarget("2026-10-07", 125, cards), {
      kind: "queue-entry",
      entryId: "e2",
      date: "2026-10-07",
    });
    NodeAssert.deepEqual(queueDropTarget("2026-10-07", 220, cards), {
      kind: "queue-column",
      date: "2026-10-07",
    });
  });

  test("an entry reaches the first place of its own day", () => {
    const first = { kind: "move", ids: ["e3"], date: "2026-10-07", placement: { before: "e1" } };
    // Just under the header, the gap above the first card, its upper half.
    NodeAssert.deepEqual(dropAt(one("e3"), "2026-10-07", 60), first);
    NodeAssert.deepEqual(dropAt(one("e3"), "2026-10-07", 98), first);
    NodeAssert.deepEqual(dropAt(one("e3"), "2026-10-07", 110), first);
    // Its lower half is the second place.
    NodeAssert.deepEqual(dropAt(one("e3"), "2026-10-07", 130), {
      kind: "move",
      ids: ["e3"],
      date: "2026-10-07",
      placement: { before: "e2" },
    });
  });

  test("an entry from another day reaches the first place", () => {
    NodeAssert.deepEqual(dropAt(one("e4", "2026-10-08"), "2026-10-07", 110), {
      kind: "move",
      ids: ["e4"],
      date: "2026-10-07",
      placement: { before: "e1" },
    });
  });

  test("an entry reaches an empty day and the last place", () => {
    NodeAssert.deepEqual(dropAt(one("e1"), "2026-10-09", 300), {
      kind: "move",
      ids: ["e1"],
      date: "2026-10-09",
      placement: { at: "bottom" },
    });
    // The lower half of the last card, or anywhere below it.
    const last = { kind: "move", ids: ["e1"], date: "2026-10-07", placement: { at: "bottom" } };
    NodeAssert.deepEqual(dropAt(one("e1"), "2026-10-07", 220), last);
    NodeAssert.deepEqual(dropAt(one("e1"), "2026-10-07", 600), last);
    NodeAssert.deepEqual(dropAt(one("e4", "2026-10-08"), "2026-10-07", 220), {
      kind: "move",
      ids: ["e4"],
      date: "2026-10-07",
      placement: { at: "bottom" },
    });
  });

  test("a drop next to the entry itself changes nothing", () => {
    NodeAssert.equal(dropAt(one("e2"), "2026-10-07", 150), null);
    NodeAssert.equal(dropAt(one("e2"), "2026-10-07", 175), null);
    NodeAssert.equal(dropAt(one("e2"), "2026-10-07", 130), null);
    NodeAssert.equal(dropAt(one("e3"), "2026-10-07", 220), null);
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

  test("only a task added to a day keeps its preview from flying back to the list", () => {
    const queueDay = { kind: "queue-column", date: "2026-10-08" } as const;
    const calendarDay = { kind: "calendar-day", date: "2026-10-08", startTime: "09:00" } as const;
    NodeAssert.equal(dropReturnsToSource(planScheduleDrop(task, queueDay, byDate)), false);
    NodeAssert.equal(dropReturnsToSource(planScheduleDrop(task, calendarDay, byDate)), false);
    // The moved card or reordered row is where the preview settles.
    NodeAssert.equal(dropReturnsToSource(planScheduleDrop(one("e1"), queueDay, byDate)), true);
    NodeAssert.equal(dropReturnsToSource(planScheduleDrop(one("e1"), calendarDay, byDate)), true);
    NodeAssert.equal(
      dropReturnsToSource(planListDrop(list, "a", { kind: "list-item", taskId: "c" }, true)),
      true,
    );
    // A drop that does nothing is a cancel.
    NodeAssert.equal(
      dropReturnsToSource(planScheduleDrop(task, { kind: "list-bottom" }, byDate)),
      true,
    );
    NodeAssert.equal(dropReturnsToSource(null), true);
  });
});
