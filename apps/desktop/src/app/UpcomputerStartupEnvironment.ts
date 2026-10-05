import {
  isUpcomputerLocalTestVersion,
  UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME,
} from "@t3tools/shared/upcomputerIdentity";

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
  // A local QA build never shares the Alpha app's state, port or updater.
  if (isUpcomputerLocalTestVersion(input.appVersion)) {
    env.T3CODE_HOME = input.joinPath(
      input.homeDirectory,
      UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME,
    );
    env.T3CODE_DISABLE_AUTO_UPDATE = "true";
    delete env.VITE_DEV_SERVER_URL;
    delete env.T3CODE_PORT;
  }
}
