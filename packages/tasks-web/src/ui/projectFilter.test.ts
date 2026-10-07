import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { TasksStateTarget } from "../state/tasksState.ts";
import {
  filterByProjectFilter,
  orderedProjectFilterKeys,
  planTaskQueryLanes,
  preferredProject,
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

test("task queries run one lane per member project, scoped to its environment", () => {
  const targets = [
    target("laptop", ["p-main", "p-worktree", "p-other"]),
    target("remote", ["p-remote"]),
    target("ci", ["p-ci"]),
  ];
  const lanes = (
    projectFilter: ViewProjectFilter | null,
    statusFilter = "__all__",
    tags: string[] = [],
  ) =>
    planTaskQueryLanes({ targets, projectFilter, statusFilter, tags, pageSize: 100 }).map(
      (lane) => [lane.target.environmentId, lane.search],
    );

  NodeAssert.deepEqual(lanes(repoFilter, "Backlog"), [
    ["laptop", { projectId: "p-main", status: "Backlog", limit: 100 }],
    ["laptop", { projectId: "p-worktree", status: "Backlog", limit: 100 }],
    ["remote", { projectId: "p-remote", status: "Backlog", limit: 100 }],
  ]);
  NodeAssert.deepEqual(lanes(null), [
    ["laptop", { limit: 100 }],
    ["remote", { limit: 100 }],
    ["ci", { limit: 100 }],
  ]);

  const keys = planTaskQueryLanes({
    targets,
    projectFilter: repoFilter,
    statusFilter: "__all__",
    pageSize: 100,
  }).map((lane) => lane.key);
  NodeAssert.equal(new Set(keys).size, keys.length, "lane keys are unique per project");

  // Active is the server's default, so only the other archive modes are sent.
  const archive = (mode: "active" | "archived" | "all") =>
    planTaskQueryLanes({
      targets: [target("laptop", ["p-main"])],
      projectFilter: null,
      statusFilter: "__all__",
      archive: mode,
      pageSize: 100,
    }).map((lane) => lane.search);
  NodeAssert.deepEqual(archive("active"), [{ limit: 100 }]);
  NodeAssert.deepEqual(archive("archived"), [{ archive: "archived", limit: 100 }]);
  NodeAssert.deepEqual(archive("all"), [{ archive: "all", limit: 100 }]);
});

test("the tag filter asks the server for tasks with every selected tag", () => {
  const lanes = planTaskQueryLanes({
    targets: [target("laptop", ["p-main"])],
    projectFilter: null,
    statusFilter: "To Do",
    tags: ["browser-use", "ui"],
    pageSize: 100,
  });
  // The server's task page requires every tag in `tags` (AND), see TaskRepositoryLive.
  NodeAssert.deepEqual(
    lanes.map((lane) => lane.search),
    [{ status: "To Do", tags: ["browser-use", "ui"], limit: 100 }],
  );
  const withoutTags = planTaskQueryLanes({
    targets: [target("laptop", ["p-main"])],
    projectFilter: null,
    statusFilter: "To Do",
    tags: [],
    pageSize: 100,
  });
  NodeAssert.notEqual(withoutTags[0]?.key, lanes[0]?.key, "a tag change replaces the query");
});
