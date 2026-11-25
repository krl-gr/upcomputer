import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { CircleAlertIcon, MessageCircleIcon } from "lucide-react";

import { InlineButton } from "../../../../apps/web/src/components/ui/button.tsx";
import type { ExperimentalWebNotificationCardProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { formatShortTimestamp } from "../../../../apps/web/src/timestampFormat.ts";
import { BotAvatar, useBots } from "./botData.tsx";

function BotFace(props: {
  readonly environmentId: EnvironmentId;
  readonly agentId: string;
  readonly size: number;
}) {
  const { bots } = useBots(props.environmentId);
  const bot = bots.find((item) => item.agent.id === props.agentId);
  return (
    <span
      className="flex shrink-0 items-center justify-center text-muted-foreground"
      style={{ width: props.size, height: props.size }}
    >
      <BotAvatar id={props.agentId} appearance={bot?.appearance} state="idle" size={props.size} />
    </span>
  );
}

/**
 * A bot the person asked with `@` from this chat: their message, a question the bot waits on
 * in its own chat, and the bot's reply, which it wrote in its chat.
 */
export function BotMentionNotificationCard(props: ExperimentalWebNotificationCardProps) {
  const gt = useGT();
  const { notification } = props;
  if (notification.source.kind !== "bot_mention") return null;
  const { source } = notification;
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
          <BotFace environmentId={props.environmentId} agentId={source.agentId} size={16} />
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
      {/* The Open chat button takes the row's text size. */}
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {source.step === "request" ? (
          <MessageCircleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : replied ? (
          <BotFace environmentId={props.environmentId} agentId={source.agentId} size={20} />
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
          props.renderMarkdown(notification.detail)
        ) : (
          <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
            {notification.detail}
          </p>
        )
      ) : null}
    </div>
  );
}
