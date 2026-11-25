import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { taskStatusOptions, uniqueStatuses } from "./shared.ts";

test("status options list each status once, in its canonical spelling where there is one", () => {
  NodeAssert.deepEqual(
    uniqueStatuses(["done", "Done", " to do ", "Waiting", "waiting", "To Do", "in review"], 2),
    ["Done", "To Do", "Waiting", "In Review"],
  );
  // Each workflow spells only its own standard statuses.
  NodeAssert.deepEqual(uniqueStatuses(["needs review", "to verify"], 1), [
    "Needs Review",
    "to verify",
  ]);
  NodeAssert.deepEqual(uniqueStatuses(["needs review", "to verify"], 2), [
    "needs review",
    "To Verify",
  ]);
});

test("status pickers offer every standard status of the workflow, then custom ones in use", () => {
  NodeAssert.deepEqual(taskStatusOptions(["to do", "Waiting", "To Verify"], 2), [
    "Idea",
    "Queued",
    "To Do",
    "In Progress",
    "In Review",
    "Needs You",
    "Blocked",
    "Failed",
    "To Verify",
    "Done",
    "Cancelled",
    "Waiting",
  ]);
  NodeAssert.deepEqual(taskStatusOptions(["Waiting", "to verify"], 1), [
    "Idea",
    "Backlog",
    "To Do",
    "In Progress",
    "In Review",
    "Needs Input",
    "Needs Review",
    "Blocked",
    "Done",
    "Cancelled",
    "Waiting",
    "to verify",
  ]);
});
