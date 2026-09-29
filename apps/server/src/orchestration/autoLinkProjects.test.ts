// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  ThreadId,
} from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type AutoLinkProject,
  type AutoLinkThread,
  extractWrittenPaths,
  isAutoLinkOpen,
  matchProjectForPath,
  resolveAutoLinkProjectIds,
} from "./autoLinkProjects.ts";

const home = ProjectId.make("home");
const other = ProjectId.make("other");
const nested = ProjectId.make("nested");
const scratch = ProjectId.make("scratch");
const gone = ProjectId.make("gone");

const projects: ReadonlyArray<AutoLinkProject> = [
  { id: home, workspaceRoot: "/code/home" },
  { id: other, workspaceRoot: "/code/other" },
  { id: nested, workspaceRoot: "/code/other/packages/nested" },
  { id: scratch, workspaceRoot: "/data/scratch" },
  { id: gone, workspaceRoot: "/code/gone", deletedAt: "2026-01-01T00:00:00.000Z" },
];
const scratchRoot = "/data/scratch";
const thread: AutoLinkThread = { projectId: home, worktreePath: null };

const match = (path: string, overrides?: Partial<AutoLinkThread>) =>
  matchProjectForPath({ path, thread: { ...thread, ...overrides }, projects, scratchRoot });

describe("matchProjectForPath", () => {
  it("links the project whose root contains the written path", () => {
    expect(match("/code/other/src/index.ts")).toBe(other);
    expect(match("/code/other")).toBe(other);
  });

  it("prefers the longest containing root", () => {
    expect(match("/code/other/packages/nested/src/a.ts")).toBe(nested);
    expect(match("/code/other/packages/nested-sibling/a.ts")).toBe(other);
  });

  it("respects path segment boundaries", () => {
    expect(match("/code/otherthing/a.ts")).toBeUndefined();
    expect(match("/elsewhere/a.ts")).toBeUndefined();
  });

  it("ignores the thread's own project", () => {
    expect(match("/code/home/src/a.ts")).toBeUndefined();
  });

  it("ignores projects the thread or its project already links", () => {
    expect(match("/code/other/a.ts", { linkedProjectIds: [other] })).toBeUndefined();
    // An already-linked nested project still owns its files.
    expect(match("/code/other/packages/nested/a.ts", { linkedProjectIds: [nested] })).toBe(
      undefined,
    );
    expect(
      matchProjectForPath({
        path: "/code/other/a.ts",
        thread,
        projects: projects.map((project) =>
          project.id === home ? { ...project, linkedProjectIds: [other] } : project,
        ),
        scratchRoot,
      }),
    ).toBeUndefined();
  });

  it("skips projects nested inside an already linked project", () => {
    expect(
      match("/code/other/packages/nested/a.ts", {
        projectId: scratch,
        worktreePath: "/data/scratch/thread-1",
        linkedProjectIds: [other],
      }),
    ).toBeUndefined();
  });

  it("ignores the scratch project", () => {
    expect(match("/data/scratch/thread-2/a.ts")).toBeUndefined();
  });

  it("links out of a scratch thread's folder", () => {
    expect(
      match("/code/other/a.ts", { projectId: scratch, worktreePath: "/data/scratch/thread-1" }),
    ).toBe(other);
  });

  it("ignores deleted projects", () => {
    expect(match("/code/gone/a.ts")).toBeUndefined();
  });

  it("ignores writes inside the thread's own cwd, even into nested projects", () => {
    const outerThread = { projectId: other, worktreePath: null };
    expect(match("/code/other/packages/nested/a.ts", outerThread)).toBeUndefined();
    expect(match("/work/tree/a.ts", { worktreePath: "/work/tree" })).toBeUndefined();
  });

  it("still treats the home root as own tree when running in a worktree", () => {
    expect(
      match("/code/other/packages/nested/a.ts", {
        projectId: other,
        worktreePath: "/worktrees/other-1",
      }),
    ).toBeUndefined();
    expect(match("/code/home/a.ts", { worktreePath: "/worktrees/home-1" })).toBeUndefined();
  });
});

