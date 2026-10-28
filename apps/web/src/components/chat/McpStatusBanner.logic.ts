import type { OrchestrationV2ProviderMcpStatus } from "@t3tools/contracts";

export interface McpStatusNotices {
  readonly t3: { readonly title: string; readonly description: string } | null;
  readonly userServers: { readonly title: string; readonly description: string } | null;
}

const T3_CAUSE = {
  failed: "The agent started without them.",
  timeout: "They did not connect in time.",
  disconnected: "The connection dropped during this session.",
} as const;

export function mcpStatusNotices(
  status: OrchestrationV2ProviderMcpStatus | null,
  productName: string,
): McpStatusNotices {
  const t3 = status?.t3;
  const failed = status?.failedUserServers ?? [];
  return {
    t3:
      t3 === undefined || t3.outcome === "attached"
        ? null
        : {
            title: `This agent can't use ${productName} tools right now (tasks, delegation)`,
            description: `${T3_CAUSE[t3.outcome]} Reconnect starts a fresh session on your next message; the conversation is kept.`,
          },
    userServers:
      failed.length === 0
        ? null
        : {
            title:
              failed.length === 1
                ? `MCP server "${failed[0]}" is not available`
                : `MCP servers ${failed.map((name) => `"${name}"`).join(", ")} are not available`,
            description:
              "The agent continues without its tools. Check the server in your agent's MCP settings.",
          },
  };
}
