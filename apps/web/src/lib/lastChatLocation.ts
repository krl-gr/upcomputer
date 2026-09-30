/**
 * The chat workspace's last location (full href), so leaving settings returns
 * to the chat that was open instead of "/", which starts a new chat.
 *
 * Kept in sessionStorage so it survives a reload while on settings, and stays
 * per tab.
 */
const LAST_CHAT_LOCATION_KEY = "upcomputer:last-chat-location";

// Top-level routes outside the chat workspace. The chat layout still renders
// once with the next location while the router loads it, so those hrefs reach
// `rememberChatLocation` too and must not be taken for a chat.
const NON_CHAT_ROOT_SEGMENTS = new Set(["settings", "pair", "connect"]);

function isChatHref(href: string): boolean {
  const pathname = href.split(/[?#]/, 1)[0] ?? "";
  // "/" only redirects into a fresh chat; the chat it opens is remembered next.
  if (pathname === "" || pathname === "/") return false;
  const rootSegment = pathname.split("/")[1] ?? "";
  return !NON_CHAT_ROOT_SEGMENTS.has(rootSegment);
}

function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Storage access can throw when it is blocked.
    return null;
  }
}

let lastChatHref: string | null = null;

export function rememberChatLocation(href: string): void {
  if (!isChatHref(href)) return;
  lastChatHref = href;
  try {
    sessionStore()?.setItem(LAST_CHAT_LOCATION_KEY, href);
  } catch {
    // The in-memory value still covers this page load.
  }
}

export function lastChatLocation(): string | null {
  if (lastChatHref !== null) return lastChatHref;
  let stored: string | null = null;
  try {
    stored = sessionStore()?.getItem(LAST_CHAT_LOCATION_KEY) ?? null;
  } catch {
    return null;
  }
  return stored !== null && isChatHref(stored) ? stored : null;
}

/** Test-only: forgets the in-memory value, as a page reload does. */
export function resetLastChatLocationMemoryForTests(): void {
  lastChatHref = null;
}
