import { taskHistoryRecords } from "@t3tools/tasks-client/taskHistory";
import type { TaskActor, TaskEvent } from "@t3tools/tasks-contracts/v1";
import { gtFallback, useGT } from "gt-react";

export interface TaskHistoryEntry {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly at: string;
}

type GT = ReturnType<typeof useGT>;

function actorLabel(
  actor: TaskActor,
  agentNameForRun: (runId: string) => string | null,
  gt: GT,
): string {
  switch (actor.type) {
    case "person":
      return gt("Person");
    case "agent-run":
      return agentNameForRun(actor.agentRunId) ?? gt("Worker run");
    case "thread":
      return gt("Chat agent");
    case "server":
      return gt("Server");
  }
}

/**
 * The task's status and archive history and why agents did not start, newest
 * first, as the server recorded it. Other event kinds and unreadable payloads
 * are left out. Components pass their `useGT()`; without it the labels stay English.
 */
export function taskHistoryEntries(
  events: ReadonlyArray<TaskEvent>,
  agentNameForRun: (runId: string) => string | null,
  gt: GT = gtFallback,
): TaskHistoryEntry[] {
  return taskHistoryRecords(events).map((record): TaskHistoryEntry => {
    const base = { id: record.id, at: record.at };
    switch (record.kind) {
      case "status":
        return {
          ...base,
          title: `${record.from} → ${record.to}`,
          actor: actorLabel(record.actor, agentNameForRun, gt),
          reason: null,
        };
      case "archived":
      case "unarchived":
        return {
          ...base,
          title:
            record.kind === "archived"
              ? gt("Archived", { $context: "history entry: the task was archived" })
              : gt("Unarchived", { $context: "history entry: the task was unarchived" }),
          actor: actorLabel(record.actor, agentNameForRun, gt),
          reason: record.reason,
        };
      case "agentNotStarted":
      case "noMatchingAgent":
        return {
          ...base,
          title:
            record.kind === "agentNotStarted"
              ? gt("Didn't start")
              : gt("No worker will pick this up"),
          actor: record.agentName ?? gt("Server"),
          reason: record.reason,
        };
    }
  });
}

/** Compact timeline of a task's history entries for the detail column. */
export function TaskHistory(props: {
  readonly entries: ReadonlyArray<TaskHistoryEntry>;
  readonly status: "loading" | "ready" | "error";
}) {
  const gt = useGT();
  if (props.entries.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {props.status === "loading"
          ? gt("Loading history…")
          : props.status === "error"
            ? gt("Could not load the history.")
            : gt("No status changes recorded yet.")}
      </p>
    );
  }
  return (
    <ol className="flex min-w-0 flex-col gap-0.5" aria-label={gt("Task history")}>
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
          <span className="break-words text-xs text-muted-foreground">
            {entry.reason ? `${entry.actor}: ${entry.reason}` : entry.actor}
          </span>
        </li>
      ))}
    </ol>
  );
}
