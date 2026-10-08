import { applyUpcomputerEnvAliases } from "@t3tools/shared/upcomputerEnv";
import { resolveUpcomputerLocalBuildIdentity } from "@t3tools/shared/upcomputerIdentity";

/**
 * Applies the Up.computer process environment before anything reads it.
 * `main.ts` imports `UpcomputerStartupEnvironmentEffect.ts` first so this runs
 * ahead of every other module, including Finder launches with no shell env.
 */
export function applyUpcomputerStartupEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly appVersion: string;
  readonly homeDirectory: string;
  readonly joinPath: (first: string, ...segments: string[]) => string;
}): void {
  const { env } = input;
  applyUpcomputerEnvAliases(env);
  // A local test or demo build never shares the Alpha app's state, port or updater.
  const localBuild = resolveUpcomputerLocalBuildIdentity(input.appVersion);
  if (localBuild) {
    env.T3CODE_HOME = input.joinPath(input.homeDirectory, localBuild.homeDirectoryName);
    env.T3CODE_DISABLE_AUTO_UPDATE = "true";
    delete env.VITE_DEV_SERVER_URL;
    delete env.T3CODE_PORT;
  }
}
