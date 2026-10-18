import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  admitProviderUpdatePrompt,
  PROVIDER_UPDATE_STARTUP_WAIT_MS,
  settleProviderUpdateEnvironments,
  unresolvedProviderUpdateKeys,
  type ProviderUpdateSettlingEnvironment,
} from "./ProviderUpdateLaunchNotification.logic";

// UpComputer: one startup wait and one admitted set for the session, whichever
// launch prompt is mounted, so switching between them neither restarts the
// wait nor lets in what one of them left out.
let startupWaitEndsAt: number | null = null;
interface LaunchSettlingState {
  readonly lateKeys: ReadonlySet<string> | null;
  readonly admittedKeys: ReadonlySet<string> | null;
}
let state: LaunchSettlingState = { lateKeys: null, admittedKeys: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readState = () => state;

function publish(next: Partial<LaunchSettlingState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/**
 * What a launch prompt shows, or null while it waits; see
 * `settleProviderUpdateEnvironments`. Without `enabled` (upstream's surface)
 * it returns `environments` as they are.
 */
export function useProviderUpdateLaunchSettling<
  Environment extends ProviderUpdateSettlingEnvironment,
>(input: {
  readonly environments: ReadonlyArray<Environment>;
  readonly sessionKnown: boolean;
  readonly enabled: boolean;
}): ReadonlyArray<Environment> | null {
  const { environments, sessionKnown, enabled } = input;
  const unresolvedKeys = useMemo(() => unresolvedProviderUpdateKeys(environments), [environments]);
  const unresolvedKeysRef = useRef(unresolvedKeys);
  useEffect(() => {
    unresolvedKeysRef.current = unresolvedKeys;
  }, [unresolvedKeys]);
  const { lateKeys, admittedKeys } = useSyncExternalStore(subscribe, readState, readState);
  useEffect(() => {
    if (!enabled || state.lateKeys !== null || state.admittedKeys !== null) return;
    startupWaitEndsAt ??= Date.now() + PROVIDER_UPDATE_STARTUP_WAIT_MS;
    const timer = setTimeout(
      () => {
        if (state.lateKeys !== null || state.admittedKeys !== null) return;
        publish({ lateKeys: new Set(unresolvedKeysRef.current) });
      },
      Math.max(0, startupWaitEndsAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [enabled]);
  const settled = useMemo(
    () =>
      enabled
        ? settleProviderUpdateEnvironments({ environments, sessionKnown, lateKeys, admittedKeys })
        : environments,
    [admittedKeys, enabled, environments, lateKeys, sessionKnown],
  );
  // Before paint, so no later render can show a set other than the admitted one.
  useLayoutEffect(() => {
    if (!enabled || settled === null || state.admittedKeys !== null) return;
    const admittedKeys = admitProviderUpdatePrompt(settled);
    if (admittedKeys !== null) publish({ admittedKeys });
  }, [enabled, settled]);
  return settled;
}
