import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import { it } from "vite-plus/test";

import {
  isInboxRoot,
  pickerProjects,
  ProjectChip,
  ProjectIcon,
  taskProjectsOf,
  type PlannerProject,
} from "@t3tools/tasks-web/planner";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import type { Project } from "../types";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * Project names in task screens: a task's project chip and the projects its
 * picker offers, named and grouped as the sidebar's Projects section shows them.
 */

const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");

const repository = (owner: string, name: string) => ({
  canonicalKey: `github.com/${owner}/${name}`.toLowerCase(),
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: `https://github.com/${owner}/${name}.git`,
  },
  provider: SourceControlProviderKind.make("github"),
  owner,
  name,
  displayName: `${owner}/${name}`,
});

function project(
  id: string,
  title: string,
  workspaceRoot: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    environmentId: ENVIRONMENT_ID,
    id: ProjectId.make(id),
    title,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const upcomputer = repository("krl-gr", "upcomputer");
const cssynthesizer = repository("krl-gr", "cssynthesizer");
const PROJECTS = [
  project("inbox", "Inbox", "/Users/me/.upcomputer/tasks-inbox"),
  project("workspace", "UpComputer", "/Users/me/Projects/UpComputer"),
  project("upcomputer", "upcomputer", "/Users/me/Projects/UpComputer/upcomputer", {
    repositoryIdentity: upcomputer,
  }),
  project("server", "server", "/Users/me/Projects/UpComputer/worktrees/human-tasks/apps/server", {
    repositoryIdentity: upcomputer,
  }),
  project("CSSynthesizer", "CSSynthesizer", "/Users/me/Projects/CSSynthesizer", {
    repositoryIdentity: cssynthesizer,
  }),
  project("cssynthesizer", "cssynthesizer", "/Users/me/Projects/cssynthesizer", {
    repositoryIdentity: cssynthesizer,
  }),
  project("english", "English", "/Users/me/.upcomputer/projects/english"),
];

/** Each task's project, one task per project. */
const TASK_PROJECT_IDS = PROJECTS.map((item) => item.id);

function taskProjects(): PlannerProject[] {
  const snapshots = buildSidebarProjectSnapshots({
    projects: PROJECTS,
    settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: ENVIRONMENT_ID,
    resolveEnvironmentLabel: () => null,
  });
  return taskProjectsOf(snapshots).map((item) => ({
    id: item.id,
    name: item.name,
    favicon: item.favicon,
    inbox: isInboxRoot(item.workspaceRoot),
    groupKey: item.groupKey,
    pickId: item.pickId,
  }));
}

function TaskChips(props: { readonly projects: readonly PlannerProject[] }) {
  return (
    <div className="flex flex-col items-start gap-2 p-2">
      {TASK_PROJECT_IDS.map((id) => (
        <div key={id} className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="w-28 truncate">task in {id}</span>
          <ProjectChip projects={props.projects} value={id} onChange={() => undefined} />
        </div>
      ))}
    </div>
  );
}

/** The entries the chip's menu lists, drawn as its rows: the Inbox first, then one per group. */
function PickerEntries(props: { readonly projects: readonly PlannerProject[] }) {
  const inbox = props.projects.filter((item) => item.inbox);
  const others = pickerProjects(props.projects.filter((item) => !item.inbox));
  return (
    <div className="flex w-56 flex-col rounded-lg border border-border bg-popover p-1 text-sm">
      {[...inbox, ...others].map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
          <ProjectIcon project={item} />
          <span className="truncate">{item.inbox ? "Inbox" : item.name}</span>
        </div>
      ))}
    </div>
  );
}

const STATES: ReadonlyArray<UiState> = [
  { name: "Task rows' project chips", render: () => <TaskChips projects={taskProjects()} /> },
  { name: "Project picker entries", render: () => <PickerEntries projects={taskProjects()} /> },
];

it("task-projects", async () => {
  await captureUiStateSheet("task-projects", [
    { title: "One name per project, one picker entry per sidebar group", states: STATES },
  ]);
});
