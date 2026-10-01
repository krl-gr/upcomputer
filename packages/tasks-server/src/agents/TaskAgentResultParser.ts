export interface ParsedTaskAgentResultEvent {
  readonly kind: string | null;
  readonly message: string;
  readonly payload: unknown;
}

export interface ParsedTaskAgentResult {
  readonly status: string | null;
  readonly summary: string | null;
  readonly blocked: boolean;
  readonly events: ReadonlyArray<ParsedTaskAgentResultEvent>;
}

const BLOCK_PATTERN =
  /(?:^|\n)(```|~~~)[ \t]*(task[_-]agent[_-]result|json)[^\n]*\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/gi;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrap(value: unknown): unknown {
  const valueRecord = record(value);
  if (!valueRecord) return value;
  for (const key of ["result", "taskAgentResult", "task_agent_result", "task-agent-result"]) {
    if (record(valueRecord[key])) return valueRecord[key];
  }
  return value;
}

function normalize(value: unknown): ParsedTaskAgentResult | null {
  const valueRecord = record(unwrap(value));
  if (!valueRecord) return null;
  const status = text(valueRecord.status);
  const blocker = text(valueRecord.blocker ?? valueRecord.blockedReason);
  const summary = text(valueRecord.summary ?? valueRecord.message) ?? blocker;
  const events = Array.isArray(valueRecord.events)
    ? valueRecord.events.flatMap((entry): ParsedTaskAgentResultEvent[] => {
        const event = record(entry);
        const message = text(event?.message ?? event?.summary ?? event?.text);
        return event && message
          ? [{ kind: text(event.kind ?? event.type), message, payload: event.payload }]
          : [];
      })
    : [];
  const blocked =
    valueRecord.blocked === true ||
    valueRecord.needsUserInput === true ||
    blocker !== null ||
    status?.toLowerCase().includes("block") === true;
  return status || summary || events.length > 0 ? { status, summary, blocked, events } : null;
}

export function parseTaskAgentResultMarkdown(markdown: string): ParsedTaskAgentResult | null {
  const candidates = [...markdown.matchAll(BLOCK_PATTERN)].map((match) => match[3]?.trim());
  if (markdown.trim().startsWith("{")) candidates.push(markdown.trim());
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = normalize(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Other fenced blocks and partial provider output are intentionally ignored.
    }
  }
  return null;
}
