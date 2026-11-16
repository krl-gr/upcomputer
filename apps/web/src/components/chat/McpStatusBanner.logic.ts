import type { OrchestrationV2ProviderMcpStatus } from "@t3tools/contracts";
import type { useGT } from "gt-react";

export interface McpStatusNotices {
  readonly t3: { readonly title: string; readonly description: string } | null;
  readonly userServers: { readonly title: string; readonly description: string } | null;
}

export function mcpStatusNotices(
  status: OrchestrationV2ProviderMcpStatus | null,
  productName: string,
  gt: ReturnType<typeof useGT>,
): McpStatusNotices {
  const t3 = status?.t3;
  const failed = status?.failedUserServers ?? [];
  const t3Cause = {
    failed: gt("The agent started without them."),
    timeout: gt("They did not connect in time."),
    disconnected: gt("The connection dropped during this session."),
  } as const;
  return {
    t3:
      t3 === undefined || t3.outcome === "attached"
        ? null
        : {
            title: gt("This agent can't use {productName} tools right now (tasks, delegation)", {
              productName,
            }),
            description: gt(
              "{cause} Reconnect starts a fresh session on your next message; the conversation is kept.",
              { cause: t3Cause[t3.outcome] },
            ),
          },
    userServers:
      failed.length === 0
        ? null
        : {
            title:
              failed.length === 1
                ? gt('MCP server "{name}" is not available', { name: failed[0] })
                : gt("MCP servers {names} are not available", {
                    names: failed.map((name) => `"${name}"`).join(", "),
                  }),
            description: gt(
              "The agent continues without its tools. Check the server in your agent's MCP settings.",
            ),
          },
  };
}
