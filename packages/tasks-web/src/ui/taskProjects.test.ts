import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "../../../../apps/web/src/sidebarProjectGrouping.ts";
import type { Project } from "../../../../apps/web/src/types.ts";
import { pickerProjectFor, pickerProjects, taskProjectsOf } from "./taskProjects.ts";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

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
    environmentId: LOCAL,
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
const cssynthesizer = repository("krl-gr", "CSSynthesizer");
const PROJECTS = [
  project("upcomputer", "upcomputer", "/p/upcomputer", { repositoryIdentity: upcomputer }),
  project("server", "server", "/p/worktrees/human-tasks/apps/server", {
    repositoryIdentity: upcomputer,
  }),
  project("CSSynthesizer", "CSSynthesizer", "/p/CSSynthesizer", {
    repositoryIdentity: cssynthesizer,
  }),
  project("cssynthesizer", "cssynthesizer", "/p/cssynthesizer", {
    repositoryIdentity: cssynthesizer,
  }),
  project("english", "English", "/home/.upcomputer/projects/english"),
  project("remote-upcomputer", "upcomputer", "/srv/upcomputer", {
    environmentId: REMOTE,
    repositoryIdentity: upcomputer,
  }),
];

const taskProjects = () =>
  taskProjectsOf(
    buildSidebarProjectSnapshots({
      projects: PROJECTS,
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: LOCAL,
      resolveEnvironmentLabel: () => null,
    }),
  );

describe("taskProjectsOf", () => {
  it("names every member by its sidebar group, and offers one entry per group and environment", () => {
    const projects = taskProjects();
    expect(projects.map(({ id, name }) => [id, name])).toEqual([
      ["upcomputer", "krl-gr/upcomputer"],
      ["server", "krl-gr/upcomputer"],
      ["remote-upcomputer", "krl-gr/upcomputer"],
      ["CSSynthesizer", "krl-gr/CSSynthesizer"],
      ["cssynthesizer", "krl-gr/CSSynthesizer"],
      ["english", "English"],
    ]);
    // A picker lists the member the sidebar's picker opens, once per environment.
    expect(pickerProjects(projects).map(({ id }) => id)).toEqual([
      "upcomputer",
      "remote-upcomputer",
      "CSSynthesizer",
      "english",
    ]);
  });

  it("shows a task in any member as its group's entry", () => {
    const projects = taskProjects();
    const options = pickerProjects(projects);
    const server = projects.find(({ id }) => id === "server")!;
    expect(pickerProjectFor(options, server)?.id).toBe("upcomputer");
    expect(server.favicon.workspaceRoot).toBe("/p/upcomputer");
    // A picker whose list lost the group's own entry still offers the group once.
    expect(
      pickerProjects(projects.filter(({ id }) => id !== "upcomputer")).map(({ id }) => id),
    ).toEqual(["server", "remote-upcomputer", "CSSynthesizer", "english"]);
  });
});
