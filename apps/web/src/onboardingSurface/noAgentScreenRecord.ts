import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";

/**
 * What this client keeps of the no-agent screen across launches: when it was
 * first shown, the way the user chose last, and whether an agent worked since.
 * A launch without a working agent shows the screen again, and the first
 * message after the screen reports once, then the record goes.
 */
const NoAgentScreenRecord = Schema.Struct({
  shownAt: Schema.Number,
  path: Schema.NullOr(Schema.Literals(["installed_free_agent", "setup_myself", "copied_prompt"])),
  agentWorked: Schema.Boolean,
});
export type NoAgentScreenRecord = typeof NoAgentScreenRecord.Type;
export type NoAgentScreenPath = NonNullable<NoAgentScreenRecord["path"]>;

const STORAGE_KEY = "upcomputer:onboarding:no-agent-screen";

export function readNoAgentScreenRecord(): NoAgentScreenRecord | null {
  try {
    return getLocalStorageItem(STORAGE_KEY, NoAgentScreenRecord);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cached: { readonly record: NoAgentScreenRecord | null } | null = null;

/** Best effort: storage that fails only costs a second showing or the first-message event. */
export function updateNoAgentScreenRecord(
  update: (record: NoAgentScreenRecord | null) => NoAgentScreenRecord | null,
): void {
  const next = update(readNoAgentScreenRecord());
  try {
    if (next === null) window.localStorage.removeItem(STORAGE_KEY);
    else setLocalStorageItem(STORAGE_KEY, next, NoAgentScreenRecord);
  } catch {
    // Private windows and full quotas.
  }
  cached = null;
  for (const listener of listeners) listener();
}

function readCachedShownAt(): number | null {
  if (cached === null) cached = { record: readNoAgentScreenRecord() };
  return cached.record?.shownAt ?? null;
}

/** When the screen first showed, while its first message is still to report. */
export function useNoAgentScreenShownAt(): number | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, readCachedShownAt);
}

/** A user who left the screen without a working agent sees it again on the next launch. */
export function asksAgainForAgent(record: NoAgentScreenRecord | null): boolean {
  return record !== null && !record.agentWorked;
}
