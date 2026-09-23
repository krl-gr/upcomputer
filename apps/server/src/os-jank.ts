import {
  assertProfileMigrationStartupAllowed,
  profileMigrationDirectory,
  resolveMigratedProfileRoot,
  ProfileMigrationError,
} from "@upcomputer/shared/profileMigration";
import { HostProcessEnvironment, HostProcessPlatform } from "@upcomputer/shared/hostProcess";
import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLoginShell,
  readPathFromLaunchctl,
  resolveWindowsEnvironment,
} from "@upcomputer/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";

function logPathHydrationWarning(message: string, error?: unknown): void {
  process.stderr.write(
    `[server] ${message} ${error instanceof Error ? error.message : (error ?? "")}\n`,
  );
}

function hydratePosixPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  let shellPath: string | undefined;
  for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
    try {
      shellPath = readPathFromLoginShell(shell);
    } catch (error) {
      logPathHydrationWarning(`Failed to read PATH from login shell ${shell}.`, error);
    }

    if (shellPath) break;
  }

  const launchctlPath = platform === "darwin" && !shellPath ? readPathFromLaunchctl() : undefined;
  const mergedPath = mergePathEntries(shellPath ?? launchctlPath, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }
}

export const fixPath = Effect.fn("fixPath")(function* (): Effect.fn.Return<
  void,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;

  if (platform === "win32") {
    const repairedEnvironment = yield* resolveWindowsEnvironment(env).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
          return {} as Partial<NodeJS.ProcessEnv>;
        }),
      ),
    );
    for (const [key, value] of Object.entries(repairedEnvironment)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return;
  }

  if (platform !== "darwin" && platform !== "linux") return;

  yield* Effect.sync(() => hydratePosixPath(env, platform)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
      }),
    ),
  );
});

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return NodeOS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(NodeOS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const migrationDirectory = profileMigrationDirectory(NodeOS.homedir());
  yield* Effect.try({
    try: () => assertProfileMigrationStartupAllowed(migrationDirectory),
    catch: () => new ProfileMigrationError("startup-check-failed"),
  });
  const { join, resolve } = yield* Path.Path;
  let selected: string;
  if (!raw || raw.trim().length === 0) {
    const fileSystem = yield* FileSystem.FileSystem;
    const preferredPath = join(NodeOS.homedir(), ".upcomputer");
    const legacyPath = join(NodeOS.homedir(), ".t3");
    selected = (yield* fileSystem.exists(preferredPath))
      ? preferredPath
      : (yield* fileSystem.exists(legacyPath))
        ? legacyPath
        : preferredPath;
  } else {
    selected = resolve(yield* expandHomePath(raw.trim()));
  }
  return yield* Effect.try({
    try: () => resolveMigratedProfileRoot(migrationDirectory, selected),
    catch: () => new ProfileMigrationError("startup-check-failed"),
  });
});
