import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";

const source = NodeFS.readFileSync(new URL("./WorkspaceViewLayout.tsx", import.meta.url), "utf8");

test("workspace header actions use a visible light hover and preserve the dark hover", () => {
  const actionClassLines = source
    .split("\n")
    .filter(
      (line) => line.includes("transition-colors") && line.includes("[-webkit-app-region:no-drag]"),
    );

  NodeAssert.equal(actionClassLines.length, 2);
  for (const line of actionClassLines) {
    NodeAssert.match(line, /hover:bg-accent/);
    NodeAssert.match(line, /dark:hover:bg-white\/\[0\.05\]/);
    NodeAssert.doesNotMatch(line, /transition-colors hover:bg-white/);
  }
});
