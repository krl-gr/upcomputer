import type { TaskAgentRun, TaskEvent } from "@t3tools/tasks-contracts/v1";

/**
 * How many recent events a run's first message reads. Agents have no tool that
 * reads task events, so the first message is where they see them.
 */
export const RECENT_EVENTS_READ_LIMIT = 200;
/** Characters of event lines in a run's first message. */
const RECENT_EVENTS_BUDGET = 4_000;
/** Characters of one event's text, so one long result cannot fill the budget. */
const EVENT_TEXT_MAX_LENGTH = 1_200;

/**
 * Server snapshots of status and tags after every change, and run starts: the
 * status changes, run results and the previous-run section already carry what
 * they would say.
 */
const NOISE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "task.created",
  "task.updated",
  "task.deleted",
  "task.tag-added",
  "task.tag-removed",
  "task.not-before-reached",
  "task.agent-started",
]);

/** Payload fields shown as the event's author rather than its text. */
const AUTHOR_FIELDS = new Set(["actor", "agentId", "agentRunId"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function author(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const actor = payload.actor;
  if (isRecord(actor)) {
    if (actor.type === "person") return "person";
    if (actor.type === "server") return "server";
    if (actor.type === "agent-run") return `run ${String(actor.agentRunId)}`;
    if (actor.type === "thread") return `thread ${String(actor.threadId)}`;
  }
  if (typeof payload.agentRunId !== "string") return null;
  return typeof payload.agentId === "string"
    ? `agent ${payload.agentId} run ${payload.agentRunId}`
    : `run ${payload.agentRunId}`;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The event's main text first (its text or summary field), then its other fields. */
function eventText(kind: string, payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!isRecord(payload)) return payload == null ? "" : compactJson(payload);
  const rest = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !AUTHOR_FIELDS.has(key)),
  );
  if (kind === "task.status-changed" && typeof rest.from === "string") {
    return `${rest.from} -> ${String(rest.to)}`;
  }
  const mainKey =
    typeof rest.text === "string" ? "text" : typeof rest.summary === "string" ? "summary" : null;
  if (mainKey === null) return Object.keys(rest).length > 0 ? compactJson(rest) : "";
  const { [mainKey]: main, ...others } = rest;
  return Object.keys(others).length > 0 ? `${String(main)}\n${compactJson(others)}` : String(main);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}... (truncated)` : text;
}

function eventLine(event: TaskEvent): string {
  const by = author(event.payload);
  const text = truncate(eventText(event.kind, event.payload).trim(), EVENT_TEXT_MAX_LENGTH);
  const head = `- ${event.createdAt} ${event.kind}${by === null ? "" : ` by ${by}`}`;
  return text ? `${head}: ${text.replaceAll("\n", "\n  ")}` : head;
}

/**
 * The task's most recent events that matter for the work, newest last, within
 * a character budget; the newest one is always shown. `events` come newest
 * first, as the repository returns them, and may stop at the read limit.
 */
export function recentEventsSection(events: ReadonlyArray<TaskEvent>): string {
  const relevant = events.filter((event) => !NOISE_EVENT_KINDS.has(event.kind));
  const lines: string[] = [];
  let used = 0;
  for (const event of relevant) {
    const line = eventLine(event);
    if (lines.length > 0 && used + line.length + 1 > RECENT_EVENTS_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return "";
  const omitted = relevant.length - lines.length;
  const earlier =
    events.length >= RECENT_EVENTS_READ_LIMIT
      ? `${omitted > 0 ? `${omitted} or more` : "Some"} earlier events are not shown.\n`
      : omitted > 0
        ? `${omitted} earlier event${omitted === 1 ? " is" : "s are"} not shown.\n`
        : "";
  return `\nRecent task events (newest last; server snapshots and run starts left out):\n${earlier}${lines.toReversed().join("\n")}\n`;
}

/** This agent's latest earlier run on the task, so a repeat run knows where it left off. */
export function previousRunSection(run: TaskAgentRun | null, hasOutput: boolean): string {
  if (run === null) return "";
  return `
Your previous run on this task:
- runId: ${run.id}
- status: ${run.status}
- ended: ${run.completedAt ?? "(unknown)"}
${hasOutput ? "Its result is in the current output above; its events, if any, are in the recent events above." : "It left no task output; its events, if any, are in the recent events above."}
`;
}
