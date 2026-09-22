/** Pending OAuth request state only; not an access token or saved login. */
export const CONNECT_AUTH_STATE_KEY = "upcomputer-connect-cli-auth-state";
const LEGACY_KEY = "t3code-connect-cli-auth-state";

export function readConnectAuthState(storage: Storage): string | null {
  const current = storage.getItem(CONNECT_AUTH_STATE_KEY);
  if (current !== null) return current;
  const legacy = storage.getItem(LEGACY_KEY);
  if (legacy === null) return null;
  try {
    storage.setItem(CONNECT_AUTH_STATE_KEY, legacy);
    if (storage.getItem(CONNECT_AUTH_STATE_KEY) === legacy) storage.removeItem(LEGACY_KEY);
  } catch {
    // A quota/privacy failure must not discard the request's state check.
  }
  return legacy;
}
