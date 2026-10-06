import * as NodeAssert from "node:assert/strict";
import * as NodeURL from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vite-plus/test";

import type { ScopedTaskAgent, ScopedTaskAutomation } from "../state/index.ts";
import { assertTableRowsOneSize } from "./tableRows.testing.ts";

/** Loads modules through Vite, as the app does (aliases, Base UI, lucide). */
async function loadModules(context: { onTestFinished: (fn: () => Promise<void>) => void }) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    appType: "custom",
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@t3tools/contracts": NodeURL.fileURLToPath(
          new URL("../../../../packages/contracts/src/index.ts", import.meta.url),
        ),
        "~": NodeURL.fileURLToPath(new URL("../../../../apps/web/src", import.meta.url)),
        "@t3tools/client-runtime/environment": NodeURL.fileURLToPath(
          new URL("../../../../packages/client-runtime/src/environment/index.ts", import.meta.url),
        ),
        "@t3tools/shared": NodeURL.fileURLToPath(
          new URL("../../../../packages/shared/src", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@base-ui/react"], external: ["lucide"] },
  });
  context.onTestFinished(() => vite.close());
  const publicWebSource = NodeURL.fileURLToPath(
    new URL("../../../../apps/web/src", import.meta.url),
  );
  return {
    agents: (await vite.ssrLoadModule(
      "/src/ui/AgentsView.tsx",
    )) as typeof import("./AgentsView.tsx"),
    automations: (await vite.ssrLoadModule(
      "/src/ui/AutomationsView.tsx",
    )) as typeof import("./AutomationsView.tsx"),
    sidebar: (await vite.ssrLoadModule(`/@fs/${publicWebSource}/components/ui/sidebar.tsx`)) as {
      SidebarProvider: (props: { children: unknown }) => unknown;
    },
    select: (await vite.ssrLoadModule(
      "/src/ui/ProjectFilterSelect.tsx",
    )) as typeof import("./ProjectFilterSelect.tsx"),
    sidebarIcons: (await vite.ssrLoadModule(
      `/@fs/${publicWebSource}/sidebarProjects/sidebarProjectIcons.tsx`,
    )) as typeof import("../../../../apps/web/src/sidebarProjects/sidebarProjectIcons.tsx"),
    sidebarRows: (await vite.ssrLoadModule(
      `/@fs/${publicWebSource}/sidebarProjects/sidebarProjects.logic.ts`,
    )) as typeof import("../../../../apps/web/src/sidebarProjects/sidebarProjects.logic.ts"),
  };
}

const favicon = {
  environmentId: "local",
  workspaceRoot: "/repo/upcomputer",
  title: "UpComputer",
  faviconPath: null,
  projectIcon: { kind: "monogram", text: "UC", color: "pink" },
};
const project = {
  environmentId: "local",
  id: "project-1",
  name: "UpComputer",
  workspaceRoot: "/repo/upcomputer",
  favicon,
};
const oneProject = {
  key: "repo:upcomputer",
  label: "UpComputer",
  projectRefs: [{ environmentId: "local", projectId: "project-1" }],
};

test("Agents show the project as an icon, a global agent as All projects, none for one project", async (context) => {
  const { agents } = await loadModules(context);
  const agent = (projectId: string | null, projectName: string | null) =>
    ({
      id: `agent-${projectId}`,
      environmentId: "local",
      projectId,
      projectName,
      name: "Reviewer",
      enabled: true,
      startStatuses: ["To Do"],
      startTags: [],
      startRunStatuses: [],
      config: { instructions: "", modelSelection: { instanceId: "p", model: "m" } },
    }) as unknown as ScopedTaskAgent;
  const row = (props: { agent: ScopedTaskAgent; showProject: boolean }) =>
    renderToStaticMarkup(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          createElement(agents.AgentTableRow, {
            ...props,
            agentProject: props.agent.projectId ? (project as never) : null,
            editable: true,
            saving: false,
            triggerLabel: "To Do",
            modelLabel: "Codex",
            onOpen: () => undefined,
            onToggleEnabled: () => undefined,
          }),
        ),
      ),
    );

  const projectRow = row({ agent: agent("project-1", "UpComputer"), showProject: true });
  NodeAssert.match(projectRow, /aria-label="UpComputer"[^>]*data-project-icon="project"/);
  NodeAssert.match(projectRow, />UC</, "the project's own monogram");
  NodeAssert.doesNotMatch(projectRow, />UpComputer</, "no project name text");
  NodeAssert.ok(
    projectRow.indexOf("data-project-icon=") < projectRow.indexOf(">Reviewer<"),
    "the project icon is the first column",
  );
  assertTableRowsOneSize(projectRow.replace("<table>", '<table class="text-sm">'));

  const globalRow = row({ agent: agent(null, null), showProject: true });
  NodeAssert.match(globalRow, /aria-label="All projects"[^>]*data-project-icon="all"/);
  NodeAssert.match(globalRow, /lucide-layout-grid/, "the sidebar's All projects icon");

  NodeAssert.doesNotMatch(
    row({ agent: agent("project-1", "UpComputer"), showProject: false }),
    /data-project-icon=/,
  );
});

