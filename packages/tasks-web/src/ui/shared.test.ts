import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { uniqueStatuses } from "./shared.ts";

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
