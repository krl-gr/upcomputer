import type {
  OrchestrationV2NotificationSource,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { use } from "react";

import ChatMarkdown from "../components/ChatMarkdown";
import { TimelineRowCtx } from "../components/chat/timelineRowContext";
import { MESSAGE_HEADING_LEVEL } from "../components/chat/TimelineRowParts";
import { WEB_PRODUCT } from "./productEntry";

const NOTIFICATION_CARDS = WEB_PRODUCT.features.flatMap((feature) =>
  feature.notificationCard ? [{ id: feature.id, ...feature.notificationCard }] : [],
);

export const hasProductNotificationCard = (kind: OrchestrationV2NotificationSource["kind"]) =>
  NOTIFICATION_CARDS.some((entry) => entry.kinds.includes(kind));

export function ProductNotificationCard(props: {
  readonly item: Extract<OrchestrationV2TurnItem, { type: "notification" }>;
  readonly createdAt: string;
}) {
  const ctx = use(TimelineRowCtx);
  const entry = NOTIFICATION_CARDS.find((candidate) =>
    candidate.kinds.includes(props.item.source.kind),
  );
  if (!entry) return null;
  const renderMarkdown = (text: string) => (
    <ChatMarkdown
      className="text-foreground"
      text={text}
      cwd={ctx.markdownCwd}
      threadRef={ctx.threadRef ?? undefined}
      skills={ctx.skills}
      isStreaming={false}
      headingLevelOffset={MESSAGE_HEADING_LEVEL}
      onUseArtifactTemplate={ctx.onUseArtifactTemplate}
      onImageExpand={ctx.onImageExpand}
    />
  );
  return (
    <entry.component
      environmentId={ctx.activeThreadEnvironmentId}
      notification={props.item}
      createdAt={props.createdAt}
      timestampFormat={ctx.timestampFormat}
      onOpenThread={ctx.onOpenThread}
      renderMarkdown={renderMarkdown}
    />
  );
}
