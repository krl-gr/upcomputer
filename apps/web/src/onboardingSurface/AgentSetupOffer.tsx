import { useMessages } from "gt-react";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button";
import { AGENT_SETUP_OFFER_COPY } from "./agentSetupOfferCopy";

export interface QuickReply {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** A way out, such as "Not now": shown as plain text after the choices. */
  readonly quiet?: boolean;
  /** The reply that is waiting for typed text, such as "Something else". */
  readonly pressed?: boolean;
}

/**
 * The answers a message offers, as buttons under it. A click sends the label as
 * the user's own message, so the buttons leave and the answer stays in the chat.
 */
export function QuickReplies({
  replies,
  onPick,
}: {
  readonly replies: ReadonlyArray<QuickReply>;
  readonly onPick: (reply: QuickReply) => void;
}) {
  const m = useMessages();
  return (
    <div
      role="group"
      aria-label={m(AGENT_SETUP_OFFER_COPY.repliesLabel)}
      data-quick-replies
      className="flex flex-wrap gap-2"
    >
      {replies.map((reply) => (
        <Button
          key={reply.id}
          variant={reply.quiet ? "ghost-muted" : "outline"}
          data-quick-reply={reply.id}
          {...(reply.pressed ? { "data-pressed": "" } : {})}
          onClick={() => onPick(reply)}
        >
          {reply.icon}
          {reply.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The in-app terminal an agent opens with a command already typed, in the look
 * of the Welcome page's sign-in terminal. Nothing runs until the user presses Enter.
 */
export function AgentTerminalCard({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  /** The terminal itself. */
  readonly children: ReactNode;
}) {
  const m = useMessages();
  return (
    <div
      data-agent-terminal-card
      className="overflow-hidden rounded-lg border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 ps-3 pe-1.5">
        <span className="min-w-0 text-base font-medium text-muted-foreground sm:text-sm">
          {m(AGENT_SETUP_OFFER_COPY.terminalHint)}
        </span>
        <Button size="sm" variant="ghost-muted" onClick={onClose}>
          {m(AGENT_SETUP_OFFER_COPY.terminalClose)}
        </Button>
      </div>
      <div className="h-44">{children}</div>
    </div>
  );
}

/** The one next step after an agent is signed in. */
export function SwitchAgentAction({
  agent,
  icon,
  onSwitch,
}: {
  readonly agent: string;
  readonly icon: ReactNode;
  readonly onSwitch: () => void;
}) {
  const m = useMessages();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" data-switch-agent onClick={onSwitch}>
        {icon}
        {m(AGENT_SETUP_OFFER_COPY.switchChat, { agent })}
      </Button>
    </div>
  );
}
