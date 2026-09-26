import { describe, expect, it, vi } from "@effect/vitest";
import { type OrchestrationProject, ProjectId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

const isProjectSetupScriptOperationError = Schema.is(
  ProjectSetupScriptRunner.ProjectSetupScriptOperationError,
);

const makeProject = (scripts: OrchestrationProject["scripts"]): OrchestrationProject => ({
  id: ProjectId.make("project-1"),
  title: "Project",
  workspaceRoot: "/repo/project",
  defaultModelSelection: null,
  scripts,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const makeProjectionSnapshotQueryLayer = (project: OrchestrationProject) =>
  Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
    getEventReplayStats: () => Effect.succeed({ eventCount: 0, payloadBytes: 0 }),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
      Effect.succeed(
        workspaceRoot === project.workspaceRoot ? Option.some(project) : Option.none(),
      ),
    getProjectShellById: (projectId) =>
      Effect.succeed(projectId === project.id ? Option.some(project) : Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadRuntimeContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
  });

const setupProject = makeProject([
  {
    id: "setup",
    name: "Setup",
    command: "bun install",
    icon: "configure",
    runOnWorktreeCreate: true,
  },
]);

const testLayer = (
  project: OrchestrationProject,
  run: ProcessRunner.ProcessRunner["Service"]["run"],
) =>
  ProjectSetupScriptRunner.layer.pipe(
    Layer.provideMerge(makeProjectionSnapshotQueryLayer(project)),
    Layer.provideMerge(Layer.succeed(ProcessRunner.ProcessRunner, { run })),
  );

const processOutput = (code: number): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr: "",
  code: code as ProcessRunner.ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
});

describe("ProjectSetupScriptRunner", () => {
  it.effect("returns no-script when no setup script exists", () => {
    const run = vi.fn(() => Effect.die("unexpected run"));

    return Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const result = yield* runner.runForThread({
        threadId: "thread-1",
        projectId: "project-1",
        worktreePath: "/repo/worktrees/a",
      });

      expect(result).toEqual({ status: "no-script" });
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer(makeProject([]), run)));
  });

  it.effect("runs the setup command through the shell in the worktree with script env", () => {
    const run = vi.fn((_input: ProcessRunner.ProcessRunInput) => Effect.succeed(processOutput(0)));

    return Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const result = yield* runner.runForThread({
        threadId: "thread-1",
        projectCwd: "/repo/project",
        worktreePath: "/repo/worktrees/a",
      });
      if (result.status !== "started") {
        return expect.fail("expected the setup script to start");
      }
      expect(result).toMatchObject({
        scriptId: "setup",
        scriptName: "Setup",
        cwd: "/repo/worktrees/a",
      });
      yield* result.completion;

      const input = run.mock.calls[0]?.[0];
      expect(input?.cwd).toBe("/repo/worktrees/a");
      expect(input?.env).toEqual({
        UPCOMPUTER_PROJECT_ROOT: "/repo/project",
        UPCOMPUTER_WORKTREE_PATH: "/repo/worktrees/a",
      });
      expect(input?.args.at(-1)).toBe("bun install");
    }).pipe(Effect.provide(testLayer(setupProject, run)));
  });

  it.effect("fails completion with a runScript error on non-zero exit or spawn failure", () => {
    const spawnError = new ProcessRunner.ProcessSpawnError({
      command: "/bin/sh",
      argumentCount: 2,
      cause: new Error("ENOENT"),
    });
    const outcomes = [Effect.succeed(processOutput(1)), Effect.fail(spawnError)];
    const run = vi.fn(() => outcomes.shift() ?? Effect.die("unexpected run"));

    return Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      for (const expectedCause of [undefined, spawnError]) {
        const result = yield* runner.runForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath: "/repo/worktrees/a",
        });
        if (result.status !== "started") {
          return expect.fail("expected the setup script to start");
        }
        const error = yield* Effect.flip(result.completion);
        expect(isProjectSetupScriptOperationError(error)).toBe(true);
        expect(error.operation).toBe("runScript");
        expect(error.worktreePath).toBe("/repo/worktrees/a");
        if (expectedCause) {
          expect(error.cause).toBe(expectedCause);
        } else {
          expect(String(error.cause)).toContain("exited with code 1");
        }
      }
    }).pipe(Effect.provide(testLayer(setupProject, run)));
  });
});