describe("isAutoLinkOpen", () => {
  const scratchThread: AutoLinkThread = {
    projectId: scratch,
    worktreePath: "/data/scratch/thread-1",
  };
  const open = (
    overrides: Partial<AutoLinkThread>,
    turns: { turnId?: string; autoLinkTurnId?: string; projectLinksPinned?: boolean } = {},
  ) =>
    isAutoLinkOpen({
      thread: { ...scratchThread, ...overrides },
      projects,
      scratchRoot,
      projectLinksPinned: turns.projectLinksPinned ?? false,
      turnId: turns.turnId,
      autoLinkTurnId: turns.autoLinkTurnId,
    });

  it("opens for a scratch thread without links", () => {
    expect(open({})).toBe(true);
  });

  it("never opens for a thread created in a project", () => {
    expect(open({ projectId: home, worktreePath: null })).toBe(false);
  });

  it("stays open only for the rest of the turn that made the first links", () => {
    expect(
      open({ linkedProjectIds: [other] }, { turnId: "turn-1", autoLinkTurnId: "turn-1" }),
    ).toBe(true);
    expect(
      open({ linkedProjectIds: [other] }, { turnId: "turn-2", autoLinkTurnId: "turn-1" }),
    ).toBe(false);
    expect(open({ linkedProjectIds: [other] }, { turnId: "turn-1" })).toBe(false);
  });

  it("stays closed once the user removed a link, even with none left", () => {
    expect(open({}, { projectLinksPinned: true })).toBe(false);
    expect(
      open(
        { linkedProjectIds: [other] },
        { turnId: "turn-1", autoLinkTurnId: "turn-1", projectLinksPinned: true },
      ),
    ).toBe(false);
  });

  it("stays closed without a scratch root", () => {
    expect(
      isAutoLinkOpen({
        thread: scratchThread,
        projects,
        scratchRoot: undefined,
        projectLinksPinned: false,
        turnId: undefined,
        autoLinkTurnId: undefined,
      }),
    ).toBe(false);
  });
});

describe("resolveAutoLinkProjectIds", () => {
  const resolve = (writtenPaths: ReadonlyArray<string>, overrides?: Partial<AutoLinkThread>) =>
    resolveAutoLinkProjectIds({
      writtenPaths,
      thread: { ...thread, ...overrides },
      projects,
      scratchRoot,
      path: NodePath.posix,
    });

  it("resolves relative paths against the thread cwd", () => {
    expect(resolve(["src/a.ts"])).toEqual([]);
    expect(resolve(["../other/src/a.ts"])).toEqual([other]);
    expect(resolve(["../../code/other/a.ts"], { worktreePath: "/work/tree" })).toEqual([other]);
  });

  it("normalizes absolute paths before matching", () => {
    expect(resolve(["/code/home/../other/a.ts"])).toEqual([other]);
  });

  it("dedupes and keeps one entry per project", () => {
    expect(
      resolve(["/code/other/a.ts", "/code/other/b.ts", "/code/other/packages/nested/c.ts"]),
    ).toEqual([other, nested]);
  });

  it("drops relative paths without a cwd", () => {
    expect(
      resolveAutoLinkProjectIds({
        writtenPaths: ["../other/a.ts", "/code/other/a.ts"],
        thread: { projectId: ProjectId.make("missing"), worktreePath: null },
        projects,
        scratchRoot,
        path: NodePath.posix,
      }),
    ).toEqual([other]);
  });
});

const itemCompleted = (
  payload: Extract<ProviderRuntimeEvent, { type: "item.completed" }>["payload"],
  type: "item.completed" | "item.started" = "item.completed",
): ProviderRuntimeEvent =>
  ({
    type,
    eventId: EventId.make("evt-1"),
    provider: ProviderDriverKind.make("claudeAgent"),
    createdAt: "2026-01-01T00:00:00.000Z",
    threadId: ThreadId.make("thread-1"),
    itemId: RuntimeItemId.make("item-1"),
    payload,
  }) as ProviderRuntimeEvent;

