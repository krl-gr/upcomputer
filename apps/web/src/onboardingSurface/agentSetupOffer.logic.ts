import type { ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { FIRST_RUN_AGENT_INSTANCE_ID } from "./upComputerOnboarding.logic";

/**
 * The free agent's first message, written by the app after the no-agent screen
 * installed it. Kept in this client across launches: created once, tied to the
 * chat it first answered in, and never offered again once answered or dismissed.
 */
const AgentSetupOfferRecord = Schema.Struct({
  createdAt: Schema.Number,
  threadId: Schema.NullOr(Schema.String),
  state: Schema.Literals(["open", "answered", "dismissed"]),
});
export type AgentSetupOfferRecord = typeof AgentSetupOfferRecord.Type;

const STORAGE_KEY = "upcomputer:onboarding:agent-setup-offer";

/**
 * Only an install the user picked on the no-agent screen, once the free agent
 * works and none of their own agents does. Never a second time.
 */
export function shouldCreateAgentSetupOffer(input: {
  readonly existing: AgentSetupOfferRecord | null;
  readonly source: "no_agent_screen" | null;
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
}): boolean {
  if (input.existing !== null || input.source !== "no_agent_screen" || !input.providers) {
    return false;
  }
  const ready = (provider: ServerProvider) =>
    provider.enabled && getOnboardingProviderState(provider) === "ready";
  const freeAgent = (provider: ServerProvider) =>
    provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID;
  return (
    input.providers.some((provider) => freeAgent(provider) && ready(provider)) &&
    !input.providers.some((provider) => !freeAgent(provider) && ready(provider))
  );
}

export interface AgentSetupOfferView {
  readonly createdAt: number;
  /** The choices under the message, while the question is open. */
  readonly replies: boolean;
  /** The app's line after "Not now". */
  readonly dismissed: boolean;
  /** Not yet tied to a chat: the first send or choice here ties it. */
  readonly unbound: boolean;
}

/**
 * Where the message shows: in its own chat, or, before it has one, in an empty
 * new chat while the free agent is still the only working agent.
 */
export function resolveAgentSetupOfferView(input: {
  readonly record: AgentSetupOfferRecord | null;
  readonly threadId: string;
  readonly emptyDraft: boolean;
  readonly otherAgentReady: boolean;
}): AgentSetupOfferView | null {
  const { record } = input;
  if (record === null) return null;
  const unbound = record.threadId === null;
  if (unbound ? !input.emptyDraft || input.otherAgentReady : record.threadId !== input.threadId) {
    return null;
  }
  return {
    createdAt: record.createdAt,
    replies: record.state === "open",
    dismissed: record.state === "dismissed",
    unbound,
  };
}

export function readAgentSetupOfferRecord(): AgentSetupOfferRecord | null {
  try {
    return getLocalStorageItem(STORAGE_KEY, AgentSetupOfferRecord);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cached: { readonly record: AgentSetupOfferRecord | null } | null = null;

/** Best effort: storage that fails only loses the offer, never a chat. */
export function updateAgentSetupOfferRecord(
  update: (record: AgentSetupOfferRecord | null) => AgentSetupOfferRecord | null,
): void {
  const current = readAgentSetupOfferRecord();
  const next = update(current);
  if (next === current) return;
  try {
    if (next === null) removeLocalStorageItem(STORAGE_KEY);
    else setLocalStorageItem(STORAGE_KEY, next, AgentSetupOfferRecord);
  } catch {
    // Private windows and full quotas.
  }
  cached = null;
  for (const listener of listeners) listener();
}

/** Ties an open offer to the chat that answered it. */
export function answerAgentSetupOffer(threadId: string, state: "answered" | "dismissed"): void {
  updateAgentSetupOfferRecord((record) =>
    record === null || record.state !== "open" || (record.threadId ?? threadId) !== threadId
      ? record
      : { ...record, threadId, state },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readCached(): AgentSetupOfferRecord | null {
  if (cached === null) cached = { record: readAgentSetupOfferRecord() };
  return cached.record;
}

export function useAgentSetupOfferRecord(): AgentSetupOfferRecord | null {
  return useSyncExternalStore(subscribe, readCached, () => null);
}

/** "Something else" waits for the typed name; held for this window session only. */
let typingThreadId: string | null = null;
const typingListeners = new Set<() => void>();

export function setAgentSetupOfferTyping(threadId: string | null): void {
  if (typingThreadId === threadId) return;
  typingThreadId = threadId;
  for (const listener of typingListeners) listener();
}

export function useAgentSetupOfferTyping(threadId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      typingListeners.add(listener);
      return () => {
        typingListeners.delete(listener);
      };
    },
    () => typingThreadId === threadId,
    () => false,
  );
}
