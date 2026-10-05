import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import {
  isUpcomputerLocalTestVersion,
  UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME,
  UPCOMPUTER_LOCAL_TEST_APP_NAME,
  UPCOMPUTER_USER_DATA_DIR_NAME,
} from "@t3tools/shared/upcomputerIdentity";

export class DesktopUserDataInitializationError extends Schema.TaggedError<DesktopUserDataInitializationError>()(
  "DesktopUserDataInitializationError",
  {
    operation: Schema.Literals(["inspect", "read", "create-directory", "write"]),
    resourcePath: Schema.String,
    category: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not initialize Electron user data during ${this.operation} at ${this.resourcePath} (${this.category}).`;
  }

  static fromFileSystem(
    cause: PlatformError.PlatformError,
    operation: DesktopUserDataInitializationError["operation"],
    resourcePath: string,
  ) {
    return new DesktopUserDataInitializationError({
      operation,
      resourcePath,
      category: cause.reason._tag,
      cause,
    });
  }
}

/** Select Electron's profile independently of the server's home directory. */
export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: {
    readonly appDataDirectory: string;
    readonly appVersion: string;
    readonly isDevelopment: boolean;
    readonly platform: NodeJS.Platform;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Up.computer keeps the V1 profile folders, so an auto-updated V1 install
    // keeps its Chromium state (sign-ins, safeStorage keys, browser profiles).
    const names = isUpcomputerLocalTestVersion(input.appVersion)
      ? { current: UPCOMPUTER_LOCAL_TEST_APP_NAME, legacy: UPCOMPUTER_LOCAL_TEST_APP_NAME }
      : input.isDevelopment
        ? {
            current: UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME,
            legacy: UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME,
          }
        : { current: UPCOMPUTER_USER_DATA_DIR_NAME, legacy: UPCOMPUTER_USER_DATA_DIR_NAME };
    const destinationPath = path.join(input.appDataDirectory, names.current);
    const legacyPath = path.join(input.appDataDirectory, names.legacy);
    const inspect = (resourcePath: string) =>
      fs
        .exists(resourcePath)
        .pipe(
          Effect.mapError((cause) =>
            DesktopUserDataInitializationError.fromFileSystem(cause, "inspect", resourcePath),
          ),
        );
    if (input.isDevelopment) {
      return (yield* inspect(legacyPath)) ? legacyPath : destinationPath;
    }
    // Chromium databases require their own profile for each running version.
    if (input.platform !== "win32") return destinationPath;
    const destinationState = path.join(destinationPath, "Local State");
    if (yield* inspect(destinationState)) return destinationPath;
    const legacyState = path.join(legacyPath, "Local State");
    const sourceState = (yield* inspect(legacyState))
      ? legacyState
      : path.join(input.appDataDirectory, UPCOMPUTER_USER_DATA_DIR_NAME, "Local State");
    if (!(yield* inspect(sourceState))) return destinationPath;
    // Windows safeStorage keys live here. Copy only these preferences, never locked databases.
    const state = yield* fs
      .readFileString(sourceState)
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(cause, "read", sourceState),
        ),
      );
    yield* fs
      .makeDirectory(destinationPath, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(
            cause,
            "create-directory",
            destinationPath,
          ),
        ),
      );
    yield* fs.writeFileString(destinationState, state, { flag: "wx" }).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => Effect.void,
      ),
      Effect.mapError((cause) =>
        DesktopUserDataInitializationError.fromFileSystem(cause, "write", destinationState),
      ),
    );
    return destinationPath;
  },
);
