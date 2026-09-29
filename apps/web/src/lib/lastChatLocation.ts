/**
 * The chat workspace's last location (full href), so leaving settings returns
 * to the chat that was open instead of "/", which starts a new chat.
 */
let lastChatHref: string | null = null;

export function rememberChatLocation(href: string): void {
  // "/" only redirects into a fresh chat; the chat it opens is remembered next.
  if (href !== "/") lastChatHref = href;
}

export function lastChatLocation(): string | null {
  return lastChatHref;
}
