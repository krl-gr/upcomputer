import { describe, expect, it } from "vite-plus/test";
import { ProjectId } from "@upcomputer/contracts";

import {
  collectLinkedProjectIds,
  resolveLinkedProjectDirectories,
} from "./linkedProjectDirectories.ts";

const home = ProjectId.make("project-home");
const docs = ProjectId.make("project-docs");
const api = ProjectId.make("project-api");
const shared = ProjectId.make("project-shared");
const deleted = ProjectId.make("project-deleted");
const unknown = ProjectId.make("project-unknown");

const projects = [
  { id: home, workspaceRoot: "/repo/home", deletedAt: null },
  { id: docs, workspaceRoot: "/repo/docs", deletedAt: null },
  { id: api, workspaceRoot: "/repo/api" },
  { id: shared, workspaceRoot: "/repo/docs/", deletedAt: null },
  { id: deleted, workspaceRoot: "/repo/deleted", deletedAt: "2026-01-01T00:00:00.000Z" },
];

describe("collectLinkedProjectIds", () => {
  it("lists thread links before project tags without duplicates or the own project", () => {
    expect(
      collectLinkedProjectIds({
        thread: { projectId: home, linkedProjectIds: [api, home, docs] },
        threadProject: { linkedProjectIds: [docs, shared] },
      }),
    ).toEqual([api, docs, shared]);
  });

  it("treats absent links as empty", () => {
    expect(
      collectLinkedProjectIds({ thread: { projectId: home }, threadProject: undefined }),
    ).toEqual([]);
  });
});

describe("resolveLinkedProjectDirectories", () => {
  it("resolves workspace roots in stable order, skipping deleted, unknown, and duplicate paths", () => {
    expect(
      resolveLinkedProjectDirectories({
        thread: { projectId: home, linkedProjectIds: [docs, deleted, unknown] },
        threadProject: { linkedProjectIds: [api, shared] },
        projects,
        cwd: "/repo/home",
      }),
    ).toEqual(["/repo/docs", "/repo/api"]);
  });

  it("excludes a linked project whose root is the session cwd", () => {
    expect(
      resolveLinkedProjectDirectories({
        thread: { projectId: home, linkedProjectIds: [docs, api] },
        threadProject: undefined,
        projects,
        cwd: "/repo/api/",
      }),
    ).toEqual(["/repo/docs"]);
  });

  it("returns nothing when the thread has no links", () => {
    expect(
      resolveLinkedProjectDirectories({
        thread: { projectId: home },
        threadProject: { linkedProjectIds: [] },
        projects,
        cwd: undefined,
      }),
    ).toEqual([]);
  });
});
