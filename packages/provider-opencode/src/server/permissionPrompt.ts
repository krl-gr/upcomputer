import type { PermissionRequest } from "@opencode-ai/sdk/v2";

const VALUE_MAX_CHARS = 120;
const ARGUMENTS_MAX_CHARS = 400;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function argumentValue(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return clip(text.replace(/\s+/g, " ").trim(), VALUE_MAX_CHARS);
}

/**
 * What an OpenCode approval asks about. Native tools name their commands or paths in the
 * patterns; MCP tools send only the wildcard, so the tool and its arguments say what runs.
 */
export function openCodePermissionPrompt(
  permission: Pick<PermissionRequest, "permission" | "patterns">,
  toolInput: unknown,
): string {
  const patterns = permission.patterns.filter((pattern) => pattern.trim() !== "*");
  if (patterns.length > 0) return patterns.join("\n");
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput))
    return permission.permission;
  const args = Object.entries(toolInput)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${argumentValue(value)}`);
  return args.length === 0
    ? permission.permission
    : `${permission.permission}\n${clip(args.join("\n"), ARGUMENTS_MAX_CHARS)}`;
}
