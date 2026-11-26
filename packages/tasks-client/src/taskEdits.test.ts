import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { descriptionToSave, titleToSave } from "./taskEdits.ts";

test("a title edit saves trimmed text on one line, and never a blank or unchanged title", () => {
  NodeAssert.equal(titleToSave("  Fix login \n on Safari ", "Fix login"), "Fix login   on Safari");
  NodeAssert.equal(titleToSave("Fix login ", "Fix login"), null);
  NodeAssert.equal(titleToSave(" \n ", "Fix login"), null);
});

test("a description edit saves trimmed text, a blank one clears it", () => {
  NodeAssert.equal(descriptionToSave("Steps\n\n", "Steps"), null);
  NodeAssert.equal(descriptionToSave("  ", "Steps"), "");
  NodeAssert.equal(descriptionToSave(" New steps ", "Steps"), "New steps");
});
