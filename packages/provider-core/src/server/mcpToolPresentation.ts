import type { ToolActivityIcon, ToolActivitySource } from "@t3tools/contracts";
import {
  isT3McpServerName,
  resolveT3McpToolDefinition,
} from "@t3tools/shared/t3McpToolPresentation";
import { UPCOMPUTER_PRODUCT_NAME } from "@t3tools/shared/upcomputerIdentity";

export function normalizeMcpText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

export function normalizeMcpHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 4096
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function mcpToolPresentation(input: {
  readonly toolName?: unknown;
  readonly serverName?: unknown;
  readonly title?: unknown;
  readonly serverDisplayName?: unknown;
  readonly iconUrl?: unknown;
  readonly iconUrlDark?: unknown;
  readonly source?: unknown;
}): {
  readonly title?: string;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
} {
  const source =
    typeof input.source === "object" && input.source !== null ? input.source : undefined;
  const qualified =
    typeof input.toolName === "string" ? /^mcp__(.+?)__(.+)$/i.exec(input.toolName) : null;
  const server = normalizeMcpText(input.serverName ?? qualified?.[1] ?? input.serverDisplayName);
  const tool = normalizeMcpText(qualified?.[2] ?? input.toolName);
  if (server && tool && resolveT3McpToolDefinition(`${server}.${tool}`)) return {};
  const title =
    normalizeMcpText(input.title) ??
    (server && tool ? normalizeMcpText(tool.replace(/[_-]+/gu, " ")) : undefined);
  if (!server) return title ? { title } : {};
  // UpComputer: the app's own server has no name of its own users would know.
  const name =
    (isT3McpServerName(server) ? UPCOMPUTER_PRODUCT_NAME : undefined) ??
    normalizeMcpText(input.serverDisplayName) ??
    normalizeMcpText(source && Reflect.get(source, "name")) ??
    normalizeMcpText(server.replace(/[_-]+/gu, " ")) ??
    server;
  const logoUrl =
    normalizeMcpHttpUrl(input.iconUrl) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrl"));
  const logoUrlDark =
    normalizeMcpHttpUrl(input.iconUrlDark) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrlDark"));
  const icon = logoUrl
    ? { _tag: "themed-logo" as const, logoUrl, ...(logoUrlDark ? { logoUrlDark } : {}) }
    : undefined;
  return {
    ...(title ? { title } : {}),
    ...(icon ? { toolIcon: icon } : {}),
    toolSource: {
      key: `mcp:${server.toLowerCase()}`,
      name,
      kind: "integration",
      ...(icon ? { icon } : {}),
    },
  };
}
