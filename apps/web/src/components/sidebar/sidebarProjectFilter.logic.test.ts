import { scopeProjectRef } from "@upcomputer/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectIndex,
  filterThreadsByProjectRefs,
  findLogicalProjectKeyForRef,
  resolveSidebarProjectFilter,
  resolveThreadDisplayProjects,
  resolveThreadProjectIconStack,
  selectPreviewProjects,
} from "./sidebarProjectFilter.logic";

const ENV = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-remote");

function project(
  id: string,
  options: { environmentId?: EnvironmentId; linkedProjectIds?: string[] } = {},
) {
  return {
    environmentId: options.environmentId ?? ENV,
    id: ProjectId.make(id),
    title: id,
    ...(options.linkedProjectIds
      ? { linkedProjectIds: options.linkedProjectIds.map((linked) => ProjectId.make(linked)) }
      : {}),
  };
}

function thread(
  id: string,
  projectId: string,
  options: { environmentId?: EnvironmentId; linkedProjectIds?: string[] } = {},
) {
  return {
    id,
    environmentId: options.environmentId ?? ENV,
    projectId: ProjectId.make(projectId),
    ...(options.linkedProjectIds
      ? { linkedProjectIds: options.linkedProjectIds.map((linked) => ProjectId.make(linked)) }
      : {}),
  };
}

const projects = [
  project("api"),
  project("web", { linkedProjectIds: ["design"] }),
  project("design"),
  project("scratch"),
  project("api", { environmentId: REMOTE }),
];
const projectByKey = buildProjectIndex(projects);

describe("resolveThreadDisplayProjects", () => {
  it("orders own project, thread links, then project links, deduplicated", () => {
    const result = resolveThreadDisplayProjects(
      thread("t1", "web", { linkedProjectIds: ["api", "design", "web"] }),
      projectByKey,
    );
    expect(result.map((entry) => entry.id)).toEqual(["web", "api", "design"]);
  });

  it("ignores unknown ids and ids from other environments", () => {
    const result = resolveThreadDisplayProjects(
      thread("t1", "api", { linkedProjectIds: ["deleted"], environmentId: REMOTE }),
      projectByKey,
    );
    expect(result).toEqual([projects[4]]);
  });

  it("treats missing linkedProjectIds as empty", () => {
    expect(resolveThreadDisplayProjects(thread("t1", "api"), projectByKey)).toEqual([projects[0]]);
  });
});

describe("filterThreadsByProjectRefs", () => {
  const threads = [
    thread("own", "api"),
    thread("linked", "scratch", { linkedProjectIds: ["api"] }),
    thread("project-linked", "web"),
    thread("other", "design"),
    thread("remote", "api", { environmentId: REMOTE }),
    thread("unknown-link", "scratch", { linkedProjectIds: ["gone"] }),
  ];

  it("keeps everything for All projects", () => {
    expect(filterThreadsByProjectRefs(threads, projectByKey, null)).toHaveLength(threads.length);
  });

  it("matches own project, thread links and the own project's links", () => {
    expect(
      filterThreadsByProjectRefs(threads, projectByKey, [
        scopeProjectRef(ENV, ProjectId.make("api")),
      ]).map((entry) => entry.id),
    ).toEqual(["own", "linked"]);
    expect(
      filterThreadsByProjectRefs(threads, projectByKey, [
        scopeProjectRef(ENV, ProjectId.make("design")),
      ]).map((entry) => entry.id),
    ).toEqual(["project-linked", "other"]);
  });

  it("matches any member of a grouped logical project", () => {
    expect(
      filterThreadsByProjectRefs(threads, projectByKey, [
        scopeProjectRef(ENV, ProjectId.make("api")),
        scopeProjectRef(REMOTE, ProjectId.make("api")),
      ]).map((entry) => entry.id),
    ).toEqual(["own", "linked", "remote"]);
  });
});

