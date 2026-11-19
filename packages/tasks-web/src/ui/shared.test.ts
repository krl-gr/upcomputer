import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { uniqueStatuses } from "./shared.ts";

test("status options list each status once, in its canonical spelling where there is one", () => {
  NodeAssert.deepEqual(uniqueStatuses(["done", "Done", " to do ", "Waiting", "waiting", "To Do"]), [
    "Done",
    "To Do",
    "Waiting",
  ]);
});
