/**
 * Up.computer documents its environment variables as `UPCOMPUTER_*`, while the
 * code keeps upstream's `T3CODE_*` names. Entry points call this before
 * anything reads the environment: every `UPCOMPUTER_<NAME>` is copied to
 * `T3CODE_<NAME>`, and wins when both are set. See `docs/branding.md`.
 */
const UPCOMPUTER_ENV_PREFIX = "UPCOMPUTER_";
const T3CODE_ENV_PREFIX = "T3CODE_";

export function applyUpcomputerEnvAliases<Env extends Record<string, string | undefined>>(
  env: Env,
): Env {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(UPCOMPUTER_ENV_PREFIX) || value === undefined) continue;
    (env as Record<string, string | undefined>)[
      `${T3CODE_ENV_PREFIX}${name.slice(UPCOMPUTER_ENV_PREFIX.length)}`
    ] = value;
  }
  return env;
}