test("Automations show the project icon column unless one project is selected", async (context) => {
  const { automations, sidebar } = await loadModules(context);
  const automation = {
    id: "automation-1",
    environmentId: "local",
    projectId: "project-1",
    projectName: "UpComputer",
    name: "Nightly triage",
    status: "enabled",
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    template: { title: "Triage", description: "", status: "To Do", tags: [], priority: null },
    catchUpPolicy: "skip",
    skipIfOpen: true,
    createdBy: "agent",
    sourceThreadId: null,
    nextRunAt: null,
    lastFiredAt: null,
    lastFiredSlot: null,
    lastTaskId: null,
    lastError: null,
    failureCount: 0,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
  } as unknown as ScopedTaskAutomation;
  const render = (projectFilter: typeof oneProject | null) =>
    renderToStaticMarkup(
      createElement(
        sidebar.SidebarProvider as never,
        null,
        createElement(automations.AutomationsView, {
          projects: [project as never],
          automations: [automation],
          projectFilter: projectFilter as never,
          projectSelect: createElement("button", { "aria-label": "Filter by project" }),
          tasks: [],
          runs: [],
          status: "ready",
          canMutateEnvironment: () => true,
          getClient: () => null,
          onReload: () => undefined,
          onNavigateBack: () => undefined,
          onOpenTask: () => undefined,
        }),
      ),
    );

  const all = render(null);
  NodeAssert.match(all, /aria-label="Filter by project"/, "the shared select is in the header");
  NodeAssert.doesNotMatch(all, /<th[^>]*>Project<\/th>/, "no Project text column");
  NodeAssert.match(all, /aria-label="UpComputer"[^>]*data-project-icon="project"/);
  NodeAssert.ok(all.indexOf("data-project-icon=") < all.indexOf(">Nightly triage<"));
  assertTableRowsOneSize(all);
  NodeAssert.match(all, /data-table-pill="neutral">Proposed</, "a proposed automation's pill");

  const one = render(oneProject);
  NodeAssert.match(one, /Nightly triage/);
  NodeAssert.doesNotMatch(one, /data-project-icon=/);
  NodeAssert.doesNotMatch(one, /<span class="sr-only">Project<\/span>/);
});

test("the project select lists each project once, in the sidebar's order and icons", async (context) => {
  const { select, sidebarIcons, sidebarRows } = await loadModules(context);
  const group = (projectKey: string, displayName: string, text: string) =>
    ({
      ...favicon,
      projectKey,
      displayName,
      title: displayName,
      projectIcon: { kind: "monogram", text, color: "pink" },
      memberProjects: [],
      memberProjectRefs: [],
    }) as never;
  const groups = [
    group("t3code", "pingdotgg/t3code", "T3"),
    group("scratch", "Scratch", "SC"),
    group("upcomputer", "UpComputer", "UC"),
  ];
  // The rows the select builds: the sidebar's own split, without a preview cap.
  const rows = sidebarRows.buildSidebarProjectsRows({
    projects: groups as ReadonlyArray<{ projectKey: string }>,
    selectedProjectKey: null,
    isScratch: (project) => project.projectKey === "scratch",
    isPrimary: () => true,
    limit: Number.POSITIVE_INFINITY,
  });
  const options = select.projectFilterOptions(rows as never);
  NodeAssert.deepEqual(
    options.map((option) => option.label),
    ["All projects", "No project", "pingdotgg/t3code", "UpComputer"],
  );
  NodeAssert.equal(new Set(options.map((option) => option.value)).size, options.length);
  const iconType = (index: number) => (options[index]!.icon as { type: unknown }).type;
  NodeAssert.equal(iconType(0), sidebarIcons.AllProjectsIcon);
  NodeAssert.equal(iconType(1), sidebarIcons.NoProjectIcon);
  NodeAssert.equal(iconType(2), sidebarIcons.ProjectRowIcon);

  // The closed select shows the chosen project's icon; a stale choice falls back to All.
  const trigger = (value: string | null) =>
    renderToStaticMarkup(
      createElement(select.ProjectFilterSelect, {
        projectGroups: groups,
        value,
        onChange: () => undefined,
      }),
    );
  const chosen = trigger("upcomputer");
  NodeAssert.match(chosen, /aria-label="Filter by project"/);
  NodeAssert.match(chosen, />UC<[\s\S]*>UpComputer</);
  NodeAssert.match(trigger(null), /lucide-layout-grid[\s\S]*>All projects</);
  NodeAssert.match(trigger("deleted-project"), />All projects</);
});
