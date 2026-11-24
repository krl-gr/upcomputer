/* oxlint-disable t3code/no-untranslated-copy -- a dev-only mock conversation, never shown to users */
import { MessageId } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../components/Icons";
import type { TimelineEntry } from "../session-logic";
import {
  AgentTerminalCard,
  QuickReplies,
  SwitchAgentAction,
  type QuickReply,
} from "./AgentSetupOffer";
import { AGENT_SETUP_OFFER_COPY } from "./agentSetupOfferCopy";

// Design preview, dev builds only: the free agent's first message and a mock setup chat.
// Set localStorage "upcomputer:dev:agent-setup-offer" to "offer", reload and click through,
// or jump with window.agentSetupOfferPreview("terminal", "codex"). Nothing is sent or run.
const STORAGE_KEY = "upcomputer:dev:agent-setup-offer";
const STATES = [
  "offer",
  "typing",
  "dismissed",
  "sent",
  "plan",
  "installing",
  "terminal",
  "signedIn",
  "switched",
] as const;
type PreviewState = (typeof STATES)[number];

const AGENTS = {
  claude: {
    name: "Claude Code",
    plan: "Do you already have a Claude Pro or Max plan? Claude Code signs in with it.",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    signIn: "claude auth login",
    check: "claude auth status",
    icon: <ClaudeAI aria-hidden />,
  },
  codex: {
    name: "Codex",
    plan: "Do you already have a ChatGPT Plus or Pro plan? Codex signs in with it.",
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    signIn: "codex login",
    check: "codex login status",
    icon: <OpenAI aria-hidden />,
  },
} as const;
type PreviewAgent = keyof typeof AGENTS;

interface Preview {
  readonly state: PreviewState;
  readonly agent: PreviewAgent;
  /** A click in the preview plays the next steps on a timer; a console call holds still. */
  readonly running: boolean;
}

declare global {
  interface Window {
    agentSetupOfferPreview?: (state: PreviewState, agent?: PreviewAgent) => void;
  }
}

function readRequestedState(): PreviewState | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return STATES.find((state) => state === stored) ?? null;
  } catch {
    return null;
  }
}

const requestedState = readRequestedState();
let preview: Preview | null =
  requestedState === null ? null : { state: requestedState, agent: "claude", running: false };
const listeners = new Set<() => void>();

