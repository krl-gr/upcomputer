import { useEffect, useState } from "react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { threadFamilies } from "../../../../apps/web/src/state/threads.ts";
import { appAtomRegistry } from "../../../../apps/web/src/rpc/atomRegistry.ts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

/**
 * A thread's shell, also when the shell leaves it out: idle task-agent threads are not in it.
 * While `load` holds and the row is missing, its family is read and merged into the shell rows,
 * as an open thread's is. The mount sticks to the thread, so the row it brings does not drop it.
 */
export function useOmittedThreadShell(
  ref: ScopedThreadRef | null,
  load: boolean,
): EnvironmentThreadShell | null {
  const shell = useThreadShell(ref);
  const key = ref === null ? null : scopedThreadKey(ref);
  const [mountedKey, setMountedKey] = useState<string | null>(null);
  const nextKey = load && (shell === null || mountedKey === key) ? key : null;
  if (nextKey !== mountedKey) setMountedKey(nextKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the thread's family in the thread family registry while it is shown
  useEffect(() => {
    const mounted = mountedKey === null ? null : parseScopedThreadKey(mountedKey);
    if (mounted === null) return;
    return threadFamilies.mount(appAtomRegistry, mounted.environmentId, mounted.threadId);
  }, [mountedKey]);
  return shell;
}
