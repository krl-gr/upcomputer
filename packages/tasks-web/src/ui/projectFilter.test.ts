import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { EnvironmentId, ProjectId } from "@upcomputer/contracts";

import type { TasksStateTarget } from "../state/tasksState.ts";
import {
  ALL_PROJECTS_FILTER,
  filterByProjectFilter,
  orderedProjectFilterKeys,
  planTaskQueryLanes,
  preferredProject,
  resolveTaskProjectFilter,
  SIDEBAR_PROJECTS_FILTER,
  type ViewProjectFilter,
} from "./projectFilter.ts";

const env = (id: string) => id as EnvironmentId;
const project = (id: string) => id as ProjectId;
const ref = (environmentId: string, projectId: string) => ({
  environmentId: env(environmentId),
  projectId: project(projectId),
});

// One logical repo checked out twice on the laptop and once on a remote box.
const repoFilter: ViewProjectFilter = {
  key: "repo:upcomputer",
  label: "upcomputer",
  projectRefs: [ref("laptop", "p-main"), ref("laptop", "p-worktree"), ref("remote", "p-remote")],
};

const target = (environmentId: string, projectIds: string[]) =>
  ({
    environmentId: env(environmentId),
    projectNameById: new Map(projectIds.map((id) => [project(id), id])),
  }) as unknown as TasksStateTarget;

test("agents keep member-project and global agents; automations keep member projects only", () => {
  const items = [
    { name: "main", environmentId: env("laptop"), projectId: project("p-main") },
    { name: "remote", environmentId: env("remote"), projectId: project("p-remote") },
    { name: "other", environmentId: env("laptop"), projectId: project("p-other") },
    // Same project id in another environment is a different project.
    { name: "wrong-env", environmentId: env("remote"), projectId: project("p-main") },
    { name: "global", environmentId: env("laptop"), projectId: null },
  ];
  const names = (list: ReadonlyArray<{ name: string }>) => list.map(({ name }) => name);

  NodeAssert.deepEqual(names(filterByProjectFilter(items, repoFilter, { includeGlobal: true })), [
    "main",
    "remote",
    "global",
  ]);
  NodeAssert.deepEqual(names(filterByProjectFilter(items, repoFilter)), ["main", "remote"]);
  NodeAssert.equal(filterByProjectFilter(items, null), items, "All projects keeps the same array");
});

test("create forms preselect the first available member project in sidebar order", () => {
  const projects = [
    { environmentId: env("laptop"), id: project("p-other") },
    { environmentId: env("remote"), id: project("p-remote") },
    { environmentId: env("laptop"), id: project("p-worktree") },
  ];
  const keys = orderedProjectFilterKeys(repoFilter);
  NodeAssert.deepEqual(keys, ["laptop:p-main", "laptop:p-worktree", "remote:p-remote"]);
  // p-main is not mutable/available, so the next member in order wins.
  NodeAssert.equal(preferredProject(projects, keys), projects[2]);
  NodeAssert.equal(preferredProject(projects, null), projects[0]);
  NodeAssert.equal(preferredProject(projects, ["laptop:missing"]), projects[0]);
  NodeAssert.equal(preferredProject([], keys), undefined);
});

test("the Tasks dropdown follows the sidebar and a local choice lasts until the sidebar changes", () => {
  NodeAssert.equal(resolveTaskProjectFilter(null, null), ALL_PROJECTS_FILTER);
  NodeAssert.equal(resolveTaskProjectFilter(null, repoFilter), SIDEBAR_PROJECTS_FILTER);

  const local = { sidebarKey: repoFilter.key, value: "laptop:p-worktree" };
  NodeAssert.equal(resolveTaskProjectFilter(local, repoFilter), "laptop:p-worktree");
  NodeAssert.equal(
    resolveTaskProjectFilter(
      { sidebarKey: repoFilter.key, value: ALL_PROJECTS_FILTER },
      repoFilter,
    ),
    ALL_PROJECTS_FILTER,
    "All projects is a valid local widening of the sidebar scope",
  );
  // Selecting another sidebar project (or All projects) discards the local choice.
  NodeAssert.equal(
    resolveTaskProjectFilter(local, { ...repoFilter, key: "repo:other" }),
    SIDEBAR_PROJECTS_FILTER,
  );
  NodeAssert.equal(resolveTaskProjectFilter(local, null), ALL_PROJECTS_FILTER);
  NodeAssert.equal(
    resolveTaskProjectFilter({ sidebarKey: null, value: SIDEBAR_PROJECTS_FILTER }, null),
    ALL_PROJECTS_FILTER,
  );
});

test("task queries run one lane per member project, scoped to its environment", () => {
  const targets = [
    target("laptop", ["p-main", "p-worktree", "p-other"]),
    target("remote", ["p-remote"]),
    target("ci", ["p-ci"]),
  ];
  const lanes = (
    projectFilter: string,
    sidebarFilter: ViewProjectFilter | null,
    statusFilter = "__all__",
  ) =>
    planTaskQueryLanes({ targets, projectFilter, statusFilter, sidebarFilter, pageSize: 100 }).map(
      (lane) => [lane.target.environmentId, lane.search],
    );

  NodeAssert.deepEqual(lanes(SIDEBAR_PROJECTS_FILTER, repoFilter, "Backlog"), [
    ["laptop", { projectId: "p-main", status: "Backlog", limit: 100 }],
    ["laptop", { projectId: "p-worktree", status: "Backlog", limit: 100 }],
    ["remote", { projectId: "p-remote", status: "Backlog", limit: 100 }],
  ]);
  NodeAssert.deepEqual(lanes(ALL_PROJECTS_FILTER, repoFilter), [
    ["laptop", { limit: 100 }],
    ["remote", { limit: 100 }],
    ["ci", { limit: 100 }],
  ]);
  NodeAssert.deepEqual(lanes("laptop:p-other", repoFilter), [
    ["laptop", { projectId: "p-other", limit: 100 }],
  ]);
  // Without a sidebar selection the sidebar value degrades to all projects.
  NodeAssert.equal(lanes(SIDEBAR_PROJECTS_FILTER, null).length, 3);

  const keys = planTaskQueryLanes({
    targets,
    projectFilter: SIDEBAR_PROJECTS_FILTER,
    statusFilter: "__all__",
    sidebarFilter: repoFilter,
    pageSize: 100,
  }).map((lane) => lane.key);
  NodeAssert.equal(new Set(keys).size, keys.length, "lane keys are unique per project");
});
