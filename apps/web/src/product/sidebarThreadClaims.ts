import { useSyncExternalStore } from "react";

/**
 * Threads a feature's sidebar section already lists, such as a bot's
 * permanent chat, by scoped thread key. The Threads list leaves them out so a
 * thread appears once. A section claims only while it is mounted, so threads
 * never disappear behind a section the sidebar does not show. Search, links
 * and the command palette still find them.
 */
const claims = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
let claimed: ReadonlySet<string> = new Set();

function publish() {
  const next = new Set([...claims.values()].flatMap((keys) => [...keys]));
  if (next.size === claimed.size && [...next].every((key) => claimed.has(key))) return;
  claimed = next;
  for (const listener of listeners) listener();
}

/** Replaces `owner`'s claim; the returned release drops it unless a newer claim replaced it. */
export function claimSidebarThreads(owner: string, threadKeys: Iterable<string>): () => void {
  const keys = new Set(threadKeys);
  claims.set(owner, keys);
  publish();
  return () => {
    if (claims.get(owner) !== keys) return;
    claims.delete(owner);
    publish();
  };
}

export function claimedSidebarThreadKeys(): ReadonlySet<string> {
  return claimed;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useClaimedSidebarThreadKeys(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, claimedSidebarThreadKeys, claimedSidebarThreadKeys);
}
