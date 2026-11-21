import { threadKey } from "@t3tools/client-runtime/state/entities";
import { holdThreadWindowView } from "@t3tools/client-runtime/state/threads";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

/**
 * Tells the open thread's state whether this view follows the live end with find closed, so a
 * long thread drops its oldest rows only while nobody can be reading them.
 */
export function useThreadWindowFollow(ref: ScopedThreadRef | null, following: boolean): void {
  const key = ref === null ? null : threadKey(ref);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this view with the thread window outside React
  useEffect(
    () => (key === null ? undefined : holdThreadWindowView(key, following)),
    [key, following],
  );
}
