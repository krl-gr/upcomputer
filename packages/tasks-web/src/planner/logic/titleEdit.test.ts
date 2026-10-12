import * as NodeAssert from "node:assert/strict";
import { describe, test } from "vite-plus/test";

import { titleEditResult } from "./titleEdit.ts";

describe("saving an inline title edit", () => {
  test("saves the trimmed title", () => {
    NodeAssert.deepEqual(titleEditResult("  Call the bank \n", "Call bank"), {
      kind: "save",
      title: "Call the bank",
    });
  });

  test("refuses an empty or blank title", () => {
    NodeAssert.deepEqual(titleEditResult("", "Call bank"), { kind: "empty" });
    NodeAssert.deepEqual(titleEditResult(" \n ", "Call bank"), { kind: "empty" });
  });

  test("skips a title that only gained surrounding whitespace", () => {
    NodeAssert.deepEqual(titleEditResult(" Call bank ", "Call bank"), { kind: "unchanged" });
  });
});
