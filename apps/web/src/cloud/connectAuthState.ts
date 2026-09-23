export const CONNECT_AUTH_STATE_KEY = "upcomputer-connect-cli-auth-state";
export function readConnectAuthState(storage: Storage): string | null {
  return storage.getItem(CONNECT_AUTH_STATE_KEY);
}
