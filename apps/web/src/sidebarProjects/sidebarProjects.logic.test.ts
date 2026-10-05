import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectsRows } from "./sidebarProjects.logic";

interface TestProject {
  readonly projectKey: string;
  readonly scratch?: boolean;
  readonly primary?: boolean;
}

const project = (projectKey: string, extra: Partial<TestProject> = {}): TestProject => ({
  projectKey,
  primary: true,
  ...extra,
});

function rows(projects: TestProject[], selectedProjectKey: string | null = null) {
  const result = buildSidebarProjectsRows({
    projects,
    selectedProjectKey,
    isScratch: (entry) => entry.scratch === true,
    isPrimary: (entry) => entry.primary === true,
  });
  return {
    preview: result.preview.map((entry) => entry.projectKey),
    scratch: result.scratch?.projectKey ?? null,
    overflow: result.overflow.map((entry) => entry.projectKey),
  };
}

describe("buildSidebarProjectsRows", () => {
  it("shows the first projects in order, Scratch apart, and the rest under More", () => {
    expect(
      rows([
        project("a"),
        project("scratch", { scratch: true }),
        project("b"),
        project("c"),
        project("d"),
        project("e"),
      ]),
    ).toEqual({ preview: ["a", "b", "c"], scratch: "scratch", overflow: ["d", "e"] });
  });

  it("keeps a selected project from More visible in the last preview slot", () => {
    expect(rows([project("a"), project("b"), project("c"), project("d")], "d")).toEqual({
      preview: ["a", "b", "d"],
      scratch: null,
      overflow: ["c"],
    });
  });

  it("has no More without overflow and no No project without a Scratch project", () => {
    expect(rows([project("a"), project("b")], "a")).toEqual({
      preview: ["a", "b"],
      scratch: null,
      overflow: [],
    });
  });

  it("uses the primary environment's Scratch project and lists any other one as a project", () => {
    expect(
      rows([
        project("remote-scratch", { scratch: true, primary: false }),
        project("local-scratch", { scratch: true }),
        project("a"),
      ]),
    ).toEqual({ preview: ["remote-scratch", "a"], scratch: "local-scratch", overflow: [] });
  });
});