describe("extractWrittenPaths", () => {
  it("reads Claude write tools", () => {
    for (const toolName of ["Edit", "Write", "MultiEdit"]) {
      expect(
        extractWrittenPaths(
          itemCompleted({
            itemType: "file_change",
            status: "completed",
            data: { toolName, input: { file_path: "/code/other/a.ts" }, result: {} },
          }),
        ),
      ).toEqual(["/code/other/a.ts"]);
    }
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: { toolName: "NotebookEdit", input: { notebook_path: "/code/other/n.ipynb" } },
        }),
      ),
    ).toEqual(["/code/other/n.ipynb"]);
  });

  it("ignores Claude reads, failures, and non-completed lifecycle events", () => {
    const edit = { toolName: "Edit", input: { file_path: "/code/other/a.ts" } };
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: { toolName: "mcp__fs__read_file", input: { path: "/code/other/a.ts" } },
        }),
      ),
    ).toEqual([]);
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "dynamic_tool_call",
          status: "completed",
          data: { toolName: "Read", input: { file_path: "/code/other/a.ts" } },
        }),
      ),
    ).toEqual([]);
    expect(
      extractWrittenPaths(itemCompleted({ itemType: "file_change", status: "failed", data: edit })),
    ).toEqual([]);
    expect(
      extractWrittenPaths(
        itemCompleted(
          { itemType: "file_change", status: "inProgress", data: edit },
          "item.started",
        ),
      ),
    ).toEqual([]);
  });

  it("reads Codex fileChange items, including move targets", () => {
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: {
            threadId: "codex-thread",
            turnId: "codex-turn",
            item: {
              type: "fileChange",
              id: "fc-1",
              status: "completed",
              changes: [
                { path: "/code/other/a.ts", kind: { type: "add" }, diff: "" },
                {
                  path: "/code/other/b.ts",
                  kind: { type: "update", move_path: "/code/nested/c.ts" },
                  diff: "",
                },
              ],
            },
          },
        }),
      ),
    ).toEqual(["/code/other/a.ts", "/code/other/b.ts", "/code/nested/c.ts"]);
  });

  it("ignores declined Codex changes", () => {
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "declined",
          data: {
            item: {
              type: "fileChange",
              changes: [{ path: "/code/other/a.ts", kind: { type: "add" }, diff: "" }],
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("reads OpenCode edit and patch tools", () => {
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: { tool: "edit", state: {}, input: { filePath: "/code/other/a.ts" } },
        }),
      ),
    ).toEqual(["/code/other/a.ts"]);
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: {
            tool: "apply_patch",
            state: {},
            input: {
              patchText: [
                "*** Begin Patch",
                "*** Update File: /code/other/a.ts",
                "*** Move to: /code/other/b.ts",
                "@@",
                "*** Add File: src/new.ts",
                "*** End Patch",
              ].join("\n"),
            },
          },
        }),
      ),
    ).toEqual(["/code/other/a.ts", "/code/other/b.ts", "src/new.ts"]);
  });

  it("reads ACP edit tool calls from locations, diffs, and raw input", () => {
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "file_change",
          status: "completed",
          data: {
            toolCallId: "call-1",
            kind: "edit",
            locations: [{ path: "/code/other/a.ts", line: 3 }],
            content: [
              { type: "diff", path: "/code/other/b.ts", oldText: "a", newText: "b" },
              { type: "content", content: { type: "text", text: "/code/other/c.ts" } },
            ],
            rawInput: { file_path: "/code/other/d.ts" },
          },
        }),
      ),
    ).toEqual(["/code/other/a.ts", "/code/other/b.ts", "/code/other/d.ts"]);
    expect(
      extractWrittenPaths(
        itemCompleted({
          itemType: "dynamic_tool_call",
          status: "completed",
          data: { toolCallId: "call-2", kind: "read", locations: [{ path: "/code/other/a.ts" }] },
        }),
      ),
    ).toEqual([]);
  });
});
