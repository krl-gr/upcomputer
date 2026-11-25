import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  answerAgentSetupOffer,
  markAgentSetupOfferShown,
  readAgentSetupOfferRecord,
  resolveAgentSetupOfferView,
  shouldCreateAgentSetupOffer,
  updateAgentSetupOfferRecord,
  type AgentSetupOfferRecord,
} from "./agentSetupOffer.logic";

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-24T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const signedOut = { auth: { status: "unauthenticated" } } as const;
const missing = { installed: false, status: "error", auth: { status: "unknown" } } as const;
const open: AgentSetupOfferRecord = { createdAt: 1, threadId: null, state: "open" };

describe("shouldCreateAgentSetupOffer", () => {
  const freeAgentOnly = [
    provider("opencode"),
    provider("claudeAgent", missing),
    provider("codex", signedOut),
  ];

  it("comes once the free agent installed from the no-agent screen works", () => {
    expect(
      shouldCreateAgentSetupOffer({
        existing: null,
        source: "no_agent_screen",
        providers: freeAgentOnly,
      }),
    ).toBe(true);
  });

  it("comes only once", () => {
    for (const state of ["open", "answered", "dismissed"] as const) {
      expect(
        shouldCreateAgentSetupOffer({
          existing: { ...open, state },
          source: "no_agent_screen",
          providers: freeAgentOnly,
        }),
      ).toBe(false);
    }
  });

  it("never comes for a user who already has a working agent", () => {
    expect(
      shouldCreateAgentSetupOffer({
        existing: null,
        source: "no_agent_screen",
        providers: [provider("opencode"), provider("codex")],
      }),
    ).toBe(false);
    // The automatic install for a signed-out agent never went through the screen.
    expect(
      shouldCreateAgentSetupOffer({ existing: null, source: null, providers: freeAgentOnly }),
    ).toBe(false);
  });

  it("waits for the free agent itself to work", () => {
    expect(
      shouldCreateAgentSetupOffer({
        existing: null,
        source: "no_agent_screen",
        providers: [provider("opencode", { statusPending: true }), provider("codex", signedOut)],
      }),
    ).toBe(false);
    expect(
      shouldCreateAgentSetupOffer({ existing: null, source: "no_agent_screen", providers: null }),
    ).toBe(false);
  });
});

describe("resolveAgentSetupOfferView", () => {
  const view = (
    record: AgentSetupOfferRecord | null,
    overrides: Partial<Parameters<typeof resolveAgentSetupOfferView>[0]> = {},
  ) =>
    resolveAgentSetupOfferView({
      record,
      threadId: "thread-a",
      emptyDraft: true,
      otherAgentReady: false,
      ...overrides,
    });

  it("shows an unanswered offer in an empty new chat, with its choices", () => {
    expect(view(open)).toEqual({ createdAt: 1, replies: true, dismissed: false, unbound: true });
    expect(view(open, { emptyDraft: false })).toBeNull();
    // Another agent works now: a new chat no longer offers setup.
    expect(view(open, { otherAgentReady: true })).toBeNull();
    expect(view(null)).toBeNull();
  });

  it("stays in the chat that answered it, without choices", () => {
    const answered = { ...open, threadId: "thread-a", state: "answered" } as const;
    expect(view(answered, { emptyDraft: false, otherAgentReady: true })).toMatchObject({
      replies: false,
      dismissed: false,
    });
    expect(view(answered, { threadId: "thread-b" })).toBeNull();
    const dismissed = { ...open, threadId: "thread-a", state: "dismissed" } as const;
    expect(view(dismissed)).toMatchObject({ replies: false, dismissed: true });
  });
});

describe("answerAgentSetupOffer", () => {
  it("ties the open offer to the chat that answered, once", () => {
    updateAgentSetupOfferRecord(() => open);
    answerAgentSetupOffer("thread-a", "dismissed");
    expect(readAgentSetupOfferRecord()).toEqual({
      ...open,
      threadId: "thread-a",
      state: "dismissed",
    });
    // Another chat, or a second answer, changes nothing.
    answerAgentSetupOffer("thread-b", "answered");
    answerAgentSetupOffer("thread-a", "answered");
    expect(readAgentSetupOfferRecord()).toMatchObject({ threadId: "thread-a", state: "dismissed" });
    updateAgentSetupOfferRecord(() => null);
    expect(readAgentSetupOfferRecord()).toBeNull();
  });
});

describe("markAgentSetupOfferShown", () => {
  it("marks the offer once, so its shown event goes out once", () => {
    expect(markAgentSetupOfferShown()).toBe(false);
    updateAgentSetupOfferRecord(() => open);
    expect(markAgentSetupOfferShown()).toBe(true);
    expect(markAgentSetupOfferShown()).toBe(false);
    expect(readAgentSetupOfferRecord()).toEqual({ ...open, shown: true });
    updateAgentSetupOfferRecord(() => null);
  });
});
