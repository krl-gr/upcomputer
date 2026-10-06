import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  taskRunPresentation,
  compareTaskRunStatuses,
  groupTaskRunCounts,
  runSearchStatus,
} from "./taskRunPresentation.ts";

test("pending approval takes precedence over a running task-agent status", () => {
  NodeAssert.equal(taskRunPresentation("running", true)?.label, "Approval");
});

test("interrupted task-agent runs are not presented as working", () => {
  NodeAssert.equal(taskRunPresentation("interrupted", false)?.label, "Interrupted");
});

test("durable finalization states remain truthful while cleanup is retried", () => {
  NodeAssert.equal(taskRunPresentation("finalizing:interrupted", false)?.label, "Interrupted");
  NodeAssert.equal(taskRunPresentation("finalizing:failed", false)?.label, "Failed");
  NodeAssert.equal(taskRunPresentation("finalizing:result", false)?.label, "Finalizing");
  NodeAssert.equal(taskRunPresentation("finalizing:stopped", false)?.label, "Finalizing");
});

test("run badges prioritize working and failed attempts over completed history", () => {
  NodeAssert.deepEqual(["completed", "failed", "running"].sort(compareTaskRunStatuses), [
    "running",
    "failed",
    "completed",
  ]);
});

test("a blocked run replaced by a newer run is history, not awaiting input", () => {
  NodeAssert.equal(taskRunPresentation("blocked", false)?.label, "Awaiting Input");
  NodeAssert.equal(taskRunPresentation("blocked:superseded", false)?.label, "Blocked");
  NodeAssert.deepEqual(
    ["completed", "blocked:superseded", "blocked"].sort(compareTaskRunStatuses),
    ["blocked", "blocked:superseded", "completed"],
  );
  NodeAssert.equal(runSearchStatus("blocked:superseded"), "blocked");
  NodeAssert.equal(runSearchStatus("failed"), "failed");
});

test("row and task-menu counts merge statuses by label in badge order and drop empty ones", () => {
  NodeAssert.deepEqual(
    groupTaskRunCounts([
      { status: "completed", count: 141 },
      { status: "failed", count: 1 },
      { status: "finalizing:failed", count: 2 },
      { status: "blocked:superseded", count: 3 },
      { status: "running", count: 2 },
      { status: "interrupted", count: 0 },
    ]).map(({ label, count, status }) => [label, count, status]),
    [
      ["Working", 2, "running"],
      ["Failed", 3, "failed"],
      ["Blocked", 3, "blocked:superseded"],
      ["Completed", 141, "completed"],
    ],
    "a count opens the runs of its group's first status",
  );
  NodeAssert.equal(
    groupTaskRunCounts([{ status: "blocked:superseded", count: 1 }])[0]?.className,
    "text-orange-600 dark:text-orange-300",
  );
  NodeAssert.deepEqual(groupTaskRunCounts([]), []);
});
