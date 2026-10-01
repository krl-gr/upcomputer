// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export const DEFAULT_BROWSER_PROFILE_ID = "default" as const;

export interface BrowserProfilePaths {
  readonly profilesDir: string;
  readonly defaultProfileDir: string;
  readonly defaultRuntimeMetadataPath: string;
}

export function resolveBrowserProfilePaths(stateDir: string): BrowserProfilePaths {
  const profilesDir = NodePath.join(stateDir, "browser-profiles");
  return {
    profilesDir,
    defaultProfileDir: NodePath.join(profilesDir, DEFAULT_BROWSER_PROFILE_ID),
    defaultRuntimeMetadataPath: NodePath.join(
      profilesDir,
      `${DEFAULT_BROWSER_PROFILE_ID}.cdp.json`,
    ),
  };
}
