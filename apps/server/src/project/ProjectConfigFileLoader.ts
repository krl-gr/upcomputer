/**
 * ProjectConfigFileLoader - Effect service that loads the checked-in `upcomputer.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module ProjectConfigFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PROJECT_CONFIG_FILE_NAME, type ProjectConfigFile } from "@upcomputer/contracts";
import { LEGACY_PROJECT_CONFIG_FILE_NAME } from "@upcomputer/shared/legacyProjectConfig";
import { ProjectConfigFileFromJson } from "@upcomputer/shared/projectConfigFile";

const decodeProjectConfigFileJson = Schema.decodeEffect(ProjectConfigFileFromJson);

export class ProjectConfigFileLoadError extends Schema.TaggedErrorClass<ProjectConfigFileLoadError>()(
  "ProjectConfigFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${PROJECT_CONFIG_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for project config project file loading. */
export class ProjectConfigFileLoader extends Context.Service<
  ProjectConfigFileLoader,
  {
    /**
     * Load and decode `upcomputer.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<ProjectConfigFile>>;
  }
>()("@upcomputer/server/project/ProjectConfigFileLoader") {}

const logProjectConfigFileLoadError = (error: ProjectConfigFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: ProjectConfigFileLoader["Service"]["load"] = Effect.fn(
    "ProjectConfigFileLoader.load",
  )(function* (workspaceRoot) {
    let filePath = path.join(workspaceRoot, PROJECT_CONFIG_FILE_NAME);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (error) => {
          if (error.reason._tag !== "NotFound") return Effect.fail(error);
          filePath = path.join(workspaceRoot, LEGACY_PROJECT_CONFIG_FILE_NAME);
          return fileSystem.readFileString(filePath);
        },
      }),
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logProjectConfigFileLoadError(
                new ProjectConfigFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<ProjectConfigFile>();
    }
    return yield* decodeProjectConfigFileJson(raw.value).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        SchemaError: (error) =>
          logProjectConfigFileLoadError(
            new ProjectConfigFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<ProjectConfigFile>())),
      }),
    );
  });

  return ProjectConfigFileLoader.of({ load });
});

export const layer = Layer.effect(ProjectConfigFileLoader, make);
