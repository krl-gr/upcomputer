const CURRENT_PREFIX = "UPCOMPUTER_";
const LEGACY_PREFIX = "T3CODE_";

export function legacyEnvironmentName(name: string): string {
  return name.startsWith(CURRENT_PREFIX) ? LEGACY_PREFIX + name.slice(CURRENT_PREFIX.length) : name;
}

/** Preserve explicit new values (including false/empty), without changing process.env. */
export function readUpcomputerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return env[name] ?? env[legacyEnvironmentName(name)];
}

/** Normalize each dotenv/process source before merging, preserving source precedence. */
export function normalizeUpcomputerEnvironment(
  env: Readonly<Record<string, string>>,
): Record<string, string>;
export function normalizeUpcomputerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined>;
export function normalizeUpcomputerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const normalized = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_PREFIX)) continue;
    const current = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length);
    if (normalized[current] === undefined) normalized[current] = value;
  }
  return normalized;
}