describe("resolveThreadProjectIconStack", () => {
  const isScratchProject = (entry: { id: string }) => entry.id === "scratch";

  it("omits the scratch project and shows linked projects", () => {
    const stack = resolveThreadProjectIconStack({
      thread: thread("t1", "scratch", { linkedProjectIds: ["api", "web"] }),
      projectByKey,
      isScratchProject,
    });
    expect(stack.allProjects.map((entry) => entry.id)).toEqual(["api", "web"]);
    expect(stack.showScratchIcon).toBe(false);
  });

  it("shows the scratch icon for an unlinked scratch chat", () => {
    const stack = resolveThreadProjectIconStack({
      thread: thread("t1", "scratch", { linkedProjectIds: ["gone"] }),
      projectByKey,
      isScratchProject,
    });
    expect(stack.visibleProjects).toEqual([]);
    expect(stack.showScratchIcon).toBe(true);
  });

  it("caps the visible stack but keeps every name", () => {
    const stack = resolveThreadProjectIconStack({
      thread: thread("t1", "web", { linkedProjectIds: ["api", "scratch"] }),
      projectByKey: buildProjectIndex([...projects, project("extra")]),
      isScratchProject,
      limit: 2,
    });
    expect(stack.visibleProjects.map((entry) => entry.id)).toEqual(["web", "api"]);
    expect(stack.allProjects.map((entry) => entry.id)).toEqual(["web", "api", "design"]);
  });

  it("draws nothing when the own project is not loaded", () => {
    const stack = resolveThreadProjectIconStack({
      thread: thread("t1", "missing"),
      projectByKey,
      isScratchProject,
    });
    expect(stack.visibleProjects).toEqual([]);
    expect(stack.showScratchIcon).toBe(false);
  });
});

describe("resolveSidebarProjectFilter", () => {
  const logicalProjects = [
    {
      projectKey: "logical-api",
      displayName: "API",
      memberProjectRefs: [
        scopeProjectRef(ENV, ProjectId.make("api")),
        scopeProjectRef(REMOTE, ProjectId.make("api")),
      ],
    },
    {
      projectKey: "logical-web",
      displayName: "Web",
      memberProjectRefs: [scopeProjectRef(ENV, ProjectId.make("web"))],
    },
  ];

  it("returns null for All projects and for keys that no longer resolve", () => {
    expect(resolveSidebarProjectFilter(null, logicalProjects)).toBeNull();
    expect(resolveSidebarProjectFilter("logical-deleted", logicalProjects)).toBeNull();
  });

  it("resolves label and every member ref", () => {
    expect(resolveSidebarProjectFilter("logical-api", logicalProjects)).toEqual({
      key: "logical-api",
      label: "API",
      projectRefs: logicalProjects[0]!.memberProjectRefs,
    });
  });

  it("maps a physical project back to its logical key", () => {
    expect(
      findLogicalProjectKeyForRef(scopeProjectRef(REMOTE, ProjectId.make("api")), logicalProjects),
    ).toBe("logical-api");
    expect(
      findLogicalProjectKeyForRef(scopeProjectRef(ENV, ProjectId.make("nope")), logicalProjects),
    ).toBeNull();
  });
});

describe("selectPreviewProjects", () => {
  const list = ["a", "b", "c", "d", "e"].map((projectKey) => ({ projectKey }));
  const keys = (entries: { projectKey: string }[]) => entries.map((entry) => entry.projectKey);

  it("shows the first projects in order", () => {
    expect(keys(selectPreviewProjects(list, null, 3))).toEqual(["a", "b", "c"]);
    expect(keys(selectPreviewProjects(list, "b", 3))).toEqual(["a", "b", "c"]);
  });

  it("keeps a selection past the preview visible in the last slot", () => {
    expect(keys(selectPreviewProjects(list, "e", 3))).toEqual(["a", "b", "e"]);
  });

  it("ignores unknown selections", () => {
    expect(keys(selectPreviewProjects(list, "zzz", 3))).toEqual(["a", "b", "c"]);
  });
});
