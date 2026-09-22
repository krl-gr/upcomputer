/** Temporary cookie-name bridge. Never select a legacy cookie over a present new one. */
export function legacySessionCookieName(current: string): string {
  return current.replace(/^upcomputer_session(?=_|$)/, "t3_session");
}
