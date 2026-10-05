// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { type OrchestrationV2TurnItem, ProjectId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  type AutoLinkProject,
  type AutoLinkThread,
  isAutoLinkOpen,
  resolveAutoLinkProjectIds,
  writtenPathsOfTurnItem,
} from "./autoLinkProjects.ts";

const home = ProjectId.make("home");
const other = ProjectId.make("other");
const nested = ProjectId.make("nested");
const scratch = ProjectId.make("scratch");

// Active projects only: callers pass the store's active list.
const projects: ReadonlyArray<AutoLinkProject> = [
  { projectId: home, workspaceRoot: "/code/home" },
  { projectId: other, workspaceRoot: "/code/other" },
  { projectId: nested, workspaceRoot: "/code/other/packages/nested" },
  { projectId: scratch, workspaceRoot: "/data/scratch" },
];
const scratchRoot = "/data/scratch";
const thread: AutoLinkThread = { projectId: home, worktreePath: null };

const resolve = (
  writtenPaths: ReadonlyArray<string>,
  overrides?: Partial<AutoLinkThread>,
  projectList: ReadonlyArray<AutoLinkProject> = projects,
) =>
  resolveAutoLinkProjectIds({
    writtenPaths,
    thread: { ...thread, ...overrides },
    projects: projectList,
    scratchRoot,
    path: NodePath.posix,
  });

describe("resolveAutoLinkProjectIds", () => {
  it("links the project whose root contains the written path", () => {
    expect(resolve(["/code/other/src/index.ts"])).toEqual([other]);
    expect(resolve(["/code/other"])).toEqual([other]);
  });

  it("prefers the longest containing root and respects segment boundaries", () => {
    expect(resolve(["/code/other/packages/nested/src/a.ts"])).toEqual([nested]);
    expect(resolve(["/code/other/packages/nested-sibling/a.ts"])).toEqual([other]);
    expect(resolve(["/code/otherthing/a.ts", "/elsewhere/a.ts"])).toEqual([]);
  });

  it("ignores the own project and projects the thread or its project already links", () => {
    expect(resolve(["/code/home/src/a.ts"])).toEqual([]);
    expect(resolve(["/code/other/a.ts"], { linkedProjectIds: [other] })).toEqual([]);
    // An already-linked nested project still owns its files.
    expect(resolve(["/code/other/packages/nested/a.ts"], { linkedProjectIds: [nested] })).toEqual(
      [],
    );
    expect(
      resolve(
        ["/code/other/a.ts"],
        {},
        projects.map((project) =>
          project.projectId === home ? { ...project, linkedProjectIds: [other] } : project,
        ),
      ),
    ).toEqual([]);
  });

  it("skips projects nested inside an already linked project", () => {
    expect(
      resolve(["/code/other/packages/nested/a.ts"], {
        projectId: scratch,
        worktreePath: "/data/scratch/thread-1",
        linkedProjectIds: [other],
      }),
    ).toEqual([]);
  });

  it("ignores Scratch and links out of a Scratch thread's folder", () => {
    expect(resolve(["/data/scratch/thread-2/a.ts"])).toEqual([]);
    expect(
      resolve(["/code/other/a.ts"], { projectId: scratch, worktreePath: "/data/scratch/thread-1" }),
    ).toEqual([other]);
  });

  it("ignores writes inside the thread's own tree, also from a worktree", () => {
    expect(resolve(["/code/other/packages/nested/a.ts"], { projectId: other })).toEqual([]);
    expect(resolve(["/work/tree/a.ts"], { worktreePath: "/work/tree" })).toEqual([]);
    expect(resolve(["/code/home/a.ts"], { worktreePath: "/worktrees/home-1" })).toEqual([]);
  });

  it("resolves relative paths against the cwd, normalizes and dedupes", () => {
    expect(resolve(["src/a.ts"])).toEqual([]);
    expect(resolve(["../other/src/a.ts"])).toEqual([other]);
    expect(resolve(["../../code/other/a.ts"], { worktreePath: "/work/tree" })).toEqual([other]);
    expect(resolve(["/code/home/../other/a.ts"])).toEqual([other]);
    expect(
      resolve(["/code/other/a.ts", "/code/other/b.ts", "/code/other/packages/nested/c.ts"]),
    ).toEqual([other, nested]);
    expect(
      resolve(["../other/a.ts", "/code/other/a.ts"], { projectId: ProjectId.make("missing") }),
    ).toEqual([other]);
  });
});

describe("isAutoLinkOpen", () => {
  const scratchThread: AutoLinkThread = {
    projectId: scratch,
    worktreePath: "/data/scratch/thread-1",
  };
  const open = (
    overrides: Partial<AutoLinkThread>,
    runs: { readonly runId?: string; readonly autoLinkRunId?: string } = {},
    root: { readonly scratchRoot: string | undefined } = { scratchRoot },
  ) =>
    isAutoLinkOpen({
      thread: { ...scratchThread, ...overrides },
      projects,
      scratchRoot: root.scratchRoot,
      runId: runs.runId ?? null,
      autoLinkRunId: runs.autoLinkRunId,
    });

  it("opens only for a Scratch thread without links", () => {
    expect(open({})).toBe(true);
    expect(open({ projectId: home, worktreePath: null })).toBe(false);
    expect(open({}, {}, { scratchRoot: undefined })).toBe(false);
  });

  it("stays open only for the rest of the run that made the first links", () => {
    expect(open({ linkedProjectIds: [other] }, { runId: "run-1", autoLinkRunId: "run-1" })).toBe(
      true,
    );
    expect(open({ linkedProjectIds: [other] }, { runId: "run-2", autoLinkRunId: "run-1" })).toBe(
      false,
    );
    expect(open({ linkedProjectIds: [other] }, { runId: "run-1" })).toBe(false);
  });

  it("stays closed once a person removed a link, even with none left", () => {
    expect(open({ projectLinksPinned: true })).toBe(false);
  });
});

describe("writtenPathsOfTurnItem", () => {
  const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const fileChange = (
    overrides: Partial<Extract<OrchestrationV2TurnItem, { type: "file_change" }>>,
  ): OrchestrationV2TurnItem => ({
    id: TurnItemId.make("item-1"),
    threadId: ThreadId.make("thread-1"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "file_change",
    fileName: "/code/other/a.ts",
    ...overrides,
  });

  it("reads structured changes, else the file name, of completed writes only", () => {
    expect(
      writtenPathsOfTurnItem(
        fileChange({
          changes: [
            { operation: "update", path: "/code/other/a.ts" },
            { operation: "add", path: "/code/other/b.ts" },
          ],
        }),
      ),
    ).toEqual(["/code/other/a.ts", "/code/other/b.ts"]);
    expect(writtenPathsOfTurnItem(fileChange({}))).toEqual(["/code/other/a.ts"]);
    expect(writtenPathsOfTurnItem(fileChange({ status: "failed" }))).toEqual([]);
    expect(writtenPathsOfTurnItem(fileChange({ status: "running" }))).toEqual([]);
  });
});
