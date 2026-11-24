import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, MessageId } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import type { ReactNode } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../components/Icons";
import { Button } from "../components/ui/button";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import type { TimelineEntry } from "../session-logic";
import { serverEnvironment } from "../state/server";
import {
  answerAgentSetupOffer,
  resolveAgentSetupOfferView,
  setAgentSetupOfferTyping,
  useAgentSetupOfferRecord,
  useAgentSetupOfferTyping,
} from "./agentSetupOffer.logic";
import { AGENT_SETUP_OFFER_COPY } from "./agentSetupOfferCopy";
import { FIRST_RUN_AGENT_INSTANCE_ID } from "./upComputerOnboarding.logic";

interface QuickReply {
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
function QuickReplies({
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

const OFFER_MESSAGE_ID = MessageId.make("agent-setup-offer");
const NOT_NOW_MESSAGE_ID = MessageId.make("agent-setup-offer-not-now");

function appMessage(id: MessageId, createdAt: string, text: string): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt,
    message: {
      id,
      role: "assistant",
      text,
      runId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export interface AgentSetupOfferTimeline {
  /** The app's messages, before the chat's own. */
  readonly entries: ReadonlyArray<TimelineEntry>;
  /** The choices under the offer's text, while it is open. */
  readonly messageFooter: (actions: {
    readonly send: (text: string) => void;
    readonly focusComposer: () => void;
  }) => { readonly messageId: MessageId; readonly content: ReactNode } | null;
  /** Called before a send from this chat's composer: any message answers the open offer. */
  readonly beforeSend: () => void;
}

/**
 * The free agent's first message in the chat it belongs to, written by the app
 * so it shows at once. A choice is sent as the user's own message.
 */
export function useAgentSetupOffer(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly emptyDraft: boolean;
}): AgentSetupOfferTimeline | null {
  const m = useMessages();
  const record = useAgentSetupOfferRecord();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(input.environmentId));
  const typing = useAgentSetupOfferTyping(input.threadId);
  const otherAgentReady =
    providers?.some(
      (provider) =>
        provider.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID &&
        provider.enabled &&
        getOnboardingProviderState(provider) === "ready",
    ) ?? false;
  const view = resolveAgentSetupOfferView({
    record,
    threadId: input.threadId,
    emptyDraft: input.emptyDraft,
    otherAgentReady,
  });
  if (view === null) return null;

  const createdAt = new Date(view.createdAt).toISOString();
  const entries = [appMessage(OFFER_MESSAGE_ID, createdAt, m(AGENT_SETUP_OFFER_COPY.message))];
  if (view.dismissed) {
    entries.push(
      appMessage(
        NOT_NOW_MESSAGE_ID,
        new Date(view.createdAt + 1).toISOString(),
        m(AGENT_SETUP_OFFER_COPY.notNowReply),
      ),
    );
  }
  const { threadId } = input;
  const pick = (
    reply: QuickReply,
    actions: { readonly send: (text: string) => void; readonly focusComposer: () => void },
  ) => {
    if (reply.id === "something-else") {
      setAgentSetupOfferTyping(threadId);
      actions.focusComposer();
      return;
    }
    setAgentSetupOfferTyping(null);
    if (reply.id === "not-now") {
      answerAgentSetupOffer(threadId, "dismissed");
      return;
    }
    answerAgentSetupOffer(threadId, "answered");
    actions.send(reply.label);
  };
  const replies: ReadonlyArray<QuickReply> = [
    { id: "claude", label: m(AGENT_SETUP_OFFER_COPY.claude), icon: <ClaudeAI aria-hidden /> },
    { id: "codex", label: m(AGENT_SETUP_OFFER_COPY.codex), icon: <OpenAI aria-hidden /> },
    {
      id: "antigravity",
      label: m(AGENT_SETUP_OFFER_COPY.antigravity),
      icon: <AntigravityIcon aria-hidden />,
    },
    { id: "something-else", label: m(AGENT_SETUP_OFFER_COPY.somethingElse), pressed: typing },
    { id: "not-now", label: m(AGENT_SETUP_OFFER_COPY.notNow), quiet: true },
  ];
  return {
    entries,
    messageFooter: (actions) =>
      view.replies
        ? {
            messageId: OFFER_MESSAGE_ID,
            content: <QuickReplies replies={replies} onPick={(reply) => pick(reply, actions)} />,
          }
        : null,
    beforeSend: () => {
      if (!view.replies) return;
      setAgentSetupOfferTyping(null);
      answerAgentSetupOffer(threadId, "answered");
    },
  };
}

/** A composer send answers the open offer: any message from this chat does. */
export function answeringAgentSetupOffer<Args extends ReadonlyArray<unknown>, Result>(
  offer: AgentSetupOfferTimeline | null,
  send: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => {
    offer?.beforeSend();
    return send(...args);
  };
}
