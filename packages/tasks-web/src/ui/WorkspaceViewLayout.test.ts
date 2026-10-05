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

const sourceFiles = (directory: URL): string[] =>
  NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(`${entry.name}/`, directory))
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [NodeFS.readFileSync(new URL(entry.name, directory), "utf8")]
        : [],
  );

test("pages use upstream's page header and leave the sidebar toggle to the shared chrome", () => {
  NodeAssert.match(
    source,
    /import \{ WorkspacePageHeader \} from "\.\.\/\.\.\/\.\.\/\.\.\/apps\/web\/src\/extensionApi\.ts";/,
  );
  NodeAssert.match(source, /<WorkspacePageHeader electron=\{isElectron\}>/);
  NodeAssert.doesNotMatch(source, /<header/);
  for (const file of sourceFiles(new URL("../", import.meta.url))) {
    NodeAssert.doesNotMatch(file, /SidebarTrigger/);
  }
});

test("page content sits inside the header's gutters", () => {
  NodeAssert.match(source, /pl-\(--workspace-gutter-start\) pr-\(--workspace-gutter-end\)/);
  for (const view of ["TasksView.tsx", "AgentsView.tsx", "AutomationsView.tsx"]) {
    const viewSource = NodeFS.readFileSync(new URL(`./${view}`, import.meta.url), "utf8");
    // Content adds no horizontal padding or centering of its own.
    NodeAssert.doesNotMatch(viewSource, /max-w-\[1600px\]/);
  }
});

test("the Tasks header keeps its project and status filters", () => {
  const tasksView = NodeFS.readFileSync(new URL("./TasksView.tsx", import.meta.url), "utf8");
  const toolbar = tasksView.slice(
    tasksView.indexOf("toolbar={"),
    tasksView.indexOf("onNavigateBack={"),
  );
  NodeAssert.match(toolbar, /aria-label="Filter by project"/);
  NodeAssert.match(toolbar, /aria-label="Filter by status"/);
});
