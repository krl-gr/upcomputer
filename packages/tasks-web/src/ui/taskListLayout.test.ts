import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { TASK_TABLE_MIN_WIDTH, taskListLayout } from "./taskListLayout.ts";

test("the page shows the table from its least width, the panel always cards", () => {
  NodeAssert.equal(taskListLayout({ panel: false, width: TASK_TABLE_MIN_WIDTH }), "table");
  NodeAssert.equal(taskListLayout({ panel: false, width: TASK_TABLE_MIN_WIDTH - 1 }), "cards");
  NodeAssert.equal(taskListLayout({ panel: false, width: null }), "table", "before measuring");
  NodeAssert.equal(taskListLayout({ panel: true, width: 2000 }), "cards");
  NodeAssert.equal(taskListLayout({ panel: true, width: null }), "cards");
});
