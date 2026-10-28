import * as Cause from "effect/Cause";

import { isTransportConnectionErrorMessage } from "./transport.ts";

/** What a person reads about a failure, and the technical text kept for Details. */
export interface PlainError {
  /** A short clause such as "your computer isn't connected", or undefined when unknown. */
  readonly reason: string | undefined;
  /** Raw error text for a copyable Details disclosure; never the main message. */
  readonly detail: string | undefined;
  readonly kind: "disconnected" | "timeout" | "permission" | "other";
}

const MAX_DETAIL_LENGTH = 4_000;
const MAX_PLAIN_REASON_LENGTH = 160;
const MAX_NODES = 32;

const REASONS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly reason: string;
  readonly kind: PlainError["kind"];
}> = [
  {
    pattern:
      /\b(?:not connected|disconnected|failed to fetch|networkerror|network error|econnrefused|econnreset|enotfound|offline)\b/iu,
    reason: "your computer isn't connected",
    kind: "disconnected",
  },
  {
    pattern: /\b(?:timed out|timeout|time out|deadline exceeded)\b/iu,
    reason: "it took too long to respond",
    kind: "timeout",
  },
  {
    pattern:
      /\b(?:lacks permission|cannot change|not authori[sz]ed|forbidden|permission denied|not allowed)\b/iu,
    reason: "this device doesn't have permission to do that",
    kind: "permission",
  },
  { pattern: /\b(?:enospc|no space left)\b/iu, reason: "the disk is full", kind: "other" },
  { pattern: /\b(?:eacces|eperm)\b/iu, reason: "the system denied access", kind: "other" },
];

function collectTexts(error: unknown): Array<string> {
  const texts: Array<string> = [];
  const seen = new Set<unknown>();
  const pending: Array<unknown> = [error];
  while (pending.length > 0 && seen.size < MAX_NODES) {
    const current = pending.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "string") {
      if (current.trim().length > 0) texts.push(current.trim());
      continue;
    }
    if (typeof current !== "object") continue;
    try {
      if (Cause.isCause(current)) {
        pending.push(Cause.squash(current));
        continue;
      }
      const record = current as Record<string, unknown>;
      for (const key of ["message", "detail"] as const) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) texts.push(value.trim());
      }
      if ("cause" in record) pending.push(record.cause);
    } catch {
      // A throwing accessor leaves only what was read so far.
    }
  }
  return [...new Set(texts)];
}

/**
 * Text a person can read without knowing the code: one line, short, and no
 * paths, JSON, stack frames, error class names or dotted identifiers.
 */
function looksPlain(text: string): boolean {
  return (
    text.length <= MAX_PLAIN_REASON_LENGTH &&
    !/[\r\n{}[\]<>`]/u.test(text) &&
    !/(?:^|\s)\/[\w.-]+\//u.test(text) &&
    !/\b[A-Z]:\\/u.test(text) &&
    !/\b[A-Za-z]+Error\b|\bat \w+ \(/u.test(text) &&
    !/\b[A-Za-z]+\.[A-Za-z]+\.[A-Za-z]+\b|\b[a-z]+[A-Z]\w*\.\w+/u.test(text) &&
    !/\b\w+_\w+\b/u.test(text)
  );
}

function asClause(text: string): string {
  const line = text.replace(/[.\s]+$/u, "");
  // Only an ordinary capitalized word is lowered; names such as GitHub keep their case.
  return /^[A-Z][a-z]*\b/u.test(line) ? line.charAt(0).toLowerCase() + line.slice(1) : line;
}

export function describeError(error: unknown): PlainError {
  const texts = collectTexts(error);
  const joined = texts.join("\n");
  const detail = joined.length === 0 ? undefined : joined.slice(0, MAX_DETAIL_LENGTH);
  if (texts.some((text) => isTransportConnectionErrorMessage(text))) {
    return { reason: "your computer isn't connected", detail, kind: "disconnected" };
  }
  for (const entry of REASONS) {
    if (entry.pattern.test(joined)) return { reason: entry.reason, detail, kind: entry.kind };
  }
  const plain = texts.find(looksPlain);
  return { reason: plain === undefined ? undefined : asClause(plain), detail, kind: "other" };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One sentence for a failed action: the reason when it is known, then what to
 * do. `action` reads after "Up.computer couldn't", e.g. "rename this thread".
 */
export function plainErrorSentence(error: unknown, action?: string): string {
  const { reason, kind } = describeError(error);
  const lead =
    action === undefined
      ? reason === undefined
        ? "Something went wrong"
        : capitalize(reason)
      : `Up.computer couldn't ${action}${reason === undefined ? "" : `: ${reason}`}`;
  switch (kind) {
    case "disconnected":
      return `${lead}. Reconnect, then try again.`;
    case "permission":
      return `${lead}. Pair this device again with full access in Settings, Connections.`;
    default:
      return `${lead}. Try again, and if it keeps failing, check that your computer is connected.`;
  }
}
