import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  type ThreadProjectMoveSubject,
  threadProjectMoveTargets,
  threadProjectMoveUnavailableReason,
} from "./threadProjectMove.logic";

const here = EnvironmentId.make("env-here");
const there = EnvironmentId.make("env-there");
const home = ProjectId.make("project-home");

const idle: ThreadProjectMoveSubject = {
  environmentId: here,
  projectId: home,
  worktreePath: null,
  lineage: {
    parentThreadId: null,
    relationshipToParent: null,
    rootThreadId: ThreadId.make("thread"),
  },
  source: { status: "completed", activityRunStatus: null, pendingRuntimeRequest: null },
};

const project = (
  environmentId: EnvironmentId,
  id: string,
  title: string,
  isScratch?: true,
): EnvironmentProject =>
  ({
    environmentId,
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/work/${id}`,
    ...(isScratch ? { isScratch } : {}),
  }) as EnvironmentProject;

describe("threadProjectMoveTargets", () => {
  it("lists the other projects on the thread's computer by name, Scratch last", () => {
    const targets = threadProjectMoveTargets(
      [
        project(here, "scratch", "Scratch", true),
        project(here, "zeta", "Zeta"),
        project(there, "remote", "Alpha"),
        project(here, "project-home", "Home"),
        project(here, "beta", "Beta"),
      ],
      idle,
    );
    expect(targets.map((target) => [target.id, target.label])).toEqual([
      ["beta", "Beta"],
      ["zeta", "Zeta"],
      ["scratch", "No project"],
    ]);
  });
});

describe("threadProjectMoveUnavailableReason", () => {
  const targets = threadProjectMoveTargets([project(here, "beta", "Beta")], idle);

  const busy = "Available when the thread is idle";
  const cases: ReadonlyArray<readonly [string, ThreadProjectMoveSubject, string | null]> = [
    ["an idle thread", idle, null],
    [
      "a subagent",
      { ...idle, lineage: { ...idle.lineage, relationshipToParent: "subagent" } },
      "Subagents stay with their parent",
    ],
    [
      "a worktree thread",
      { ...idle, worktreePath: "/work/wt" },
      "Threads in a worktree cannot move",
    ],
    ...(["queued", "preparing", "starting", "running", "waiting"] as const).map(
      (status) =>
        [`a ${status} run`, { ...idle, source: { ...idle.source, status } }, busy] as const,
    ),
    [
      "background activity",
      { ...idle, source: { ...idle.source, activityRunStatus: "running" } },
      busy,
    ],
    [
      "an open request",
      {
        ...idle,
        source: {
          ...idle.source,
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("request"),
            kind: "user_input",
            createdAt: DateTime.makeUnsafe("2026-11-04T00:00:00.000Z"),
            blocking: false,
          },
        },
      },
      busy,
    ],
  ];

  it.each(cases)("%s", (_name, thread, reason) => {
    expect(threadProjectMoveUnavailableReason(thread, targets)).toBe(reason);
  });

  it("is unavailable with no other project on the computer", () => {
    expect(threadProjectMoveUnavailableReason(idle, [])).toBe("No other project on this computer");
  });
});
