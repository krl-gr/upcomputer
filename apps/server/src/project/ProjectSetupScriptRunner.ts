import { ProjectId } from "@upcomputer/contracts";
import { projectScriptRuntimeEnv, setupProjectScript } from "@upcomputer/shared/projectScripts";
import { HostProcessEnvironment, HostProcessPlatform } from "@upcomputer/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../processRunner.ts";

export interface ProjectSetupScriptRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectSetupScriptRunnerResultStarted {
  readonly status: "started";
  readonly scriptId: string;
  readonly scriptName: string;
  readonly cwd: string;
  /** Resolves when the background script exits successfully; fails otherwise. */
  readonly completion: Effect.Effect<void, ProjectSetupScriptOperationError>;
}

export type ProjectSetupScriptRunnerResult =
  | ProjectSetupScriptRunnerResultNoScript
  | ProjectSetupScriptRunnerResultStarted;

export interface ProjectSetupScriptRunnerInput {
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath: string;
}

export class ProjectSetupScriptOperationError extends Schema.TaggedErrorClass<ProjectSetupScriptOperationError>()(
  "ProjectSetupScriptOperationError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
    operation: Schema.Literals(["resolveProject", "runScript"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project setup script operation '${this.operation}' failed for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectSetupScriptProjectNotFoundError extends Schema.TaggedErrorClass<ProjectSetupScriptProjectNotFoundError>()(
  "ProjectSetupScriptProjectNotFoundError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project was not found for setup script execution for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export const ProjectSetupScriptRunnerError = Schema.Union([
  ProjectSetupScriptOperationError,
  ProjectSetupScriptProjectNotFoundError,
]);
export type ProjectSetupScriptRunnerError = typeof ProjectSetupScriptRunnerError.Type;

// Setup scripts typically install dependencies, so allow far more than the
// ProcessRunner default before giving up.
const SETUP_SCRIPT_TIMEOUT = "30 minutes";
const SETUP_SCRIPT_MAX_OUTPUT_BYTES = 64 * 1024;

export class ProjectSetupScriptRunner extends Context.Service<
  ProjectSetupScriptRunner,
  {
    readonly runForThread: (
      input: ProjectSetupScriptRunnerInput,
    ) => Effect.Effect<ProjectSetupScriptRunnerResult, ProjectSetupScriptRunnerError>;
  }
>()("@upcomputer/server/project/ProjectSetupScriptRunner") {}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const runForThread: ProjectSetupScriptRunner["Service"]["runForThread"] = Effect.fn(
    "ProjectSetupScriptRunner.runForThread",
  )(function* (input) {
    const errorContext = {
      threadId: input.threadId,
      worktreePath: input.worktreePath,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
    };
    const projectById = input.projectId
      ? yield* projectionSnapshotQuery.getProjectShellById(ProjectId.make(input.projectId)).pipe(
          Effect.map(Option.getOrUndefined),
          Effect.mapError(
            (cause) =>
              new ProjectSetupScriptOperationError({
                ...errorContext,
                operation: "resolveProject",
                cause,
              }),
          ),
        )
      : null;
    const project =
      projectById ??
      (input.projectCwd
        ? yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(input.projectCwd).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.mapError(
              (cause) =>
                new ProjectSetupScriptOperationError({
                  ...errorContext,
                  operation: "resolveProject",
                  cause,
                }),
            ),
          )
        : null);

    if (!project) {
      return yield* new ProjectSetupScriptProjectNotFoundError(errorContext);
    }

    const script = setupProjectScript(project.scripts);
    if (!script) {
      return {
        status: "no-script",
      } as const;
    }

    const cwd = input.worktreePath;
    const env = projectScriptRuntimeEnv({
      project: { cwd: project.workspaceRoot },
      worktreePath: input.worktreePath,
    });
    const hostEnv = yield* HostProcessEnvironment;
    const shell =
      (yield* HostProcessPlatform) === "win32"
        ? { command: hostEnv.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", script.command] }
        : { command: hostEnv.SHELL ?? "/bin/sh", args: ["-lc", script.command] };

    const fiber = yield* processRunner
      .run({
        ...shell,
        cwd,
        env,
        timeout: SETUP_SCRIPT_TIMEOUT,
        maxOutputBytes: SETUP_SCRIPT_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSetupScriptOperationError({
              ...errorContext,
              operation: "runScript",
              cause,
            }),
        ),
        Effect.flatMap((result) =>
          Effect.logInfo("project setup script exited", {
            threadId: input.threadId,
            scriptId: script.id,
            cwd,
            exitCode: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
          }).pipe(
            Effect.andThen(
              result.code === 0
                ? Effect.void
                : Effect.fail(
                    new ProjectSetupScriptOperationError({
                      ...errorContext,
                      operation: "runScript",
                      cause: new Error(
                        `Setup script '${script.name}' exited with code ${String(result.code)}.`,
                      ),
                    }),
                  ),
            ),
          ),
        ),
        Effect.forkDetach,
      );

    return {
      status: "started",
      scriptId: script.id,
      scriptName: script.name,
      cwd,
      completion: Fiber.join(fiber),
    } as const;
  });

  return ProjectSetupScriptRunner.of({ runForThread });
});

export const layer = Layer.effect(ProjectSetupScriptRunner, make);
