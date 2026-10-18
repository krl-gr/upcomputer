import { useEffect, useRef, useSyncExternalStore } from "react";

import { PROVIDER_UPDATE_STARTUP_WAIT_MS } from "./ProviderUpdateLaunchNotification.logic";

// UpComputer: one startup wait for the session, whichever launch prompt is
// mounted, so switching between them neither restarts it nor forgets what was late.
let startupWaitEndsAt: number | null = null;
let lateKeys: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readLateKeys = () => lateKeys;

/**
 * What was still unresolved when the launch prompt's startup wait ended, or
 * null before it ends. `unresolvedKeys` is read at that moment.
 */
export function useProviderUpdateLateKeys(
  unresolvedKeys: ReadonlySet<string>,
): ReadonlySet<string> | null {
  const unresolvedKeysRef = useRef(unresolvedKeys);
  useEffect(() => {
    unresolvedKeysRef.current = unresolvedKeys;
  }, [unresolvedKeys]);
  const late = useSyncExternalStore(subscribe, readLateKeys, readLateKeys);
  useEffect(() => {
    if (lateKeys !== null) return;
    startupWaitEndsAt ??= Date.now() + PROVIDER_UPDATE_STARTUP_WAIT_MS;
    const timer = setTimeout(
      () => {
        if (lateKeys !== null) return;
        lateKeys = new Set(unresolvedKeysRef.current);
        for (const listener of listeners) listener();
      },
      Math.max(0, startupWaitEndsAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, []);
  return late;
}
