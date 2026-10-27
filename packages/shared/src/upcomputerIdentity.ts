/**
 * The Up.computer product identity.
 *
 * Installed V1 apps auto-update into this build and keep their macOS
 * permissions, keychain items and data only while these values stay exactly
 * as V1 shipped them. `scripts/check-branding.ts` fails when one of them, or a
 * place that should read them, regresses to the upstream T3 Code value after a
 * merge. See `docs/branding.md`.
 */

/** User-visible product name. Window titles append a stage label. */
export const UPCOMPUTER_PRODUCT_NAME = "Up.computer";

/** macOS bundle id, Windows AppUserModelID and electron-builder `appId`. */
export const UPCOMPUTER_APP_ID = "computer.up.upcomputer";

/** Packaged stable product name; also the macOS keychain and app bundle name. */
export const UPCOMPUTER_DESKTOP_PRODUCT_NAME = "Up.computer (Alpha)";
export const UPCOMPUTER_NIGHTLY_DESKTOP_PRODUCT_NAME = "Up.computer (Nightly)";

/** Electron profile folders under the OS app-data directory. */
export const UPCOMPUTER_USER_DATA_DIR_NAME = "Up.computer";
export const UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME = "Up.computer (Dev)";

export const UPCOMPUTER_PROTOCOL_SCHEME = "upcomputer";
export const UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME = "upcomputer-dev";

/** Packaged executable, npm-style package name and electron-updater cache name. */
export const UPCOMPUTER_EXECUTABLE_NAME = "upcomputer";
export const UPCOMPUTER_PUBLISHER_NAME = "Up.computer";

/** Base data directory under the user's home; worktrees use the same name locally. */
export const UPCOMPUTER_HOME_DIRECTORY_NAME = ".upcomputer";

/** GitHub repository whose releases carry the desktop update feed. */
export const UPCOMPUTER_UPDATE_REPOSITORY = "krl-gr/upcomputer";
export const UPCOMPUTER_SITE_URL = "https://up.computer";
/** The hosted web app; prompt links point here so any browser can open them. */
export const UPCOMPUTER_HOSTED_APP_URL = "https://app.up.computer";
export const UPCOMPUTER_SUPPORT_EMAIL = "support@up.computer";

/**
 * A packaged, opt-in local QA build (`X.Y.Z-localtest.N`). It never shares
 * the Alpha app's state, bundle id or update feed.
 */
export const UPCOMPUTER_LOCAL_TEST_APP_NAME = "UpComputer Local Test";
export const UPCOMPUTER_LOCAL_TEST_APP_ID = "computer.up.upcomputer.localtest";
export const UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME = ".upcomputer-local-test";

function isUpcomputerLocalTestVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-localtest\.\d+$/.test(version);
}

/**
 * A packaged demo build (`X.Y.Z-demo.N`) for showing the app with made-up
 * data. Like the local test build it has its own state, bundle id and no
 * update feed, so it can run next to Alpha and Local Test.
 */
const UPCOMPUTER_DEMO_APP_NAME = "Up.computer Demo";
const UPCOMPUTER_DEMO_APP_ID = "computer.up.upcomputer.demo";
const UPCOMPUTER_DEMO_HOME_DIRECTORY_NAME = ".upcomputer-demo";

function isUpcomputerDemoVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-demo\.\d+$/.test(version);
}

/**
 * The separate identity of a local build (local test or demo): app and
 * Electron profile name, bundle id and home directory. `undefined` for
 * Alpha, nightly and dev builds, which keep the V1 identity.
 */
export interface UpcomputerLocalBuildIdentity {
  readonly appName: string;
  readonly appId: string;
  readonly homeDirectoryName: string;
}

export function resolveUpcomputerLocalBuildIdentity(
  version: string,
): UpcomputerLocalBuildIdentity | undefined {
  if (isUpcomputerLocalTestVersion(version)) {
    return {
      appName: UPCOMPUTER_LOCAL_TEST_APP_NAME,
      appId: UPCOMPUTER_LOCAL_TEST_APP_ID,
      homeDirectoryName: UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME,
    };
  }
  if (isUpcomputerDemoVersion(version)) {
    return {
      appName: UPCOMPUTER_DEMO_APP_NAME,
      appId: UPCOMPUTER_DEMO_APP_ID,
      homeDirectoryName: UPCOMPUTER_DEMO_HOME_DIRECTORY_NAME,
    };
  }
  return undefined;
}

/** What kind of build reports product telemetry, so test traffic can be told from users. */
export type UpcomputerBuildKind = "dev" | "localtest" | "rc" | "nightly" | "stable";

/**
 * Derived from the packaged app version alone. Unpackaged runs are dev builds
 * whatever version their package.json carries; demo builds count as local
 * builds, preview builds as nightly ones, and any other prerelease as an rc.
 */
export function resolveUpcomputerBuildKind(input: {
  readonly packaged: boolean;
  readonly version: string;
}): UpcomputerBuildKind {
  if (!input.packaged) return "dev";
  if (resolveUpcomputerLocalBuildIdentity(input.version)) return "localtest";
  if (/^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/.test(input.version)) return "nightly";
  if (/^\d+\.\d+\.\d+$/.test(input.version)) return "stable";
  return "rc";
}