function setPreview(next: Preview) {
  preview = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (requestedState !== null) {
  window.agentSetupOfferPreview = (state, agent = "claude") =>
    setPreview({ state, agent, running: false });
}

const STARTED_AT = Date.now() - 60_000;
const at = (step: number) => new Date(STARTED_AT + step * 4_000).toISOString();

function message(step: number, role: "assistant" | "user", text: string): TimelineEntry {
  const createdAt = at(step);
  return {
    id: `agent-setup-offer-${step}`,
    kind: "message",
    createdAt,
    message: {
      id: MessageId.make(`agent-setup-offer-${step}`),
      role,
      text,
      runId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function command(step: number, text: string, running: boolean): TimelineEntry {
  const createdAt = at(step);
  return {
    id: `agent-setup-offer-${step}`,
    kind: "work",
    createdAt,
    entry: {
      id: `agent-setup-offer-${step}`,
      createdAt,
      label: running ? "Running command" : "Ran command",
      command: text,
      tone: "tool",
      toolLifecycleStatus: running ? "inProgress" : "completed",
    },
  };
}

const AFTER: Readonly<Record<PreviewState, number>> = {
  offer: 0,
  typing: 0,
  dismissed: 0,
  sent: 1,
  plan: 2,
  installing: 3,
  terminal: 4,
  signedIn: 5,
  switched: 5,
};

/** One array per state, so the timeline sees the same entries on every render. */
const entriesCache = new Map<string, ReadonlyArray<TimelineEntry>>();

function previewEntries(current: Preview, offer: string): ReadonlyArray<TimelineEntry> {
  const key = `${AFTER[current.state]}:${current.agent}:${offer}`;
  const cached = entriesCache.get(key);
  if (cached) return cached;
  const entries = buildEntries(current, offer);
  entriesCache.set(key, entries);
  return entries;
}

function buildEntries({ state, agent }: Preview, offer: string): ReadonlyArray<TimelineEntry> {
  const reached = AFTER[state];
  const { name, plan, install, signIn, check } = AGENTS[agent];
  const entries = [message(0, "assistant", offer)];
  if (reached >= 1) entries.push(message(1, "user", name));
  if (reached >= 2) entries.push(message(2, "assistant", plan));
  if (reached >= 3) {
    entries.push(
      message(3, "user", "Yes, I do"),
      message(4, "assistant", `Great. I'm installing ${name} now. It takes about a minute.`),
      command(5, install, reached === 3),
    );
  }
  if (reached >= 4) {
    entries.push(
      message(
        6,
        "assistant",
        `${name} is installed. I opened a terminal with the sign-in command. Press Enter to run it, then finish signing in in your browser.`,
      ),
    );
  }
  if (reached >= 5) {
    entries.push(
      command(7, signIn, false),
      command(8, check, false),
      message(
        9,
        "assistant",
        `You're signed in, and ${name} is ready. Want to switch this chat to it?`,
      ),
    );
  }
  return entries;
}

function focusComposer() {
  document
    .querySelector<HTMLElement>("[data-chat-composer-form] [contenteditable='true']")
    ?.focus();
}

function MockTerminal({ text, onRun }: { readonly text: string; readonly onRun: () => void }) {
  return (
    <div
      role="textbox"
      tabIndex={0}
      aria-label={text}
      className="size-full cursor-text bg-(--terminal-background) px-3 py-2 font-mono text-base leading-6 text-(--terminal-foreground) sm:text-sm sm:leading-5 outline-none"
      onKeyDown={(event) => {
        if (event.key === "Enter") onRun();
      }}
    >
      {`you@your-mac ~ % ${text}`}
      <span
        aria-hidden
        className="ms-px inline-block h-4 w-2 translate-y-0.5 bg-(--terminal-cursor)"
      />
    </div>
  );
}

function PreviewFooter({ current }: { readonly current: Preview }) {
  const m = useMessages();
  const { state, agent, running } = current;
  const go = (next: PreviewState, nextAgent: PreviewAgent = agent) =>
    setPreview({ state: next, agent: nextAgent, running: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays the mock agent's next step on a timer after a click
  useEffect(() => {
    if (!running) return;
    const next = state === "sent" ? "plan" : state === "installing" ? "terminal" : null;
    if (next === null) return;
    const timer = window.setTimeout(() => go(next), state === "sent" ? 1_400 : 2_600);
    return () => window.clearTimeout(timer);
  });

  let content: ReactNode = null;
  if (state === "offer" || state === "typing") {
    const replies: ReadonlyArray<QuickReply> = [
      { id: "claude", label: m(AGENT_SETUP_OFFER_COPY.claude), icon: AGENTS.claude.icon },
      { id: "codex", label: m(AGENT_SETUP_OFFER_COPY.codex), icon: AGENTS.codex.icon },
      {
        id: "antigravity",
        label: m(AGENT_SETUP_OFFER_COPY.antigravity),
        icon: <AntigravityIcon aria-hidden />,
      },
      {
        id: "something-else",
        label: m(AGENT_SETUP_OFFER_COPY.somethingElse),
        pressed: state === "typing",
      },
      { id: "not-now", label: m(AGENT_SETUP_OFFER_COPY.notNow), quiet: true },
    ];
    content = (
      <QuickReplies
        replies={replies}
        onPick={(reply) => {
          if (reply.id === "not-now") go("dismissed");
          else if (reply.id === "something-else") {
            go("typing");
            focusComposer();
          } else go("sent", reply.id === "codex" ? "codex" : "claude");
        }}
      />
    );
  } else if (state === "plan") {
    content = (
      <QuickReplies
        replies={[
          { id: "yes", label: "Yes, I do" },
          { id: "no", label: "Not yet" },
        ]}
        onPick={() => go("installing")}
      />
    );
  } else if (state === "terminal") {
    content = (
      <AgentTerminalCard onClose={() => go("plan")}>
        <MockTerminal text={AGENTS[agent].signIn} onRun={() => go("signedIn")} />
      </AgentTerminalCard>
    );
  } else if (state === "signedIn") {
    content = (
      <SwitchAgentAction
        agent={AGENTS[agent].name}
        icon={AGENTS[agent].icon}
        onSwitch={() => go("switched")}
      />
    );
  }
  if (content === null) return null;
  // The real controls belong inside the message's row, under its text. The mock
  // sits in the timeline footer, so it moves up over the row's hover line.
  return (
    <div className="messages-timeline-row-frame">
      <div className="chat-content-lane">
        <div className="relative -mt-12 bg-background px-1 pt-3 pb-1">{content}</div>
      </div>
    </div>
  );
}

/** What the composer asks for after "Something else", or null. */
export function useAgentSetupOfferComposerPlaceholder(): string | null {
  const m = useMessages();
  const current = useSyncExternalStore(subscribe, () => preview);
  return current?.state === "typing" ? m(AGENT_SETUP_OFFER_COPY.typePlaceholder) : null;
}

/** The mock chat for ChatView's draft timeline, or null outside the preview. */
export function useAgentSetupOfferPreview(): {
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly footer: ReactNode;
  readonly working: boolean;
} | null {
  const m = useMessages();
  const current = useSyncExternalStore(subscribe, () => preview);
  if (current === null) return null;
  return {
    entries: previewEntries(current, m(AGENT_SETUP_OFFER_COPY.message)),
    footer: <PreviewFooter current={current} />,
    working: current.state === "sent" || current.state === "installing",
  };
}
