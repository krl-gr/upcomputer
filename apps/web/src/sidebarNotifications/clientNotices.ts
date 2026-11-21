import type { BackgroundNotice, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useSyncExternalStore } from "react";

/**
 * A background problem this client found by itself, such as a list that didn't load. Its
 * title and message are `msg()` text, where `{computer}` takes the computer's name.
 */
export interface ClientNoticeInput {
  /** One per problem on a computer, such as `bots:list`. */
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly severity: "warning" | "error";
  readonly title: string;
  readonly message: string;
  /** The raw error, behind the card's Details. */
  readonly detail?: string;
}

export interface ClientNotice extends ClientNoticeInput {
  /** When the problem started: a repeat while it lasts keeps it, so a dismissed card stays dismissed. */
  readonly occurredAt: string;
  readonly retry?: () => void;
}

interface Entry {
  notice: ClientNotice;
  holders: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyArray<ClientNotice> = [];

function publish() {
  snapshot = [...entries.values()].map((entry) => entry.notice);
  for (const listener of listeners) listener();
}

/**
 * Shows the notice until every holder releases it. A release followed by a hold in the same
 * task, as when an effect runs again, keeps the notice and its first time.
 */
export function holdClientNotice(
  input: ClientNoticeInput,
  retry?: () => void,
  now: () => string = () => new Date().toISOString(),
): () => void {
  const key = `${input.environmentId}\n${input.id}`;
  const current = entries.get(key);
  const occurredAt = current?.notice.occurredAt ?? now();
  const entry: Entry = current ?? { notice: { ...input, occurredAt }, holders: 0 };
  entry.holders += 1;
  entry.notice = { ...input, occurredAt, ...(retry ? { retry } : {}) };
  entries.set(key, entry);
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holders -= 1;
    if (entry.holders > 0) return;
    queueMicrotask(() => {
      if (entries.get(key) !== entry || entry.holders > 0) return;
      entries.delete(key);
      publish();
    });
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const readClientNotices = (): ReadonlyArray<ClientNotice> => snapshot;

export function useClientNotices(): ReadonlyArray<ClientNotice> {
  return useSyncExternalStore(subscribe, readClientNotices, readClientNotices);
}

/**
 * Holds the given notices while the caller is mounted and they last. `retry` should be stable:
 * a new one holds the notices again.
 */
export function useHeldClientNotices(
  notices: ReadonlyArray<ClientNoticeInput>,
  retry?: () => void,
): void {
  const key = JSON.stringify(notices);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds Notifications entries, an outside store, while the problem lasts
  useEffect(() => {
    const held = JSON.parse(key) as ReadonlyArray<ClientNoticeInput>;
    const releases = held.map((notice) => holdClientNotice(notice, retry));
    return () => {
      for (const release of releases) release();
    };
  }, [key, retry]);
}

/** A client notice as the popover lists it, beside the servers' notices. */
export type ListedClientNotice = BackgroundNotice & {
  readonly environmentId: EnvironmentId;
  readonly retry?: () => void;
};
