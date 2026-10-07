import {
  TASK_ARCHIVED_EVENT,
  TASK_STATUS_CHANGED_EVENT,
  TASK_UNARCHIVED_EVENT,
  TaskArchiveChangedPayload,
  TaskStatusChangedPayload,
  type TaskActor,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface TaskHistoryEntry {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly at: string;
}

const decodeStatusChange = Schema.decodeUnknownOption(TaskStatusChangedPayload);
const decodeArchiveChange = Schema.decodeUnknownOption(TaskArchiveChangedPayload);

function actorLabel(actor: TaskActor, agentNameForRun: (runId: string) => string | null): string {
  switch (actor.type) {
    case "person":
      return "Person";
    case "agent-run":
      return agentNameForRun(actor.agentRunId) ?? "Agent run";
    case "thread":
      return "Chat agent";
    case "server":
      return "Server";
  }
}

/**
 * The task's status and archive history, newest first, as the server recorded
 * it. Other event kinds and unreadable payloads are left out.
 */
export function taskHistoryEntries(
  events: ReadonlyArray<TaskEvent>,
  agentNameForRun: (runId: string) => string | null,
): TaskHistoryEntry[] {
  return events.flatMap((event): TaskHistoryEntry[] => {
    if (event.kind === TASK_STATUS_CHANGED_EVENT) {
      return Option.match(decodeStatusChange(event.payload), {
        onNone: () => [],
        onSome: ({ from, to, actor }) => [
          {
            id: event.id,
            title: `${from} → ${to}`,
            actor: actorLabel(actor, agentNameForRun),
            reason: null,
            at: event.createdAt,
          },
        ],
      });
    }
    if (event.kind === TASK_ARCHIVED_EVENT || event.kind === TASK_UNARCHIVED_EVENT) {
      return Option.match(decodeArchiveChange(event.payload), {
        onNone: () => [],
        onSome: ({ actor, reason }) => [
          {
            id: event.id,
            title: event.kind === TASK_ARCHIVED_EVENT ? "Archived" : "Unarchived",
            actor: actorLabel(actor, agentNameForRun),
            reason: reason ?? null,
            at: event.createdAt,
          },
        ],
      });
    }
    return [];
  });
}

/** Compact timeline of a task's history entries for the detail column. */
export function TaskHistory(props: {
  readonly entries: ReadonlyArray<TaskHistoryEntry>;
  readonly status: "loading" | "ready" | "error";
}) {
  if (props.entries.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {props.status === "loading"
          ? "Loading history…"
          : props.status === "error"
            ? "Could not load the history."
            : "No status changes recorded yet."}
      </p>
    );
  }
  return (
    <ol className="flex min-w-0 flex-col gap-0.5" aria-label="Task history">
      {props.entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0 flex-col px-2 py-1.5 text-sm">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-foreground">{entry.title}</span>
            <time dateTime={entry.at} className="shrink-0 text-xs text-muted-foreground">
              {new Date(entry.at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </time>
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {entry.reason ? `${entry.actor}: ${entry.reason}` : entry.actor}
          </span>
        </li>
      ))}
    </ol>
  );
}
