import type {
  ExecutionEnvironmentPlatformOs,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
} from "@t3tools/contracts";

export const PROVIDER_SIGN_IN_TOOL_NAME = "provider_sign_in";

const SIGN_IN_TERMINAL_PREFIX = "provider-sign-in-";

/** One sign-in terminal per provider instance in a thread. */
export const providerSignInTerminalId = (instanceId: ProviderInstanceId) =>
  `${SIGN_IN_TERMINAL_PREFIX}${instanceId}`;

/** The provider instance a sign-in terminal signs in, or null for any other terminal. */
export const providerSignInInstanceId = (terminalId: string): string | null =>
  terminalId.startsWith(SIGN_IN_TERMINAL_PREFIX) &&
  terminalId.length > SIGN_IN_TERMINAL_PREFIX.length
    ? terminalId.slice(SIGN_IN_TERMINAL_PREFIX.length)
    : null;

const SAFE_SHELL_BINARY_PATTERN = /^[A-Za-z0-9_./:\\-]+$/;

/**
 * The only commands Up.computer types into a sign-in terminal, per driver: the CLI's
 * default binary and its sign-in arguments. Agents never supply a command.
 */
const SIGN_IN_COMMANDS: ReadonlyMap<string, { binary: string; args: string }> = new Map([
  ["claudeAgent", { binary: "claude", args: "auth login" }],
  ["codex", { binary: "codex", args: "login" }],
  ["grok", { binary: "grok", args: "login" }],
  ["kiro", { binary: "kiro-cli", args: "login" }],
  ["fx", { binary: "fx", args: "login" }],
]);

function quoteProviderBinary(
  binaryPath: string,
  fallback: string,
  platform: ExecutionEnvironmentPlatformOs,
): string {
  if (
    SAFE_SHELL_BINARY_PATTERN.test(binaryPath) &&
    (platform === "windows" || !binaryPath.includes("\\"))
  ) {
    return binaryPath;
  }
  if (platform === "windows") return `& '${binaryPath.replaceAll("'", "''")}'`;
  if (platform === "darwin" || platform === "linux") {
    if (binaryPath.startsWith("~/") || binaryPath.startsWith("~\\")) {
      return `~/'${binaryPath.slice(2).replaceAll("'", `'"'"'`)}'`;
    }
    return `'${binaryPath.replaceAll("'", `'"'"'`)}'`;
  }
  return fallback;
}

/**
 * The sign-in command for a provider instance, using its configured binary path, or null
 * when its driver has no terminal sign-in.
 */
export function resolveProviderSignInCommand(
  provider: { readonly driver: ProviderDriverKind; readonly instanceId: ProviderInstanceId },
  settings: ServerSettings,
  platform: ExecutionEnvironmentPlatformOs,
): string | null {
  const command = SIGN_IN_COMMANDS.get(provider.driver);
  if (command === undefined) return null;
  const config = settings.providerInstances[provider.instanceId]?.config;
  const configured =
    typeof config === "object" && config !== null && "binaryPath" in config
      ? config.binaryPath
      : undefined;
  const binaryPath =
    typeof configured === "string" && configured.trim() !== "" ? configured.trim() : command.binary;
  return `${quoteProviderBinary(binaryPath, command.binary, platform)} ${command.args}`;
}
