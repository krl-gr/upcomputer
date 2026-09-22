import { ProjectReadFileError } from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

/** Temporary v1 migration input. Never write new project configuration under this name. */
export const LEGACY_PROJECT_CONFIG_FILE_NAME = "t3.json";

/** A new server proves absence explicitly; never infer it from a search index or an error message. */
const isReadError = Schema.is(ProjectReadFileError);
export function isMissingProjectConfigFile(error: unknown): boolean {
  return isReadError(error) && error.notFound === true;
}

/** Old checked-in shell scripts remain runnable during the project-config transition. */
export function withLegacyProjectScriptEnvironment(
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...env,
    ...(env.UPCOMPUTER_PROJECT_ROOT !== undefined
      ? { T3CODE_PROJECT_ROOT: env.UPCOMPUTER_PROJECT_ROOT }
      : {}),
    ...(env.UPCOMPUTER_WORKTREE_PATH !== undefined
      ? { T3CODE_WORKTREE_PATH: env.UPCOMPUTER_WORKTREE_PATH }
      : {}),
  };
}
