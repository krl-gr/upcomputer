import type {
  EnvironmentId,
  OrchestrationV2Notification,
  OrchestrationV2NotificationSource,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";
import { BotIcon, CircleAlertIcon, MessageCircleIcon } from "lucide-react";
import { use } from "react";

import { WEB_PRODUCT } from "../../product/productEntry";
import { formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { InlineButton } from "../ui/button";
import { TimelineRowCtx } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL } from "./TimelineRowParts";

type BotMentionSource = Extract<OrchestrationV2NotificationSource, { kind: "bot_mention" }>;

function AgentFace(props: { environmentId: EnvironmentId; agentId: string; size: number }) {
  const Avatar = WEB_PRODUCT.features.find((feature) => feature.agentAvatar)?.agentAvatar;
  return (
    <span
      className="flex shrink-0 items-center justify-center text-muted-foreground"
      style={{ width: props.size, height: props.size }}
    >
      {Avatar ? <Avatar {...props} /> : <BotIcon aria-hidden className="size-3.5" />}
    </span>
  );
}

/**
 * A bot the person asked with `@` from this chat: their message, a question the bot waits on
 * in its own chat, and the bot's reply, which it wrote in its chat.
 */
export function BotMentionNotificationCard(props: {
  readonly environmentId: EnvironmentId;
  readonly source: BotMentionSource;
  readonly notification: Pick<OrchestrationV2Notification, "outcome" | "summary" | "detail">;
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const ctx = use(TimelineRowCtx);
  const { source, notification } = props;
  const replied = source.step === "reply" && notification.outcome === "completed";
  const openChat = (
    <InlineButton
      tone="muted"
      aria-label={gt("Open {name}'s chat", { name: source.name })}
      onClick={() => props.onOpenThread(source.botThreadId)}
    >
      {gt("Open chat")}
    </InlineButton>
  );
  const time = (
    <span className="shrink-0 font-mono text-3xs text-muted-foreground/80">
      {formatShortTimestamp(props.createdAt, props.timestampFormat)}
    </span>
  );
  if (source.step === "sent") {
    return (
      <div data-v2-item-type="notification" className="flex flex-col gap-1 px-0.5 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AgentFace environmentId={props.environmentId} agentId={source.agentId} size={16} />
          <span className="min-w-0 flex-1 truncate">
            {gt("You asked {name}", { name: source.name })}
          </span>
          {time}
        </div>
        {notification.detail ? (
          <p className="ps-6 text-xs whitespace-pre-wrap break-words text-foreground">
            {notification.detail}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div
      data-v2-item-type="notification"
      className="flex flex-col gap-1.5 rounded-md border border-border/70 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {source.step === "request" ? (
          <MessageCircleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : replied ? (
          <AgentFace environmentId={props.environmentId} agentId={source.agentId} size={20} />
        ) : (
          <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {replied ? source.name : notification.summary}
        </span>
        {openChat}
        {time}
      </div>
      {notification.detail ? (
        replied ? (
          <ChatMarkdown
            className="text-foreground"
            text={notification.detail}
            cwd={ctx.markdownCwd}
            threadRef={ctx.threadRef ?? undefined}
            skills={ctx.skills}
            isStreaming={false}
            headingLevelOffset={MESSAGE_HEADING_LEVEL}
            onUseArtifactTemplate={ctx.onUseArtifactTemplate}
            onImageExpand={ctx.onImageExpand}
          />
        ) : (
          <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
            {notification.detail}
          </p>
        )
      ) : null}
    </div>
  );
}
