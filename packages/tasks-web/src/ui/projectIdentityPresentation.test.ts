import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";

const tasksSource = NodeFS.readFileSync(new URL("./TasksView.tsx", import.meta.url), "utf8");

test("task project labels use the primary foreground tone", () => {
  NodeAssert.match(
    tasksSource,
    /<DetailSidebarRow label="Project">[\s\S]*?justify-end gap-2 text-foreground/,
  );
  NodeAssert.match(
    tasksSource,
    /aria-label="Task project"[\s\S]*?justify-end gap-2 text-foreground/,
  );
  // The table shows the project as an icon, named in its tooltip.
  NodeAssert.match(tasksSource, /<ProjectIconCell[\s\S]*?name=\{task\.projectName\}/);
});
