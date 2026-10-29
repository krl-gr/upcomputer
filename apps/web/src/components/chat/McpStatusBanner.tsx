import type { OrchestrationV2ProviderMcpStatus } from "@t3tools/contracts";
import { PlugIcon, UnplugIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { mcpStatusNotices } from "./McpStatusBanner.logic";

export function mcpStatusBannerItems(input: {
  readonly threadKey: string;
  readonly status: OrchestrationV2ProviderMcpStatus | null;
  readonly productName: string;
  readonly canReconnect: boolean;
  /** Restarting the session would kill the running turn, so Reconnect waits for it. */
  readonly turnRunning: boolean;
  readonly reconnecting: boolean;
  readonly onReconnect: () => void;
  readonly userNoticeDismissed: (key: string) => boolean;
  readonly onDismissUserNotice: (key: string) => void;
}): ComposerBannerStackItem[] {
  const notices = mcpStatusNotices(input.status, input.productName);
  const items: ComposerBannerStackItem[] = [];
  if (notices.t3 !== null) {
    items.push({
      id: `mcp-t3:${input.threadKey}`,
      variant: "warning",
      group: "attention",
      icon: <UnplugIcon />,
      title: notices.t3.title,
      description: notices.t3.description,
      actions: input.canReconnect ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={input.reconnecting || input.turnRunning}
          title={
            input.turnRunning
              ? "Available when the agent finishes, or press Stop to reconnect now."
              : undefined
          }
          onClick={input.onReconnect}
        >
          {input.reconnecting ? "Reconnecting..." : "Reconnect"}
        </Button>
      ) : null,
    });
  }
  const userNoticeKey = `mcp-user:${input.threadKey}:${input.status?.failedUserServers.join("\n")}`;
  if (notices.userServers !== null && !input.userNoticeDismissed(userNoticeKey)) {
    items.push({
      id: userNoticeKey,
      variant: "info",
      icon: <PlugIcon />,
      title: notices.userServers.title,
      description: notices.userServers.description,
      dismissLabel: "Dismiss MCP server notice",
      onDismiss: () => input.onDismissUserNotice(userNoticeKey),
    });
  }
  return items;
}
