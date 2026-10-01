import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import { test } from "vite-plus/test";

const tasksSource = NodeFS.readFileSync(new URL("./TasksView.tsx", import.meta.url), "utf8");
const chatHeaderSource = NodeFS.readFileSync(
  new URL("../../../../apps/web/src/components/chat/ChatHeader.tsx", import.meta.url),
  "utf8",
);
const sidebarSource = NodeFS.readFileSync(
  new URL("../../../../apps/web/src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);

test("task project labels use the primary foreground tone", () => {
  NodeAssert.match(
    tasksSource,
    /<DetailSidebarRow label="Project">[\s\S]*?justify-end gap-2 text-foreground/,
  );
  NodeAssert.match(
    tasksSource,
    /aria-label="Task project"[\s\S]*?justify-end gap-2 text-foreground/,
  );
  NodeAssert.match(
    tasksSource,
    /<td className="px-4 py-4 align-top text-foreground">[\s\S]*?task\.projectName/,
  );
});

test("chat and sidebar project labels retain their contextual tones", () => {
  NodeAssert.match(chatHeaderSource, /max-w-40 truncate text-sm font-medium text-muted-foreground/);
  NodeAssert.match(sidebarSource, /SIDEBAR_LABEL_COLOR_CLASS/);
  NodeAssert.match(sidebarSource, /data-\[active=true\]:text-sidebar-foreground/);
});
