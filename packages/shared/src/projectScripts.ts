import { normalizeUpcomputerEnvironment } from "./environmentNames.ts";
import { withLegacyProjectScriptEnvironment } from "./legacyProjectConfig.ts";
import type { ProjectScript } from "@upcomputer/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    UPCOMPUTER_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.UPCOMPUTER_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return withLegacyProjectScriptEnvironment({
      ...env,
      ...normalizeUpcomputerEnvironment(input.extraEnv),
    });
  }
  return withLegacyProjectScriptEnvironment(env);
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
