import { PROJECT_CONFIG_FILE_NAME } from "@upcomputer/contracts";
import { LEGACY_PROJECT_CONFIG_FILE_NAME } from "@upcomputer/shared/legacyProjectConfig";
import { ProjectConfigFileFromJson } from "@upcomputer/shared/projectConfigFile";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const decodeProjectConfig = Schema.decodeEffect(ProjectConfigFileFromJson);

export class ProjectConfigMigrationError extends Schema.TaggedErrorClass<ProjectConfigMigrationError>()(
  "ProjectConfigMigrationError",
  { message: Schema.String },
) {}

/** Explicit consent is required: this changes a checked-in project, not app-owned state.
 * The original is retained as the rollback copy. Publication is atomic and exclusive;
 * interrupted preparation cannot leave a partial preferred file or overwrite a race winner.
 */
export const migrateProjectConfig = Effect.fn("migrateProjectConfig")(function* (
  workspaceRoot: string,
  confirm: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const canonicalRoot = yield* fs.realPath(workspaceRoot);
  const legacy = path.join(canonicalRoot, LEGACY_PROJECT_CONFIG_FILE_NAME);
  const current = path.join(canonicalRoot, PROJECT_CONFIG_FILE_NAME);
  const readOptional = (file: string) =>
    fs.realPath(file).pipe(
      Effect.flatMap(
        Effect.fn(function* (resolved) {
          if (resolved !== file)
            return yield* new ProjectConfigMigrationError({
              message: "Project config symlinks require manual migration; no file was copied.",
            });
          return yield* fs.readFileString(resolved);
        }),
      ),
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(error),
      }),
    );
  const old = yield* readOptional(legacy);
  const next = yield* readOptional(current);
  if (Option.isSome(next)) {
    if (Option.isSome(old) && old.value !== next.value) {
      return yield* new ProjectConfigMigrationError({
        message:
          "Both project config files exist and differ. Resolve the conflict manually; neither file was changed.",
      });
    }
    return "already-current" as const;
  }
  if (Option.isNone(old)) return "not-needed" as const;
  yield* decodeProjectConfig(old.value).pipe(
    Effect.mapError(
      () =>
        new ProjectConfigMigrationError({
          message:
            "The legacy project config is invalid. Fix it before migrating; no files were changed.",
        }),
    ),
  );
  if (!confirm) return "confirmation-required" as const;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fs.makeTempFileScoped({
        directory: workspaceRoot,
        prefix: ".upcomputer-config-migration-",
      });
      const file = yield* fs.open(staging, { flag: "w", mode: 0o600 });
      yield* file.writeAll(new TextEncoder().encode(old.value));
      yield* file.sync;
      if ((yield* fs.readFileString(legacy)) !== old.value) {
        return yield* new ProjectConfigMigrationError({
          message: "The legacy config changed during migration. Retry after saving your edits.",
        });
      }
      // Hard-link publication cannot replace an existing file, unlike rename().
      yield* fs.link(staging, current);
      return "migrated" as const;
    }),
  );
});
