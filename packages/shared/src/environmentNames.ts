/** Read the configured UpComputer name only. Old T3 variables are not aliases. */
export function readUpcomputerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return env[name];
}
