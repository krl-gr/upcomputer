import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  TASK_TABLE_KEEP_SLACK,
  TASK_TABLE_MIN_WIDTH,
  taskListLayout,
  type TaskListLayout,
} from "./taskListLayout.ts";

test("the page shows the table from its least width and keeps it a little under", () => {
  NodeAssert.equal(taskListLayout(TASK_TABLE_MIN_WIDTH, "cards"), "table");
  NodeAssert.equal(taskListLayout(TASK_TABLE_MIN_WIDTH - 1, "cards"), "cards");
  NodeAssert.equal(taskListLayout(TASK_TABLE_MIN_WIDTH - TASK_TABLE_KEEP_SLACK, "table"), "table");
  NodeAssert.equal(
    taskListLayout(TASK_TABLE_MIN_WIDTH - TASK_TABLE_KEEP_SLACK - 1, "table"),
    "cards",
  );
});

test("resizing across the threshold settles although the table's scrollbar narrows the list", () => {
  // The table scrolls in the page, so the page's scrollbar narrows the measured list; the cards
  // scroll in their own box. A Windows scrollbar is the widest the slack has to cover.
  for (const scrollbar of [6, 17]) {
    const measured = (available: number, layout: TaskListLayout) =>
      layout === "table" ? available - scrollbar : available;
    const widths = Array.from({ length: 101 }, (_, index) => TASK_TABLE_MIN_WIDTH - 50 + index);
    let layout: TaskListLayout = "table";
    const switches: string[] = [];
    for (const available of [...widths].reverse().concat(widths)) {
      // Each switch changes the measured width, and the observer reports it again.
      for (let report = 0; ; report += 1) {
        const next = taskListLayout(measured(available, layout), layout);
        if (next === layout) break;
        NodeAssert.ok(report < 1, `${available}px with a ${scrollbar}px scrollbar flips forever`);
        switches.push(`${available}:${next}`);
        layout = next;
      }
    }
    NodeAssert.deepEqual(switches, [
      `${TASK_TABLE_MIN_WIDTH - TASK_TABLE_KEEP_SLACK + scrollbar - 1}:cards`,
      `${TASK_TABLE_MIN_WIDTH}:table`,
    ]);
  }
});
