import { describe, expect, it } from "vite-plus/test";

import {
  ALL_PROJECTS_ROW_KEY as ALL,
  allProjectsSortIndex,
  buildSidebarProjectsRows,
  manualAllProjectsIndex,
  sidebarProjectsDragOrder,
} from "./sidebarProjects.logic";

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

const PROJECTS = [
  project("a"),
  project("scratch", { scratch: true }),
  project("b"),
  project("c"),
  project("d"),
];

function rows(
  projects: TestProject[],
  options: {
    readonly allProjectsIndex?: number;
    readonly selectedKey?: string;
    readonly heldOrder?: ReadonlyArray<string>;
  } = {},
) {
  const result = buildSidebarProjectsRows({
    projects,
    allProjectsIndex: options.allProjectsIndex ?? 0,
    selectedKey: options.selectedKey ?? ALL,
    isScratch: (entry) => entry.scratch === true,
    isPrimary: (entry) => entry.primary === true,
    heldOrder: options.heldOrder ?? null,
  });
  const label = (row: (typeof result.preview)[number]) =>
    row.kind === "all" ? "All" : row.kind === "scratch" ? `No project (${row.key})` : row.key;
  return { preview: result.preview.map(label), overflow: result.overflow.map(label) };
}

describe("buildSidebarProjectsRows", () => {
  it("sorts All projects and No project with the projects and shows three rows before More", () => {
    expect(rows(PROJECTS)).toEqual({
      preview: ["All", "a", "No project (scratch)"],
      overflow: ["b", "c", "d"],
    });
    // All projects and No project go to More when the projects have newer activity.
    expect(
      rows([project("a"), project("b"), project("c"), project("scratch", { scratch: true })], {
        allProjectsIndex: 4,
        selectedKey: "a",
      }),
    ).toEqual({ preview: ["a", "b", "c"], overflow: ["No project (scratch)", "All"] });
  });

  it("keeps a selected row from More visible in the last preview slot", () => {
    expect(rows(PROJECTS, { selectedKey: "d" })).toEqual({
      preview: ["All", "a", "d"],
      overflow: ["No project (scratch)", "b", "c"],
    });
    const projects = [project("a"), project("b"), project("c"), project("s", { scratch: true })];
    expect(rows(projects, { allProjectsIndex: 4 })).toEqual({
      preview: ["a", "b", "All"],
      overflow: ["c", "No project (s)"],
    });
    expect(rows(projects, { allProjectsIndex: 4, selectedKey: "s" })).toEqual({
      preview: ["a", "b", "No project (s)"],
      overflow: ["c", "All"],
    });
  });

  it("keeps the held order on screen, with new rows in their own slots", () => {
    // All projects was just picked and sorts first, but the pointer is still in the sidebar.
    expect(
      rows([project("a"), project("b"), project("c"), project("new")], {
        allProjectsIndex: 0,
        heldOrder: ["a", "b", ALL, "c"],
      }),
    ).toEqual({ preview: ["a", "b", "All"], overflow: ["c", "new"] });
    expect(
      rows([project("new"), project("a"), project("b")], { heldOrder: ["b", ALL, "a"] }),
    ).toEqual({ preview: ["b", "new", "All"], overflow: ["a"] });
  });

  it("has no rows without projects and no More without overflow", () => {
    expect(rows([])).toEqual({ preview: [], overflow: [] });
    expect(rows([project("a")], { selectedKey: "a", allProjectsIndex: 1 })).toEqual({
      preview: ["a", "All"],
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
    ).toEqual({
      preview: ["All", "remote-scratch", "No project (local-scratch)"],
      overflow: ["a"],
    });
  });
});

describe("All projects' place", () => {
  it("follows its stand-in in an activity order", () => {
    expect(
      allProjectsSortIndex([{ projectKey: "a" }, { projectKey: ALL }, { projectKey: "b" }]),
    ).toBe(1);
  });

  it("follows its entry in the manual order, and comes first without one", () => {
    const projectOrderKeys = [["a"], ["b-local", "b-remote"], ["c"], ["unlisted"]];
    expect(manualAllProjectsIndex({ projectOrder: ["a", "b-local", "c"], projectOrderKeys })).toBe(
      0,
    );
    expect(
      manualAllProjectsIndex({ projectOrder: ["a", "b-remote", ALL, "c"], projectOrderKeys }),
    ).toBe(2);
    expect(
      manualAllProjectsIndex({ projectOrder: ["a", "b-local", "c", ALL], projectOrderKeys }),
    ).toBe(3);
  });

  it("reorders from the rows as shown, keeping other computers' projects", () => {
    expect(
      sidebarProjectsDragOrder({
        rowOrderKeys: [["b"], [ALL], ["a-local", "a-remote"]],
        projectOrder: ["elsewhere", "a-local", "b"],
      }),
    ).toEqual(["b", ALL, "a-local", "a-remote", "elsewhere"]);
  });
});
